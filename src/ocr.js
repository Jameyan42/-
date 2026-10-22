import { createWorker } from "tesseract.js";
import { renderInvoiceImage, defaultImageSettings } from "./image-tools.js";
export function extractInvoiceFields(text) {
  const normalized = String(text || "").normalize("NFKC");
  const numbers = [
    ...normalized.matchAll(
      /(?:发\s*票\s*号\s*码|Invoice\s*(?:No\.?|Number))\s*[:：#]?\s*([\d \t]{8,40})/gi,
    ),
  ]
    .map((m) => m[1].replace(/\D/g, ""))
    .filter((n) => n.length >= 8 && n.length <= 20);
  const unique = [...new Set(numbers)];
  const invoice = unique.length === 1 ? unique[0] : "";
  const lines = normalized.split(/[\r\n]+/);
  const totalLabel =
    /(?:价\s*税\s*合\s*计|合\s*计\s*金\s*额|总\s*金\s*额|\bTOTAL\b)/i;
  const totals = [];
  for (let i = 0; i < lines.length; i++) {
    if (!totalLabel.test(lines[i])) continue;
    const own = lines[i].split(totalLabel).slice(1).join("");
    const matches = [...own.matchAll(/(?:[¥￥]\s*)?(\d[\d,]*\.\d{2})(?!\d)/g)];
    if (matches.length > 1) {
      totals.push(null);
      continue;
    }
    if (matches.length === 1) {
      totals.push(Number(matches[0][1].replaceAll(",", "")));
      continue;
    }
    const next = lines[i + 1]?.trim() || "";
    const m = next.match(
      /^(?:[（(]?小写[）)]?\s*[:：]?\s*)?[¥￥]?\s*(\d[\d,]*\.\d{2})\s*$/,
    );
    if (m) totals.push(Number(m[1].replaceAll(",", "")));
  }
  const valid = totals.filter(
    (n) => Number.isFinite(n) && n > 0 && n <= 1000000,
  );
  const amount =
    totals.length && valid.length === totals.length && new Set(valid).size === 1
      ? valid[0].toFixed(2)
      : "";
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
export function startRecognition(
  file,
  onProgress = () => {},
  settings = defaultImageSettings(),
) {
  let worker,
    canvas,
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
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    if (worker) void worker.terminate();
    rejectCancel(new Error(message));
  };
  const work = (async () => {
    checkOcrFile(file);
    if (location.protocol === "file:")
      throw new Error("本地单文件无法加载 OCR 引擎，请打开在线版，或手工填写");
    canvas = await renderInvoiceImage(file, settings);
    try {
      if (cancelled) throw new Error("已取消识别");
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
        errorHandler: () =>
          cancel("识别引擎加载失败，请检查网络并重试，或手工填写"),
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
      canvas.width = 1;
      canvas.height = 1;
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
