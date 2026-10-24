import {
  isPdf,
  startPdfRender,
  pdfPageControl,
  pdfSourceName,
} from "./pdf-tools.js";
import { fileCard, bindAttachmentDetails } from "./attachments-ui.js";
import { startRecognition, checkOcrFile } from "./ocr.js";
import {
  emptyInvoices,
  invoiceRecord,
  validateInvoices,
  validateInvoiceAttachments,
  invoiceTextFields,
  effectiveInvoiceBuyer,
  buyerComparison,
  invoiceTotal,
} from "./invoice-data.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  n === null || n === undefined ? "未采集" : `¥${Number(n).toFixed(2)}`;
const fields = [
  ...invoiceTextFields,
  ["amount", "价税合计（元）", 20],
  ["netAmount", "不含税金额（元，可空）", 20],
  ["taxAmount", "税额（元，可空）", 20],
];
function recordHTML(r, buyer, editable = false, attachments = []) {
  const original = attachments.find((f) => f.id === r.attachmentId);
  const match = buyerComparison(r, buyer);
  return `<article class="invoice-data-card"><h4>发票 ${esc(r.number)}</h4><div class="invoice-data-grid"><p>购买方<b>${esc(r.buyerName || "未采集")}</b><small>${esc(r.buyerTaxId || "税号未采集")}</small></p><p>销售方<b>${esc(r.sellerName || "未采集")}</b><small>${esc(r.sellerTaxId || "税号未采集")}</small></p><p>开票日期<b>${esc(r.date || "未采集")}</b><small>代码 ${esc(r.code || "未采集")}</small></p><p>价税合计<b>${money(r.amount)}</b><small>不含税 ${money(r.netAmount)} / 税额 ${money(r.taxAmount)}</small></p></div><p class="${match.name === "抬头一致" ? "safe" : "risk"}">${esc(match.name)} · ${esc(match.tax)}</p><small>${r.capture.method === "ocr-assisted" ? "OCR辅助后人工核对" : "手工核对录入"} · ${esc(r.capture.at)}<br>来源 ${esc(r.capture.sourceName || "手工输入")}；不代表税务验真。</small>${original ? `<div class="invoice-original"><b>关联原件：${esc(original.name)}</b>${editable ? "" : fileCard(original)}</div>` : `<p class="footnote">${r.attachmentId ? "原件引用异常，请恢复有效备份" : "未关联原件；来源名称不等于原文件已留存"}</p>`}${editable ? `<div class="enterprise-buttons"><button type="button" data-invoice-edit="${esc(r.id)}">编辑票面字段</button><button type="button" data-invoice-remove="${esc(r.id)}">移除此票据</button></div>` : ""}</article>`;
}
export function invoiceEditor() {
  return `<section class="review-box invoice-data-editor"><h3>结构化发票采集（报销 / 对公）</h3><p>每单最多5张，仅人民币正数发票；红票和外币暂不支持。图片和PDF在本浏览器OCR，人工核对后存字段；也可手工录入。PDF支持预览、选页后识别，最多20页、6 MB，扫描版与电子版均可；每次仅识别所选一页。要保留原件，请先在上方附件区上传并分类为“发票”，再在下方选择关联。直接选文件识别仅存字段；附件留存仍限单份1 MB。每个原件限关联一张票面，多票PDF请拆分后上传。</p><p id="invoice-buyer-basis"></p><div class="enterprise-buttons"><label>本次发票图片 / PDF<input id="invoice-image-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"></label><button type="button" id="invoice-image-read">识别票面字段</button><button type="button" id="invoice-image-sample">载入结构化虚构样票</button><button type="button" id="invoice-image-cancel" hidden>取消识别</button></div><p><a href="./samples/demo-invoice.pdf" download="轻报虚构PDF样票.pdf">下载虚构PDF样票（第2页为发票）</a></p>${pdfPageControl("invoice")}<canvas id="invoice-pdf-canvas" hidden aria-label="所选PDF页预览" role="img" style="max-width:100%;height:auto"></canvas><label>关联本单已保留的发票原件<select id="invoice-attachment"><option value="">不关联（仅保存字段）</option></select></label><button type="button" id="invoice-attachment-read">从关联原件识别票面</button><p class="footnote">关联图片及PDF均可在本地识别，原文件不上传。PDF按所选页采集；每个原件仍限一张票面，多票文件请拆分。</p><p id="invoice-data-status" role="status" aria-live="polite"></p><details id="invoice-candidate-editor" open><summary>待人工核对的票面字段</summary><div class="form-grid">${fields.map(([key, label, max]) => `<label>${label}<input data-invoice-field="${key}" maxlength="${max}" ${["amount", "netAmount", "taxAmount"].includes(key) ? 'type="number" min="0" max="1000000" step="0.01"' : key === "date" ? 'type="date"' : 'type="text"'}></label>`).join("")}</div><p id="invoice-candidate-check"></p><details><summary>本次OCR原文（关闭后不保存）</summary><pre id="invoice-raw-text" class="contract-text"></pre></details><label class="check-line"><input type="checkbox" id="invoice-data-confirm">我已对照发票核对这些字段；识别及一致性比对不代表真伪核验</label><div class="enterprise-buttons"><button type="button" id="invoice-data-add">确认并加入票据清单</button><button type="button" id="invoice-data-clear">清空本次候选</button></div></details><p id="invoice-data-summary"></p><div id="invoice-data-records"></div></section>`;
}
export function mountInvoiceEditor(
  form,
  initial,
  policy,
  { getAmount = () => 0, onChange = () => {}, getAttachments = () => [] } = {},
) {
  let bundle = structuredClone(initial || emptyInvoices()),
    job = null,
    generation = 0,
    busy = false,
    editing = "",
    method = "manual",
    sourceName = "",
    sampleFetch = null,
    pdfFile = null,
    pdfAttachmentId = "";
  validateInvoices(bundle);
  const buyer = effectiveInvoiceBuyer(policy),
    root = form.querySelector(".invoice-data-editor"),
    status = root.querySelector("#invoice-data-status"),
    list = root.querySelector("#invoice-data-records"),
    inputs = [...root.querySelectorAll("[data-invoice-field]")],
    image = root.querySelector("#invoice-image-input"),
    original = root.querySelector("#invoice-attachment");
  const syncAttachments = () => {
    const id = original.value;
    original.innerHTML =
      `<option value="">不关联（仅保存字段）</option>` +
      getAttachments()
        .filter((f) => f.kind === "发票")
        .map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`)
        .join("");
    original.value = id;
    if (!original.value) original.value = "";
  };
  syncAttachments();
  root.querySelector("#invoice-buyer-basis").textContent =
    `财务核对基准：${buyer.name}；税号 ${buyer.taxId || "尚未配置，仅核对抬头"}。申请人不能修改此基准。`;
  const read = () =>
    Object.fromEntries(inputs.map((i) => [i.dataset.invoiceField, i.value]));
  const candidate = () => {
    const d = read();
    const c = buyerComparison(d, buyer);
    root.querySelector("#invoice-candidate-check").textContent =
      `待确认候选：${c.name} / ${c.tax}。候选未加入前不参与正式预审。`;
  };
  const refresh = () => {
    root.querySelector("#invoice-data-summary").textContent =
      `已确认 ${bundle.records.length} 张 / 票面合计 ${money(invoiceTotal(bundle))} / 当前申请 ${money(Number(getAmount()) || 0)}。金额不同需核对分期、拆分或漏票，不自动修改申请金额。`;
    list.innerHTML =
      bundle.records
        .map((r) => recordHTML(r, buyer, true, getAttachments()))
        .join("") ||
      "<small>尚未采集结构化票据；旧号码和名称不会自动变成已核对票面数据。</small>";
    bindAttachmentDetails(list, getAttachments());
    candidate();
  };
  const changed = () => {
    form.dataset.dirty = "true";
    onChange();
  };
  const cancel = () => {
    generation++;
    job?.cancel();
    job = null;
    busy = false;
    root.querySelector("#invoice-image-cancel").hidden = true;
    root.querySelector("#invoice-image-read").disabled = false;
    root.querySelector("#invoice-image-sample").disabled = false;
    root.querySelector("#invoice-pdf-page").disabled = false;
  };
  const clear = () => {
    inputs.forEach((i) => (i.value = ""));
    editing = "";
    original.value = "";
    method = "manual";
    sourceName = "";
    root.querySelector("#invoice-data-confirm").checked = false;
    root.querySelector("#invoice-raw-text").textContent = "";
    root.querySelector("#invoice-data-add").textContent = "确认并加入票据清单";
    candidate();
  };
  const addRecord = (r, id = "") => {
    const next = {
      schema: 1,
      records: id
        ? bundle.records.map((x) => (x.id === id ? r : x))
        : [...bundle.records, r],
    };
    validateInvoiceAttachments(next, getAttachments());
    bundle = next;
    refresh();
    changed();
  };
  inputs.forEach(
    (i) =>
      (i.oninput = () => {
        root.querySelector("#invoice-data-confirm").checked = false;
        candidate();
        form.dataset.dirty = "true";
      }),
  );
  root.querySelector("#invoice-data-add").onclick = () => {
    try {
      if (busy) throw Error("识别尚未完成，请等待或取消");
      if (!root.querySelector("#invoice-data-confirm").checked)
        throw Error("请先对照发票核对并勾选确认");
      addRecord(
        invoiceRecord(
          { ...read(), attachmentId: original.value },
          method,
          sourceName,
          editing,
        ),
        editing,
      );
      clear();
      status.textContent =
        "票面字段已加入本次清单，保存单据后持久化。申请金额未改动。";
    } catch (e) {
      status.textContent = e.message;
    }
  };
  root.querySelector("#invoice-data-clear").onclick = () => {
    cancel();
    clear();
    void previewPdf(null);
    status.textContent = "已清空本次未保存候选，已确认清单保留。";
  };
  list.onclick = (e) => {
    const edit = e.target.closest("[data-invoice-edit]"),
      remove = e.target.closest("[data-invoice-remove]");
    if (edit) {
      cancel();
      void previewPdf(null);
      root.querySelector("#invoice-raw-text").textContent = "";
      const r = bundle.records.find((r) => r.id === edit.dataset.invoiceEdit);
      inputs.forEach((i) => (i.value = r[i.dataset.invoiceField] ?? ""));
      editing = r.id;
      syncAttachments();
      original.value = r.attachmentId || "";
      method = "manual";
      sourceName = r.capture.sourceName;
      root.querySelector("#invoice-data-confirm").checked = false;
      root.querySelector("#invoice-data-add").textContent =
        "确认并保存票面修订";
      root.querySelector("#invoice-candidate-editor").open = true;
      candidate();
    }
    if (remove) {
      const id = remove.dataset.invoiceRemove;
      if (
        initial?.records.some((r) => r.id === id) &&
        !confirm("移除此已保存票面记录？本次单据保存后生效，请先保留备份。")
      )
        return;
      bundle = {
        schema: 1,
        records: bundle.records.filter((r) => r.id !== id),
      };
      if (editing === id) clear();
      refresh();
      changed();
    }
  };
  const pdfPage = root.querySelector("#invoice-pdf-page"),
    pdfCanvas = root.querySelector("#invoice-pdf-canvas"),
    pdfControls = root.querySelector("#invoice-pdf-controls");
  async function previewPdf(file, attachmentId = "", resetPage = true) {
    cancel();
    pdfFile = isPdf(file) ? file : null;
    pdfAttachmentId = attachmentId;
    pdfControls.hidden = !pdfFile;
    pdfCanvas.hidden = true;
    pdfCanvas.width = pdfCanvas.height = 1;
    if (resetPage) {
      pdfPage.value = 1;
      pdfPage.max = 20;
    }
    if (!pdfFile) return;
    const token = generation;
    try {
      checkOcrFile(file);
      status.textContent = "正在读取PDF预览…";
      job = startPdfRender(file, { pdfPage: Number(pdfPage.value) }, 1200);
      const pdf = await job.promise;
      if (token !== generation || !root.isConnected) {
        pdf.canvas.width = pdf.canvas.height = 1;
        return;
      }
      pdfCanvas.width = pdf.canvas.width;
      pdfCanvas.height = pdf.canvas.height;
      pdfCanvas.getContext("2d").drawImage(pdf.canvas, 0, 0);
      pdf.canvas.width = pdf.canvas.height = 1;
      pdfCanvas.hidden = false;
      pdfPage.max = pdf.numPages;
      root.querySelector("#invoice-pdf-info").textContent =
        `共${pdf.numPages}页，当前第${pdf.page}页；每次识别这一页，不合并金额。`;
      status.textContent = "PDF预览已就绪，请核对页码后点击识别。";
    } catch (e) {
      if (token === generation && root.isConnected)
        status.textContent = "PDF预览未完成：" + e.message + "；可手工填写。";
    } finally {
      if (token === generation) job = null;
    }
  }
  pdfPage.oninput = () => {
    const file = pdfFile,
      id = pdfAttachmentId;
    clear();
    original.value = id;
    void previewPdf(file, id, false);
    form.dataset.dirty = "true";
  };
  async function recognize(file, attachmentId = "") {
    cancel();
    const token = generation;
    try {
      checkOcrFile(file);
      busy = true;
      root.querySelector("#invoice-image-cancel").hidden = false;
      root.querySelector("#invoice-image-read").disabled = true;
      root.querySelector("#invoice-image-sample").disabled = true;
      pdfPage.disabled = true;
      status.textContent = "正在加载本地OCR，请等待…";
      job = startRecognition(
        file,
        (m) => {
          if (token === generation && root.isConnected)
            status.textContent =
              m.status === "recognizing text"
                ? `正在识别 ${Math.round(m.progress * 100)}%`
                : m.status === "reading pdf"
                  ? `正在读取PDF第${m.page}页…`
                  : "正在准备本地引擎与语言资源…";
        },
        { pdfPage: Number(pdfPage.value) },
      );
      const result = await job.promise;
      if (token !== generation || !root.isConnected) return;
      clear();
      inputs.forEach(
        (i) => (i.value = result.structured?.[i.dataset.invoiceField] ?? ""),
      );
      method = "ocr-assisted";
      sourceName = pdfSourceName(file, Number(pdfPage.value));
      original.value = attachmentId;
      root.querySelector("#invoice-raw-text").textContent = result.text;
      root.querySelector("#invoice-candidate-editor").open = true;
      candidate();
      status.textContent =
        "识别完成。请对照原件补齐/修正候选并确认；空字段表示未可靠提取，不表示核验通过。";
      form.dataset.dirty = "true";
    } catch (e) {
      if (token === generation && root.isConnected)
        status.textContent = "识别未完成：" + e.message + "；可手工填写。";
    } finally {
      if (token === generation && root.isConnected) {
        busy = false;
        job = null;
        root.querySelector("#invoice-image-cancel").hidden = true;
        root.querySelector("#invoice-image-read").disabled = false;
        root.querySelector("#invoice-image-sample").disabled = false;
        pdfPage.disabled = false;
      }
    }
  }
  original.onchange = () => {
    cancel();
    method = "manual";
    sourceName =
      getAttachments().find((f) => f.id === original.value)?.name || "";
    root.querySelector("#invoice-raw-text").textContent = "";
    root.querySelector("#invoice-data-confirm").checked = false;
    form.dataset.dirty = "true";
    const f = getAttachments().find((f) => f.id === original.value);
    const file = f ? attachmentFile(f) : null;
    void previewPdf(file, f?.id || "");
  };
  function attachmentFile(f) {
    const bytes = Uint8Array.from(atob(f.data.split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    return new File([bytes], f.name, { type: f.type });
  }
  root.querySelector("#invoice-attachment-read").onclick = () => {
    const f = getAttachments().find(
      (f) => f.id === original.value && f.kind === "发票",
    );
    if (!f) {
      status.textContent = "请选择本单已保留且分类为发票的图片或PDF。";
      return;
    }
    void recognize(attachmentFile(f), f.id);
  };
  image.onchange = () => {
    cancel();
    clear();
    candidate();
    status.textContent = "文件已选择，点击识别；也可直接手工录入。";
    void previewPdf(image.files[0]);
  };
  root.querySelector("#invoice-image-read").onclick = () =>
    void recognize(image.files[0]);
  root.querySelector("#invoice-image-cancel").onclick = () => {
    cancel();
    status.textContent = "已取消识别，已确认清单保留，可手工填写。";
  };
  root.querySelector("#invoice-image-sample").onclick = async () => {
    cancel();
    const token = generation;
    sampleFetch?.abort();
    sampleFetch = new AbortController();
    try {
      const response = await fetch(
        new URL("./samples/structured-invoice.png", document.baseURI),
        { signal: sampleFetch.signal },
      );
      if (!response.ok) throw Error("样票加载失败");
      const file = new File([await response.blob()], "结构化虚构发票.png", {
        type: "image/png",
      });
      if (root.isConnected && token === generation) await recognize(file);
    } catch (e) {
      if (e.name !== "AbortError" && root.isConnected)
        status.textContent = "样票加载失败，可选图或手工填写。";
    }
  };
  form.addEventListener("input", () => {
    root.querySelector("#invoice-data-summary").textContent =
      `已确认 ${bundle.records.length} 张 / 票面合计 ${money(invoiceTotal(bundle))} / 当前申请 ${money(Number(getAmount()) || 0)}`;
  });
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      cancel();
      sampleFetch?.abort();
      pdfCanvas.width = pdfCanvas.height = 1;
      observer.disconnect();
    }
  });
  observer.observe(document.querySelector("#overlay"), {
    childList: true,
    subtree: true,
  });
  refresh();
  return {
    read: () => structuredClone(bundle),
    refreshAttachments: () => {
      syncAttachments();
      refresh();
    },
    isLinked: (id) =>
      original.value === id ||
      bundle.records.some((r) => r.attachmentId === id),
    isBusy: () => busy,
    isPending: () =>
      !!editing || !!original.value || inputs.some((i) => i.value.trim()),
    addFromOcr: (values, name) => {
      addRecord(invoiceRecord(values, "ocr-assisted", name));
      status.textContent =
        "快速OCR的核对字段已加入结构化清单，保存报销后保留。";
    },
  };
}
export function invoiceDetails(bundle, policy, attachments = []) {
  if (!bundle?.records?.length) return "";
  return `<section class="review-box invoice-data-details"><h3>结构化发票（${bundle.records.length} 张）</h3><p>票面合计 ${money(invoiceTotal(bundle))}；核对基准 ${esc(effectiveInvoiceBuyer(policy).name)}。与申请金额分开显示；未接税务验真。</p>${bundle.records.map((r) => recordHTML(r, effectiveInvoiceBuyer(policy), false, attachments)).join("")}<p class="footnote">字段JSON只含原件引用；完整备份才包含原文件。</p><button type="button" data-invoice-json>下载本单票面数据 JSON</button></section>`;
}
export function bindInvoiceDetails(root, bundle) {
  root.querySelector("[data-invoice-json]")?.addEventListener("click", () => {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "轻报-结构化票面数据.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
export function structuredInvoiceView(rows) {
  return `<section class="panel invoice-structured-ledger"><div class="panel-title"><div><h3>票面结构化台账</h3><p>来自已人工核对的采集字段；票面金额与申请金额分列，不代表税务验真。CSV对数字号码加文本前缀防止Excel丢精度，JSON保留原始字段。</p></div><button id="structured-invoice-export">导出票面字段 CSV</button></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>发票号码 / 日期</th><th>购买方 / 税号</th><th>销售方</th><th>票面合计 / 税额</th><th>关联单据 / 申请金额</th><th>重复线索</th><th>操作</th></tr></thead><tbody>${rows.map(({ kind, doc, record: r, duplicate }) => `<tr><td>${esc(r.number)}<small>${esc(r.date || "未采集日期")}</small></td><td>${esc(r.buyerName || "未采集")}<small>${esc(r.buyerTaxId || "未采集税号")}</small></td><td>${esc(r.sellerName || "未采集")}</td><td>${money(r.amount)}<small>税额 ${money(r.taxAmount)}</small></td><td>${kind === "expense" ? "报销" : "对公"} ${esc(doc.name)}<small>${esc(doc.id)} / ${money(doc.amount)}</small></td><td>${duplicate ? "疑似重复" : "未发现号码重复"}</td><td><button class="link" data-structured-open="${esc(doc.id)}" data-structured-kind="${kind}">查看单据</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="empty">暂无匹配的结构化票据。旧附件名称与号码不会自动补造抬头和票面金额。</p>'}</section>`;
}
