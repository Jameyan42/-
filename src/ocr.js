import { createWorker } from "tesseract.js";
export function extractInvoiceFields(text) {
  const normalized = String(text || "").normalize("NFKC");
  const label = normalized.match(
    /(?:发\s*票\s*号\s*码|Invoice\s*(?:No\.?|Number))\s*[:：#]?\s*([\d \t]{8,40})/i,
  );
  const digits = label?.[1].replace(/\D/g, "") || "";
  const invoice = digits.length >= 8 && digits.length <= 20 ? digits : "";
  const lines = normalized.split(/[\r\n]+/);
  let amount = "";
  for (let i = 0; i < lines.length; i++) {
    if (
      !/(?:价\s*税\s*合\s*计|合\s*计\s*金\s*额|总\s*金\s*额|\bTOTAL\b)/i.test(
        lines[i],
      )
    )
      continue;
    const part = lines[i] + " " + (lines[i + 1] || "");
    const after = part.replace(
      /^.*?(?:价\s*税\s*合\s*计|合\s*计\s*金\s*额|总\s*金\s*额|\bTOTAL\b)/i,
      "",
    );
    const matches = [
      ...after.matchAll(/(?:[¥￥]\s*)?(\d[\d,]*\.\d{2})(?!\d)/g),
    ];
    if (matches.length === 1) {
      const n = Number(matches[0][1].replaceAll(",", ""));
      if (n > 0 && n <= 1000000) amount = n.toFixed(2);
    }
    break;
  }
  return { invoice, amount };
}
export function checkOcrFile(file) {
  if (!file) throw new Error("请先选择一张发票图片");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("识别支持 PNG、JPG 和 WebP；PDF 请手工填写，或先转为图片");
  if (file.size > 6 * 1024 * 1024)
    throw new Error("图片不能超过 6 MB，请先压缩后重试");
  if (!file.size) throw new Error("图片为空，请重新选择");
}
export function startRecognition(file, onProgress = () => {}) {
  let worker,
    cancelled = false,
    rejectCancel,
    timer;
  const cancelledPromise = new Promise((_, reject) => {
    rejectCancel = reject;
  });
  const cancel = (message = "已取消识别，可继续手工填写") => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timer);
    if (worker) void worker.terminate();
    rejectCancel(new Error(message));
  };
  const work = (async () => {
    checkOcrFile(file);
    if (location.protocol === "file:")
      throw new Error("本地单文件无法加载 OCR 引擎，请打开在线版，或手工填写");
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 16000000)
        throw new Error("图片尺寸过大，请缩小到 1600 万像素以内");
      const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas
        .getContext("2d")
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const base = new URL("./ocr/", document.baseURI).href;
      worker = await createWorker(["chi_sim", "eng"], 1, {
        workerPath: base + "worker.min.js",
        corePath: base,
        langPath: base,
        workerBlobURL: false,
        cacheMethod: "none",
        logger: (m) => {
          if (!cancelled) onProgress(m);
        },
        errorHandler: () => {},
      });
      if (cancelled) {
        await worker.terminate();
        throw new Error("已取消识别");
      }
      const result = await worker.recognize(canvas);
      return {
        text: result.data.text,
        confidence: result.data.confidence,
        ...extractInvoiceFields(result.data.text),
      };
    } finally {
      bitmap.close();
      if (worker) await worker.terminate();
    }
  })();
  timer = setTimeout(
    () => cancel("识别超过 90 秒，已停止等待。可压缩图片后重试或手工填写"),
    90000,
  );
  return {
    promise: Promise.race([work, cancelledPromise]).finally(() =>
      clearTimeout(timer),
    ),
    cancel,
  };
}
