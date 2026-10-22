import { validatePayment } from "./expenses.js";
export const defaultPolicy = {
  limit: 3000,
  requireReceipt: true,
  checkDuplicate: true,
};
export function validatePolicy(value) {
  if (
    !value ||
    !Number.isFinite(value.limit) ||
    value.limit <= 0 ||
    value.limit > 1000000 ||
    typeof value.requireReceipt !== "boolean" ||
    typeof value.checkDuplicate !== "boolean"
  )
    throw new Error("规则配置无效");
  return {
    limit: value.limit,
    requireReceipt: value.requireReceipt,
    checkDuplicate: value.checkDuplicate,
  };
}
export function validateBackup(data) {
  if (
    !data ||
    data.format !== "qingbao-backup" ||
    data.version !== 1 ||
    !Array.isArray(data.items) ||
    data.items.length > 1000
  )
    throw new Error("不是有效的轻报备份文件（最多 1000 笔报销）");
  const text = (s, max = 500) => typeof s === "string" && s.length <= max;
  const statuses = [
    "草稿",
    "待主管审批",
    "待财务审核",
    "待付款",
    "已付款",
    "已退回",
    "已撤回",
  ];
  const ids = new Set();
  for (const x of data.items) {
    if (
      !x ||
      !text(x.id, 60) ||
      !x.id ||
      ids.has(x.id) ||
      !text(x.name, 60) ||
      !text(x.employee, 30) ||
      !x.employee ||
      !["销售部", "产品部", "运营部"].includes(x.department) ||
      !["差旅交通", "业务招待", "办公采购", "其他费用"].includes(x.type) ||
      !Number.isFinite(x.amount) ||
      x.amount < 0 ||
      x.amount > 1000000 ||
      !statuses.includes(x.status) ||
      !text(x.date, 10) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(x.date) ||
      !text(x.invoice, 40) ||
      !text(x.receipt, 255) ||
      !text(x.note) ||
      !Array.isArray(x.history) ||
      x.history.length > 500 ||
      x.history.some((h) => !h || !text(h.text, 1000) || !text(h.time, 100))
    )
      throw new Error("备份中的报销数据不完整或格式无效");
    if (
      x.status !== "草稿" &&
      (!x.name.trim() || !x.note.trim() || x.amount <= 0)
    )
      throw new Error("已提交的报销必须有事项、说明和有效金额");
    if (x.payment !== undefined) {
      validatePayment(x.payment);
      if (x.status !== "已付款") throw new Error("付款信息只能关联已付款单据");
    }
    if (
      x.ocr !== undefined &&
      (!x.ocr ||
        x.ocr.engine !== "Tesseract.js" ||
        x.ocr.confirmed !== true ||
        !text(x.ocr.at, 40) ||
        Number.isNaN(Date.parse(x.ocr.at)) ||
        !Array.isArray(x.ocr.fields) ||
        !x.ocr.fields.length ||
        x.ocr.fields.length > 2 ||
        x.ocr.fields.some((f) => !["invoice", "amount"].includes(f)))
    )
      throw new Error("OCR 核对记录格式无效");
    ids.add(x.id);
  }
  if (
    !data.budgets ||
    Object.keys(data.budgets).length !== 3 ||
    !["销售部", "产品部", "运营部"].every(
      (k) =>
        Number.isFinite(data.budgets[k]) &&
        data.budgets[k] > 0 &&
        data.budgets[k] <= 10000000,
    )
  )
    throw new Error("备份中的预算配置无效");
  validatePolicy(data.policy);
  if (
    !Array.isArray(data.audit) ||
    data.audit.length > 1000 ||
    data.audit.some(
      (x) =>
        !x ||
        !text(x.actor, 30) ||
        !text(x.action, 60) ||
        !text(x.target, 100) ||
        !text(x.note, 1000) ||
        !text(x.time, 100),
    )
  )
    throw new Error("备份中的操作记录无效");
  return data;
}
