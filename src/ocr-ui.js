import { isPdf, startPdfRender, pdfPageControl } from "./pdf-tools.js";
import { checkOcrFile, startRecognition } from "./ocr.js";
import { renderInvoiceImage, defaultImageSettings } from "./image-tools.js";
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const ocrPanel = () =>
  `<section class="ocr-panel" aria-label="发票图片与PDF识别"><div class="ocr-title"><span>✧ 发票图片 / PDF OCR</span><span class="badge s1">浏览器本地识别</span></div><p>PNG / JPG / WebP / PDF，最大 6 MB；文件不上传。PDF先选页，扫描件和电子票均转图识别。先旋转、裁去无关边缘，再识别并人工核对。首次需下载约 10 MB 资源，不是发票验真。</p><p><a href="./samples/demo-invoice.pdf" download="轻报虚构PDF样票.pdf">下载虚构PDF样票（第2页为发票）</a></p>${pdfPageControl("ocr")}<div class="ocr-buttons"><button type="button" id="ocr-start">识别所选文件</button><button type="button" id="ocr-sample">载入虚构样票</button><button type="button" id="ocr-cancel" hidden>取消识别</button></div><p id="ocr-status" role="status" aria-live="polite">选择图片后可预览和调整，也可以直接体验虚构样票。</p><progress id="ocr-progress" max="100" value="0" hidden aria-label="识别进度"></progress><div id="ocr-editor" hidden><div class="image-toolbar"><button type="button" id="image-left" aria-label="向左旋转90度">↶ 左转 90°</button><button type="button" id="image-right" aria-label="向右旋转90度">↷ 右转 90°</button><button type="button" id="image-reset">恢复原图</button><span id="image-angle"></span></div><canvas id="ocr-canvas" aria-label="旋转裁剪后的识别范围预览" role="img"></canvas><details class="crop-tools"><summary>裁剪无关边缘（按旋转后的图片计算）</summary><div class="crop-grid">${[
    ["left", "左"],
    ["top", "上"],
    ["right", "右"],
    ["bottom", "下"],
  ]
    .map(
      ([k, t]) =>
        `<label>${t}侧裁去 <output id="crop-${k}-value">0%</output><input id="crop-${k}" type="range" min="0" max="40" step="1" value="0" aria-label="${t}侧裁剪百分比"></label>`,
    )
    .join(
      "",
    )}</div><small>每侧最多裁去 40%，请保留完整号码、金额及其文字标签。仅影响本次识别，不修改原文件。</small></details></div><div id="ocr-result"></div></section>`;
