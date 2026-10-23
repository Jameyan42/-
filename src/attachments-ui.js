import {
  attachmentKinds,
  readAttachment,
  addAttachments,
  validateAttachments,
} from "./attachments.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const options = (kind) =>
  attachmentKinds
    .map((k) => `<option ${k === kind ? "selected" : ""}>${k}</option>`)
    .join("");
export function attachmentEditor() {
  return `<section class="review-box attachment-editor"><h3>报销附件 / 证明材料</h3><label>本次上传材料类型<select id="attachment-kind">${options("酒店水单")}</select></label><label>添加文件（可多选）<input id="attachments-upload" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp"></label><p class="footnote">最多5个，单个1 MB、每单合计1.5 MB。原文件保存在当前浏览器，备份包含文件；清理浏览器数据会丢失。图片可预览，PDF下载后查看。只有“发票”类附件参与发票附件完整性检查，证明材料不替代发票。</p><p id="attachments-status" role="status" aria-live="polite"></p><div id="attachment-list"></div></section>`;
}
function fileCard(f, editable) {
  return `<article class="attachment-card" data-attachment-id="${esc(f.id)}"><p><b>${esc(f.name)}</b> · ${(f.size / 1024).toFixed(1)} KB · ${esc(f.kind)}</p>${editable ? `<label>材料分类<select data-attachment-kind="${esc(f.id)}">${options(f.kind)}</select></label>` : ""}${f.type.startsWith("image/") ? `<details><summary>预览图片</summary><img class="attachment-image" src="${esc(f.data)}" alt="${esc(f.name)}" loading="lazy"></details>` : "<small>PDF：下载后使用浏览器或阅读器查看。</small>"}<p><button type="button" class="link" data-attachment-download="${esc(f.id)}">下载原文件</button>${editable ? ` <button type="button" class="link" data-attachment-remove="${esc(f.id)}">移除</button>` : ""}</p></article>`;
}
function download(f) {
  const body = atob(f.data.slice(f.data.indexOf(",") + 1)),
    url = URL.createObjectURL(
      new Blob([Uint8Array.from(body, (c) => c.charCodeAt(0))], {
        type: f.type,
      }),
    );
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountAttachmentEditor(form, initial = [], onChange = () => {}) {
  let files = structuredClone(initial),
    busy = false;
  const root = form.querySelector(".attachment-editor"),
    list = root.querySelector("#attachment-list"),
    status = root.querySelector("#attachments-status"),
    input = root.querySelector("#attachments-upload");
  const show = () => {
    list.innerHTML =
      files.map((f) => fileCard(f, true)).join("") ||
      '<p class="footnote">尚未添加证明材料。</p>';
  };
  show();
  const changed = () => {
    form.dataset.dirty = "true";
    onChange();
  };
  input.addEventListener("change", async () => {
    const batch = [...input.files];
    if (!batch.length) return;
    busy = true;
    input.disabled = true;
    form.dataset.dirty = "true";
    status.textContent = "正在读取附件，请等待读取完成后保存。";
    try {
      if (files.length + batch.length > 5) throw Error("每单最多5个附件");
      const added = await Promise.all(
        batch.map((f) =>
          readAttachment(f, root.querySelector("#attachment-kind").value),
        ),
      );
      const next = addAttachments(files, added);
      if (!root.isConnected) return;
      files = next;
      show();
      status.textContent = `已添加${added.length}个附件，保存报销后保留。`;
      changed();
    } catch (e) {
      if (root.isConnected) status.textContent = e.message;
    } finally {
      busy = false;
      input.disabled = false;
      input.value = "";
    }
  });
  list.addEventListener("change", (e) => {
    const id = e.target.dataset.attachmentKind;
    if (!id) return;
    files = files.map((f) =>
      f.id === id ? { ...f, kind: e.target.value } : f,
    );
    show();
    changed();
  });
  list.addEventListener("click", (e) => {
    const d = e.target.closest("[data-attachment-download]");
    if (d) download(files.find((f) => f.id === d.dataset.attachmentDownload));
    const r = e.target.closest("[data-attachment-remove]");
    if (r) {
      if (
        initial.some((f) => f.id === r.dataset.attachmentRemove) &&
        !confirm("移除此已保存附件？保存本次报销后生效，可先下载原文件。")
      )
        return;
      files = files.filter((f) => f.id !== r.dataset.attachmentRemove);
      show();
      status.textContent = "附件已从本次编辑中移除，保存报销后生效。";
      changed();
    }
  });
  return { read: () => structuredClone(files), isBusy: () => busy };
}
export function attachmentDetails(files) {
  if (!files?.length) return "";
  try {
    validateAttachments(files);
  } catch {
    return '<p class="risk">附件记录格式异常，请恢复有效备份。</p>';
  }
  return `<section class="review-box attachment-details"><h3>报销附件（${files.length}）</h3>${files.map((f) => fileCard(f, false)).join("")}<small>原文件只在当前浏览器及包含文件的备份中保留，未上传外部服务。</small></section>`;
}
export function bindAttachmentDetails(root, files = []) {
  root.querySelectorAll("[data-attachment-download]").forEach(
    (b) =>
      (b.onclick = () => {
        const f = files.find((f) => f.id === b.dataset.attachmentDownload);
        if (f) download(f);
      }),
  );
}
