import { checkOcrFile, startRecognition } from "./ocr.js";
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const ocrPanel = () =>
  `<section class="ocr-panel" aria-label="发票图片识别"><div class="ocr-title"><span>✧ 发票图片 OCR</span><span class="badge s1">浏览器本地识别</span></div><p>支持 PNG / JPG / WebP，最大 6 MB。图片不上传，首次需下载约 10 MB 引擎及语言数据；不是发票验真。</p><div class="ocr-buttons"><button type="button" id="ocr-start">识别所选图片</button><button type="button" id="ocr-sample">载入虚构样票</button><button type="button" id="ocr-cancel" hidden>取消识别</button></div><p id="ocr-status" role="status" aria-live="polite">选择上方图片附件后开始，也可以使用虚构样票体验。</p><progress id="ocr-progress" max="100" value="0" hidden aria-label="识别进度"></progress><div id="ocr-preview"></div><div id="ocr-result"></div></section>`;
export function mountOcr(
  form,
  { onApply = () => {}, onSample = () => {} } = {},
) {
  let job = null,
    imageUrl = null,
    sampleFile = null,
    disposed = false,
    generation = 0;
  const panel = form.querySelector(".ocr-panel"),
    input = form.querySelector("[name=receipt]");
  const status = form.querySelector("#ocr-status"),
    result = form.querySelector("#ocr-result");
  const start = form.querySelector("#ocr-start"),
    sample = form.querySelector("#ocr-sample"),
    cancel = form.querySelector("#ocr-cancel"),
    progress = form.querySelector("#ocr-progress");
  const busy = (state) => {
    start.disabled = state;
    sample.disabled = state;
    cancel.hidden = !state;
    progress.hidden = !state;
    input.disabled = false;
  };
  const clearPreview = () => {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
      imageUrl = null;
    }
    form.querySelector("#ocr-preview").innerHTML = "";
  };
  const reset = () => {
    generation++;
    job?.cancel();
    job = null;
    busy(false);
    result.innerHTML = "";
    clearPreview();
  };
  input.addEventListener("change", () => {
    sampleFile = null;
    reset();
    status.textContent = "已选择附件，可开始识别；PDF 仅记录文件名。";
  });
  const run = async (file) => {
    reset();
    const current = generation;
    try {
      checkOcrFile(file);
      imageUrl = URL.createObjectURL(file);
      form.querySelector("#ocr-preview").innerHTML =
        `<img src="${imageUrl}" alt="当前待识别发票图片" class="ocr-image">`;
      busy(true);
      status.textContent = "正在加载本地识别引擎，请稍候…";
      progress.value = 0;
      job = startRecognition(file, (m) => {
        if (disposed || current !== generation) return;
        const recognizing = m.status === "recognizing text";
        progress.value = recognizing ? Math.round(m.progress * 100) : 0;
        status.textContent = recognizing
          ? `正在识别文字 ${Math.round(m.progress * 100)}%`
          : "正在准备识别引擎与语言数据，首次加载较慢…";
      });
      const data = await job.promise;
      if (disposed || current !== generation) return;
      status.textContent = data.text.trim()
        ? "识别完成，请对照原图核对后再应用。"
        : "未识别到文字，请使用清晰正向图片，或手工填写。";
      result.innerHTML = `<div class="ocr-candidates"><h3>待核对的候选字段</h3><div class="form-grid"><label>发票号码候选<input id="ocr-invoice" value="${escape(data.invoice)}" maxlength="40" placeholder="未提取到，可手工修正"></label><label>价税合计候选（元）<input id="ocr-amount" value="${escape(data.amount)}" type="number" min="0.01" max="1000000" step="0.01" placeholder="未提取到"></label></div><small>文本置信度 ${Math.round(data.confidence || 0)} / 100（引擎参考值，不是字段准确率）。空字段不会覆盖现有表单。</small><details><summary>查看识别原文</summary><pre>${escape(data.text || "未识别到文字")}</pre></details><label class="check-line"><input type="checkbox" id="ocr-confirm">我已对照原图核对，确认替换表单中的非空候选字段</label><button type="button" id="ocr-apply">确认并填入报销单</button></div>`;
      result.querySelector("#ocr-apply").onclick = () => {
        const invoice = result.querySelector("#ocr-invoice").value.trim(),
          amount = result.querySelector("#ocr-amount").value;
        if (!result.querySelector("#ocr-confirm").checked) {
          status.textContent = "请先对照原图核对并勾选确认";
          return;
        }
        if (!invoice && !amount) {
          status.textContent = "没有可应用字段，请手工填写或修改候选值";
          return;
        }
        if (
          amount &&
          (!Number.isFinite(Number(amount)) ||
            Number(amount) <= 0 ||
            Number(amount) > 1000000)
        ) {
          status.textContent = "请核对候选金额";
          return;
        }
        if (invoice) form.elements.invoice.value = invoice;
        if (amount) form.elements.amount.value = Number(amount).toFixed(2);
        onApply({ invoice: !!invoice, amount: !!amount });
        form.dispatchEvent(new Event("input", { bubbles: true }));
        status.textContent =
          "已将核对后的字段填入报销单，仍需填写用途并手工提交";
        result.innerHTML = "";
      };
    } catch (e) {
      if (!disposed && current === generation) {
        status.textContent =
          "识别未完成：" + (e.message || "图片读取失败，请换图重试或手工填写");
        result.innerHTML = "";
      }
    } finally {
      if (!disposed && current === generation) {
        busy(false);
        job = null;
      }
    }
  };
  start.onclick = () => run(input.files?.[0] || sampleFile);
  cancel.onclick = () => {
    reset();
    status.textContent = "已取消识别，可继续手工填写";
    start.focus();
  };
  sample.onclick = async () => {
    const current = generation;
    sample.disabled = true;
    try {
      const response = await fetch(
        new URL("./samples/demo-invoice.png", document.baseURI),
      );
      if (!response.ok) throw Error("样票加载失败");
      const blob = await response.blob();
      if (disposed || current !== generation) return;
      sampleFile = new File([blob], "轻报虚构样票.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(sampleFile);
      input.files = dt.files;
      onSample(sampleFile.name);
      await run(sampleFile);
    } catch (e) {
      if (!disposed)
        status.textContent = "样票加载失败，请自行选择虚构图片，或手工填写";
    } finally {
      if (!disposed) sample.disabled = false;
    }
  };
  const observer = new MutationObserver(() => {
    if (!panel.isConnected) {
      disposed = true;
      generation++;
      job?.cancel();
      clearPreview();
      observer.disconnect();
    }
  });
  observer.observe(document.querySelector("#overlay"), {
    childList: true,
    subtree: true,
  });
  return () => {
    disposed = true;
    generation++;
    job?.cancel();
    clearPreview();
    observer.disconnect();
  };
}
