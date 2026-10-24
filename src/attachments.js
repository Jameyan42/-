import { validateRiskReviews } from "./risk-reviews.js";
import {
  validateInvoices,
  validateInvoiceAttachments,
} from "./invoice-data.js";
export const attachmentKinds = [
  "发票",
  "酒店水单",
  "行程单",
  "付款凭证",
  "验收单",
  "合同附件",
  "其他材料",
];
export const MAX_FILE = 1024 * 1024,
  MAX_TOTAL = 1536 * 1024,
  MAX_COUNT = 5,
  MAX_ITEMS_CHARS = 2200000;
const formats = {
  "application/pdf": {
    ext: /\.pdf$/i,
    signature: (b) =>
      b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70 && b[4] === 45,
  },
  "image/png": {
    ext: /\.png$/i,
    signature: (b) =>
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v),
  },
  "image/jpeg": {
    ext: /\.jpe?g$/i,
    signature: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
  },
  "image/webp": {
    ext: /\.webp$/i,
    signature: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
};
export function validateAttachments(list) {
  if (!Array.isArray(list) || list.length > MAX_COUNT)
    throw Error("每单最多5个附件");
  let total = 0;
  const ids = new Set();
  for (const f of list) {
    if (
      !f ||
      typeof f.id !== "string" ||
      !f.id ||
      f.id.length > 60 ||
      ids.has(f.id) ||
      typeof f.name !== "string" ||
      !f.name.trim() ||
      f.name.length > 120 ||
      !attachmentKinds.includes(f.kind) ||
      !Number.isInteger(f.size) ||
      f.size < 1 ||
      f.size > MAX_FILE ||
      !formats[f.type] ||
      !formats[f.type].ext.test(f.name) ||
      typeof f.data !== "string" ||
      f.data.length > Math.ceil(MAX_FILE / 3) * 4 + 100
    )
      throw Error(
        "附件格式无效：仅支持1 MB以内的PDF、PNG、JPG、WebP及有效分类",
      );
    const prefix = `data:${f.type};base64,`;
    if (!f.data.startsWith(prefix)) throw Error("附件文件类型与内容不一致");
    const body = f.data.slice(prefix.length);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        body,
      ) ||
      !body
    )
      throw Error("附件编码无效");
    const bytes =
      (body.length / 4) * 3 -
      (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0);
    if (bytes !== f.size) throw Error("附件大小与文件内容不一致");
    const raw = atob(body.slice(0, Math.min(16, body.length)));
    const head = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    if (!formats[f.type].signature(head))
      throw Error("附件内容不是所声明的文件格式");
    ids.add(f.id);
    total += f.size;
  }
  if (total > MAX_TOTAL) throw Error("每单附件合计不能超过1.5 MB");
  return list;
}
export async function readAttachment(file, kind) {
  if (file.size < 1 || file.size > MAX_FILE)
    throw Error("单个附件须为非空文件且不超过1 MB");
  const type = Object.keys(formats).find((t) => formats[t].ext.test(file.name));
  if (!type) throw Error("仅支持PDF、PNG、JPG、WebP附件");
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("附件读取失败，请重试"));
    r.readAsDataURL(new Blob([file], { type }));
  });
  const f = {
    id: crypto.randomUUID(),
    name: file.name,
    type,
    size: file.size,
    kind,
    data,
  };
  validateAttachments([f]);
  return f;
}
export function addAttachments(current, added) {
  const next = [...current, ...added];
  validateAttachments(next);
  for (let i = 0; i < next.length; i++)
    if (
      next
        .slice(0, i)
        .some((f) => f.name === next[i].name && f.data === next[i].data)
    )
      throw Error("该文件已添加，请勿重复上传");
  return next;
}
export function serializeExpenseItems(next) {
  for (const x of next)
    if (x.attachments !== undefined) validateAttachments(x.attachments);
  for (const x of next)
    if (x.invoices !== undefined) validateInvoices(x.invoices);
  for (const x of next) validateInvoiceAttachments(x.invoices, x.attachments);
  for (const x of next) validateRiskReviews(x.riskReviews, "expense", x.id);
  const json = JSON.stringify(next);
  if (
    json.length > MAX_ITEMS_CHARS &&
    next.some((x) => x.attachments?.length || x.riskReviews?.length)
  )
    throw Error("浏览器附件容量不足，请减少本次附件或先下载备份；原报销未改动");
  return json;
}
export function persistExpenseItems(storage, next) {
  const json = serializeExpenseItems(next);
  try {
    storage.setItem("qingbao-v1", json);
  } catch {
    throw Error("浏览器保存失败或容量不足，请减少附件后重试；原报销未改动");
  }
}

export function writeStorageBatch(storage, entries) {
  const previous = new Map(entries.map(([key]) => [key, storage.getItem(key)])),
    written = [];
  try {
    for (const [key, value] of entries) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      written.push(key);
    }
  } catch {
    try {
      for (const key of written) storage.removeItem(key);
      for (const key of written) {
        const old = previous.get(key);
        if (old !== null) storage.setItem(key, old);
      }
    } catch {
      throw Error("浏览器存储异常，回退未完成，请保留原备份并恢复后重试");
    }
    throw Error("浏览器容量不足或保存失败，已回退原数据，未恢复备份");
  }
}
