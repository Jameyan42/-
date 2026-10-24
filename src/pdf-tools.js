import { renderInvoiceBitmap, defaultImageSettings } from "./image-tools.js";

export const MAX_PDF_PAGES = 20;
export const isPdf = (file) => file?.type === "application/pdf";
export function validatePdfPage(page) {
  if (!Number.isInteger(page) || page < 1 || page > MAX_PDF_PAGES)
    throw Error(`请选择1～${MAX_PDF_PAGES}之间的PDF页码`);
  return page;
}
export function pdfSourceName(file, page = 1) {
  return isPdf(file)
    ? `${file.name.slice(0, 100)}（PDF第${validatePdfPage(page)}页）`
    : file.name;
}

// Only local bytes enter PDF.js; PDF actions, scripts and attachments are never run.
export function startPdfRender(
  file,
  settings = defaultImageSettings(),
  maxEdge = 2200,
) {
  let loading,
    rendering,
    canvas,
    timer,
    cancelled = false,
    rejectCancel;
  const cancellation = new Promise((_, reject) => {
    rejectCancel = reject;
  });
  const cancel = (message = "已取消PDF读取") => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timer);
    rendering?.cancel();
    if (loading) void loading.destroy().catch(() => {});
    rejectCancel(Error(message));
  };
  const work = (async () => {
    try {
      const pageNumber = validatePdfPage(settings.pdfPage ?? 1);
      if (!isPdf(file) || !file.size || file.size > 6 * 1024 * 1024)
        throw Error("请选择6 MB以内的非空PDF");
      if (location.protocol === "file:")
        throw Error("请打开在线版识别PDF，本地单文件仍可手工填写");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-")
        throw Error("PDF文件无效或已损坏，请重新导出PDF");
      const base = new URL("./ocr/pdfjs/", document.baseURI).href;
      const pdfjs = await import(/* @vite-ignore */ base + "pdf.mjs");
      if (cancelled) throw Error("已取消PDF读取");
      pdfjs.GlobalWorkerOptions.workerSrc = base + "pdf.worker.mjs";
      loading = pdfjs.getDocument({
        data: bytes,
        cMapUrl: base + "cmaps/",
        cMapPacked: true,
        standardFontDataUrl: base + "standard_fonts/",
        wasmUrl: base + "wasm/",
        isEvalSupported: false,
        enableXfa: false,
      });
      loading.onPassword = () =>
        cancel("PDF已加密，请先自行解密后重试，或手工填写");
      const doc = await loading.promise;
      if (cancelled) throw Error("已取消PDF读取");
      if (doc.numPages > MAX_PDF_PAGES)
        throw Error(
          `PDF共${doc.numPages}页，最多支持${MAX_PDF_PAGES}页；请拆分后重试`,
        );
      if (pageNumber > doc.numPages)
        throw Error(`PDF只有${doc.numPages}页，请修改页码`);
      const page = await doc.getPage(pageNumber);
      if (cancelled) throw Error("已取消PDF读取");
      const natural = page.getViewport({ scale: 1 });
      if (
        ![natural.width, natural.height].every(
          (x) => Number.isFinite(x) && x > 0,
        )
      )
        throw Error("PDF页面尺寸无效");
      // Bound the raster before allocating; no huge source bitmap or PDF text upload.
      const viewport = page.getViewport({
        scale: Math.min(3, 2200 / Math.max(natural.width, natural.height)),
      });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      rendering = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        background: "rgb(255,255,255)",
      });
      await rendering.promise;
      if (cancelled) throw Error("已取消PDF读取");
      return {
        canvas: renderInvoiceBitmap(canvas, settings, maxEdge),
        numPages: doc.numPages,
        page: pageNumber,
      };
    } catch (e) {
      if (e.name === "InvalidPDFException" || e.name === "MissingPDFException")
        throw Error("PDF文件无效或已损坏，请重新导出或手工填写");
      throw e;
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      if (loading) await loading.destroy().catch(() => {});
    }
  })();
  timer = setTimeout(
    () => cancel("PDF读取超时，请拆分或压缩后重试，或手工填写"),
    30000,
  );
  return {
    promise: Promise.race([work, cancellation]).finally(() =>
      clearTimeout(timer),
    ),
    cancel,
  };
}

export const pdfPageControl = (prefix) =>
  `<div id="${prefix}-pdf-controls" hidden><label>PDF识别页码<input id="${prefix}-pdf-page" type="number" min="1" max="20" step="1" value="1"></label><small id="${prefix}-pdf-info">每次识别所选一页，不合并多页金额；最多20页、6 MB。多张票据请拆分后留存原件。</small></div>`;
