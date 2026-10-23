import { canHandleDocument } from "./inbox.js";
import { review, transition } from "./domain.js";
import { validateLedgerReview } from "./approval.js";
export function normalizeReference(s) {
  return String(s ?? "")
    .trim()
    .toLocaleUpperCase();
}
export function assertUniqueReference(reference, items, excludeId = "") {
  const key = normalizeReference(reference);
  if (
    items.some(
      (d) =>
        d.id !== excludeId &&
        d.status === "已付款" &&
        d.payment &&
        normalizeReference(d.payment.reference) === key,
    )
  )
    throw Error("付款参考号已使用，请核对后换用未使用的参考号");
}
export function batchReferences(prefix, count) {
  if (
    typeof prefix !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{2,47}$/.test(prefix) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 20
  )
    throw Error("批次前缀需为3～48位字母、数字、下划线或短横线，每批1～20笔");
  return Array.from(
    { length: count },
    (_, i) => `${prefix}-${String(i + 1).padStart(3, "0")}`,
  );
}
export function batchPayment(
  items,
  ids,
  actor,
  { prefix, date, method, confirmed, note = "" },
  policy,
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 20 ||
    new Set(ids).size !== ids.length
  )
    throw Error("请勾选1～20笔不同的待付款单据");
  if (!actor?.active || !["付款", "财务"].includes(actor.role))
    throw Error("当前身份不能批量登记付款");
  if (typeof note !== "string" || note.length > 400)
    throw Error("批量备注不能超过400字");
  const refs = batchReferences(prefix, ids.length),
    updates = new Map();
  ids.forEach((id, i) => {
    const d = items.find((d) => d.id === id);
    if (!d || d.status !== "待付款" || !canHandleDocument(d, "expense", actor))
      throw Error("所选单据状态或付款权限已变化，请重新核对");
    if (d.approval?.schema === 2) {
      const n = d.approval.nodes.find((n) => n.stage === "ledger");
      validateLedgerReview(d.ledgerReview);
      if (d.ledgerReview.reviewedBy !== n?.actorId)
        throw Error("所选单据总账复核记录不一致");
    }
    const flags = review(d, items, policy);
    if (flags.length) throw Error("所选单据仍有预审风险，请先逐笔核对处理");
    assertUniqueReference(refs[i], items);
    updates.set(
      id,
      transition(
        { ...d, flags },
        "approve",
        actor.role,
        `${note.trim()}${note.trim() ? " · " : ""}批量登记 ${prefix}`,
        { reference: refs[i], date, method, confirmed },
        actor,
        null,
        { items, policy },
      ),
    );
  });
  return items.map((d) => updates.get(d.id) || d);
}
export function paymentCsv(rows, { filter = "待付款", query = "" } = {}) {
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [
      [
        "单号",
        "事项",
        "申请人",
        "部门",
        "金额",
        "状态",
        "付款责任人",
        "付款日期",
        "付款方式",
        "付款参考号",
        "总账科目",
        "核算归属",
        "状态筛选",
        "搜索条件",
      ],
      ...rows.map((d) => [
        d.id,
        d.name,
        d.employee,
        d.department,
        d.amount,
        d.status,
        (d.approval?.paymentActor || d.approval?.nodes.at(-1))?.actorName ||
          "历史按财务角色",
        d.payment?.date || "",
        d.payment?.method || "",
        d.payment?.reference || "",
        d.ledgerReview?.account || "",
        d.ledgerReview?.costCenter || "",
        filter,
        query,
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