export function mountOcr(
  form,
  { onApply = () => {}, onSample = () => {}, onInvalidate = () => {} } = {},
) {
  let job = null,
    source = null,
    settings = defaultImageSettings(),
    disposed = false,
    generation = 0,
    previewVersion = 0,
    previewTimer = null,
    sampleFetch = null,
    pdfPreview = null;
  const panel = form.querySelector(".ocr-panel"),
    input = form.querySelector("[name=receipt]"),
    status = form.querySelector("#ocr-status"),
    result = form.querySelector("#ocr-result"),
    editor = form.querySelector("#ocr-editor"),
    canvas = form.querySelector("#ocr-canvas");
  const start = form.querySelector("#ocr-start"),
    sample = form.querySelector("#ocr-sample"),
    cancel = form.querySelector("#ocr-cancel"),
    progress = form.querySelector("#ocr-progress");
  const localFile = location.protocol === "file:";
  const busy = (state) => {
    start.disabled = state || localFile;
    sample.disabled = state || localFile;
    cancel.hidden = !state;
    progress.hidden = !state;
    form.querySelector("#ocr-pdf-page").disabled = state;
    editor
      .querySelectorAll("button,input")
      .forEach((el) => (el.disabled = state));
  };
  const invalidate = () => {
    generation++;
    job?.cancel();
    job = null;
    busy(false);
    result.innerHTML = "";
    onInvalidate();
  };
  const resetPreview = () => {
    previewVersion++;
    pdfPreview?.cancel();
    pdfPreview = null;
    clearTimeout(previewTimer);
    canvas.width = 1;
    canvas.height = 1;
    editor.hidden = true;
  };
  const syncControls = () => {
    form.querySelector("#image-angle").textContent = settings.rotation
      ? `已顺时针旋转 ${settings.rotation}°`
      : "原图方向";
    for (const [k, v] of Object.entries(settings.crop)) {
      form.querySelector("#crop-" + k).value = v;
      form.querySelector("#crop-" + k + "-value").textContent = v + "%";
    }
  };
  const preview = async () => {
    const current = ++previewVersion;
    try {
      pdfPreview?.cancel();
      let rendered;
      if (isPdf(source)) {
        pdfPreview = startPdfRender(
          source,
          {
            ...settings,
            pdfPage: Number(form.querySelector("#ocr-pdf-page").value),
          },
          1200,
        );
        const pdf = await pdfPreview.promise;
        rendered = pdf.canvas;
        if (current === previewVersion) {
          form.querySelector("#ocr-pdf-page").max = pdf.numPages;
          form.querySelector("#ocr-pdf-info").textContent =
            `共${pdf.numPages}页，当前第${pdf.page}页；仅识别这一页。多票请拆分后留存原件。`;
        }
      } else rendered = await renderInvoiceImage(source, settings, 1200);
      if (disposed || current !== previewVersion) {
        rendered.width = 1;
        rendered.height = 1;
        return;
      }
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      canvas.getContext("2d").drawImage(rendered, 0, 0);
      rendered.width = 1;
      rendered.height = 1;
      editor.hidden = false;
      syncControls();
    } catch (e) {
      if (!disposed && current === previewVersion) {
        editor.hidden = true;
        status.textContent =
          "无法预览：" + (e.message || "请使用清晰有效的图片，也可手工填写");
      }
    }
  };
  const select = async (file) => {
    invalidate();
    resetPreview();
    const selectedGeneration = generation;
    source = file;
    settings = defaultImageSettings();
    form.querySelector("#ocr-pdf-page").value = 1;
    form.querySelector("#ocr-pdf-page").max = 20;
    form.querySelector("#ocr-pdf-controls").hidden = !isPdf(file);
    syncControls();
    try {
      checkOcrFile(source);
      status.textContent = localFile
        ? "本地单文件不支持 OCR，请用在线版；仍可手工填写。"
        : isPdf(source)
          ? "PDF已选择，正在读取第一页预览…"
          : "图片已就绪，可旋转、裁剪后识别，或直接识别";
      await preview();
      if (disposed || selectedGeneration !== generation) return;
      if (isPdf(source) && !editor.hidden)
        status.textContent = "PDF预览已就绪，请选页并核对后识别";
    } catch (e) {
      if (disposed || selectedGeneration !== generation) return;
      status.textContent = e.message;
    }
    form.dataset.dirty = "true";
  };
  input.addEventListener("change", () => {
    sampleFetch?.abort();
    void select(input.files?.[0]);
  });
  const changeImage = () => {
    invalidate();
    syncControls();
    status.textContent = "图片已调整，请重新识别并核对；原表单字段保持不变";
    clearTimeout(previewTimer);
    previewVersion++;
    previewTimer = setTimeout(() => void preview(), 120);
    form.dataset.dirty = "true";
  };
  form.querySelector("#ocr-pdf-page").oninput = () => {
    changeImage();
    status.textContent =
      "PDF页码已变化，请核对新预览并重新识别；原表单保持不变";
  };
  form.querySelector("#image-left").onclick = () => {
    settings.rotation = (settings.rotation + 270) % 360;
    settings.crop = defaultImageSettings().crop;
    changeImage();
  };
  form.querySelector("#image-right").onclick = () => {
    settings.rotation = (settings.rotation + 90) % 360;
    settings.crop = defaultImageSettings().crop;
    changeImage();
  };
  form.querySelector("#image-reset").onclick = () => {
    settings = defaultImageSettings();
    changeImage();
  };
  for (const key of ["left", "top", "right", "bottom"])
    form.querySelector("#crop-" + key).addEventListener("input", (e) => {
      settings.crop[key] = Number(e.target.value);
      changeImage();
    });
  const renderResult = (data) => {
    const missing = [
      !data.invoice ? "号码" : "",
      !data.amount ? "金额" : "",
    ].filter(Boolean);
    status.textContent = !data.text.trim()
      ? "没有识别到文字。请旋正图片、保留标签并裁去背景，或手工填写。"
      : missing.length
        ? `识别完成，未能确定${missing.join("和")}。可调整图片重试，或在候选区手工补充。`
        : "识别完成，请对照预览核对后再应用。";
    result.innerHTML = `<div class="ocr-candidates"><h3>待核对的候选字段</h3><div class="form-grid"><label>发票号码候选<input id="ocr-invoice" value="${escape(data.invoice)}" maxlength="40" placeholder="未提取到，可手工补充"></label><label>价税合计候选（元）<input id="ocr-amount" value="${escape(data.amount)}" type="number" min="0.01" max="1000000" step="0.01" placeholder="未提取到"></label></div><div class="form-grid">${[
      ["buyerName", "购买方名称"],
      ["buyerTaxId", "购买方税号"],
      ["sellerName", "销售方名称"],
      ["sellerTaxId", "销售方税号"],
      ["date", "开票日期"],
      ["code", "发票代码"],
      ["netAmount", "不含税金额"],
      ["taxAmount", "税额"],
    ]
      .map(
        ([key, label]) =>
          `<label>${label}候选<input id="ocr-${key}" value="${escape(data.structured?.[key] || "")}" maxlength="100" placeholder="未可靠提取，可手工补充"></label>`,
      )
      .join(
        "",
      )}</div><small>文本置信度 ${Math.round(data.confidence || 0)} / 100（参考值，不代表字段准确率）。空字段不覆盖表单；未提取到不等于无效发票。</small><details><summary>查看识别原文</summary><pre>${escape(data.text || "未识别到文字")}</pre></details><label class="check-line"><input type="checkbox" id="ocr-confirm">我已对照原件核对，确认替换表单中的非空候选字段</label><button type="button" id="ocr-apply">确认并填入报销单</button></div>`;
    result.querySelector("#ocr-apply").onclick = () => {
      const invoice = result.querySelector("#ocr-invoice").value.trim(),
        amount = result.querySelector("#ocr-amount").value;
      if (!result.querySelector("#ocr-confirm").checked) {
        status.textContent = "请先对照原件核对并勾选确认";
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
      const structured = { ...data.structured, number: invoice, amount };
      for (const key of [
        "buyerName",
        "buyerTaxId",
        "sellerName",
        "sellerTaxId",
        "date",
        "code",
        "netAmount",
        "taxAmount",
      ])
        structured[key] = result.querySelector("#ocr-" + key).value.trim();
      onApply({
        invoice: !!invoice,
        amount: !!amount,
        structured,
        sourceName: data.sourceName,
      });
      form.dispatchEvent(new Event("input", { bubbles: true }));
      status.textContent = "已填入核对后的字段，仍需填写用途并手工提交";
      result.innerHTML = "";
    };
  };
  const run = async () => {
    invalidate();
    const current = generation;
    pdfPreview?.cancel();
    clearTimeout(previewTimer);
    previewVersion++;
    try {
      source = input.files?.[0] || source;
      checkOcrFile(source);
      busy(true);
      status.textContent = "正在准备本地识别引擎与语言数据…";
      progress.value = 0;
      job = startRecognition(
        source,
        (m) => {
          if (disposed || current !== generation) return;
          const text = m.status === "recognizing text";
          progress.value = text ? Math.round(m.progress * 100) : 0;
          status.textContent = text
            ? `正在识别文字 ${Math.round(m.progress * 100)}%`
            : m.status === "reading pdf"
              ? `正在读取PDF第${m.page}页…`
              : "正在准备引擎与语言数据，首次加载较慢…";
        },
        {
          ...structuredClone(settings),
          pdfPage: Number(form.querySelector("#ocr-pdf-page").value),
        },
      );
      const data = await job.promise;
      if (!disposed && current === generation)
        renderResult({
          ...data,
          sourceName: isPdf(source)
            ? `${source.name.slice(0, 100)}（PDF第${form.querySelector("#ocr-pdf-page").value}页）`
            : source.name,
        });
    } catch (e) {
      if (!disposed && current === generation) {
        status.textContent =
          "识别未完成：" +
          (e.message ||
            "加载或图片处理失败，请检查网络、调整图片后重试，或手工填写");
        result.innerHTML = "";
      }
    } finally {
      if (!disposed && current === generation) {
        busy(false);
        job = null;
      }
    }
  };
  start.onclick = () => void run();
  cancel.onclick = () => {
    invalidate();
    status.textContent = "已取消识别，可调整图片或继续手工填写";
    start.focus();
  };
  sample.onclick = async () => {
    const current = generation;
    sample.disabled = true;
    sampleFetch = new AbortController();
    try {
      const response = await fetch(
        new URL("./samples/demo-invoice.png", document.baseURI),
        { signal: sampleFetch.signal },
      );
      if (!response.ok) throw Error("样票加载失败");
      const blob = await response.blob();
      if (disposed || current !== generation) return;
      const file = new File([blob], "轻报虚构样票.png", { type: "image/png" }),
        dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      await select(file);
      if (disposed || source !== file) return;
      onSample(file.name);
      await run();
    } catch (e) {
      if (!disposed && e.name !== "AbortError")
        status.textContent =
          "样票加载失败，请检查网络或选择自己的虚构图片，也可手工填写";
    } finally {
      sampleFetch = null;
      if (!disposed && !job) sample.disabled = localFile;
    }
  };
  const dispose = () => {
    disposed = true;
    generation++;
    previewVersion++;
    clearTimeout(previewTimer);
    sampleFetch?.abort();
    pdfPreview?.cancel();
    job?.cancel();
    canvas.width = 1;
    canvas.height = 1;
    observer.disconnect();
  };
  const observer = new MutationObserver(() => {
    if (!panel.isConnected) dispose();
  });
  observer.observe(document.querySelector("#overlay"), {
    childList: true,
    subtree: true,
  });
  busy(false);
  if (localFile)
    status.textContent =
      "本地单文件不能加载 OCR 资源，请打开在线版；仍可手工填写。";
  return dispose;
}
