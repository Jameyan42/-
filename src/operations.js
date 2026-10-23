import {
  validateDateRange,
  withinDateRange,
  processingDate,
  processingTimeZone,
} from "./processing-dates.js";
import { validatePayment } from "./expenses.js";
const roles = ["主管", "管理员", "财务", "总账", "付款"];
const text = (s, n) => typeof s === "string" && !!s.trim() && s.length <= n;
const date = (s) =>
  typeof s === "string" &&
  s.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T/.test(s) &&
  Number.isFinite(Date.parse(s));
export function validateOperation(o, kind) {
  if (
    !o ||
    o.schema !== 1 ||
    o.kind !== kind ||
    !text(o.actorId, 60) ||
    !text(o.actorName, 30) ||
    !roles.includes(o.role) ||
    !["approve", "reject", "pay"].includes(o.action) ||
    !["business", "finance", "ledger", "payment"].includes(o.stage) ||
    !text(o.label, 40) ||
    !date(o.at) ||
    typeof o.note !== "string" ||
    o.note.length > 500 ||
    !(
      o.flowVersion === null ||
      (Number.isInteger(o.flowVersion) && o.flowVersion > 0)
    ) ||
    !(o.flowVersion === null ? o.runId === null : date(o.runId))
  )
    throw Error("具名处理记录格式无效");
  const s = o.summary;
  if (
    !s ||
    !text(s.name, 60) ||
    !text(s.employee, 30) ||
    !text(s.department, 30) ||
    !["差旅交通", "业务招待", "办公采购", "其他费用"].includes(s.type) ||
    !Number.isFinite(s.amount) ||
    s.amount < 0 ||
    s.amount > 1000000
  )
    throw Error("处理时单据摘要无效");
  const from = o.fromStatus,
    to = o.toStatus;
  if (
    (o.stage === "business" && !["主管", "管理员"].includes(o.role)) ||
    (o.stage === "finance" && o.role !== "财务") ||
    (o.stage === "ledger" && o.role !== "总账") ||
    (o.stage === "payment" && !["财务", "付款"].includes(o.role))
  )
    throw Error("处理岗位与记录节点不一致");
  if (kind === "request") {
    if (
      o.stage !== "business" ||
      from !== "待审批" ||
      o.action === "pay" ||
      !(o.action === "reject"
        ? to === "已驳回"
        : ["待审批", "已批准"].includes(to))
    )
      throw Error("申请处理记录流转无效");
  } else if (kind === "expense") {
    const before = {
      business: "待主管审批",
      finance: "待财务审核",
      ledger: "待总账复核",
      payment: "待付款",
    };
    const after = {
      business: ["待主管审批", "待财务审核"],
      finance: ["待总账复核", "待付款"],
      ledger: ["待付款"],
      payment: ["已付款"],
    };
    if (
      from !== before[o.stage] ||
      (o.action === "reject"
        ? to !== "已退回"
        : !after[o.stage].includes(to)) ||
      (o.action === "pay") !== (o.stage === "payment" && to === "已付款") ||
      (o.stage === "payment" && o.action === "approve")
    )
      throw Error("报销处理记录流转无效");
  } else throw Error("处理记录单据类型无效");
  if (o.action === "reject" && !o.note.trim())
    throw Error("退回处理记录缺少原因");
  if (o.stage === "ledger" && o.action === "approve") {
    if (
      !o.accounting ||
      !text(o.accounting.account, 100) ||
      !text(o.accounting.costCenter, 100)
    )
      throw Error("总账处理记录缺少复核摘要");
  } else if (o.accounting !== undefined)
    throw Error("总账摘要只能关联总账通过记录");
  if (o.action === "pay") validatePayment(o.payment);
  else if (o.payment !== undefined) throw Error("付款摘要只能关联付款登记");
  return o;
}
export function makeOperation({
  doc,
  kind,
  actor,
  action,
  stage,
  label,
  toStatus,
  note = "",
  accounting,
  payment,
}) {
  if (!actor) return undefined; // Legacy calls with role only cannot be assigned to a person.
  const operation = {
    schema: 1,
    kind,
    actorId: actor.id,
    actorName: actor.name,
    role: actor.role,
    action,
    stage,
    label,
    at: new Date().toISOString(),
    fromStatus: doc.status,
    toStatus,
    note: note.trim(),
    flowVersion: doc.approval?.version || null,
    runId: doc.approval?.submittedAt || null,
    summary: {
      name: doc.name || "未提供事项",
      employee: doc.employee || "未提供申请人",
      department: doc.department || "未提供部门",
      type: doc.type || "其他费用",
      amount: doc.amount ?? 0,
    },
    ...(accounting
      ? {
          accounting: {
            account: accounting.account,
            costCenter: accounting.costCenter,
          },
        }
      : {}),
    ...(payment ? { payment: { ...payment } } : {}),
  };
  return validateOperation(operation, kind);
}
export function validateOperationHistory(history, kind) {
  for (const h of history)
    if (h.operation !== undefined) validateOperation(h.operation, kind);
}
export function processedRows(
  items,
  requests,
  actor,
  {
    kind = "all",
    query = "",
    result = "all",
    order = "newest",
    from = "",
    to = "",
  } = {},
) {
  const range = validateDateRange(from, to);
  if (!actor?.id || actor.active === false) return [];
  const term = query.trim().toLocaleLowerCase();
  return [
    ...items.map((doc) => ({ doc, kind: "expense" })),
    ...requests.map((doc) => ({ doc, kind: "request" })),
  ]
    .flatMap((row) =>
      row.doc.history.flatMap((h, index) => {
        const o = h.operation;
        if (!o || o.actorId !== actor.id) return [];
        try {
          validateOperation(o, row.kind);
        } catch {
          return [];
        }
        return [{ ...row, operation: o, index }];
      }),
    )
    .filter(
      (r) =>
        withinDateRange(r.operation.at, range) &&
        (kind === "all" || kind === r.kind) &&
        (result === "all" || result === r.operation.action) &&
        (!term ||
          [
            r.doc.id,
            r.operation.summary.name,
            r.operation.summary.employee,
            r.operation.summary.department,
            r.operation.note,
            r.operation.payment?.reference,
            r.operation.accounting?.account,
            r.operation.accounting?.costCenter,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term)),
    )
    .sort(
      (a, b) =>
        (order === "oldest" ? 1 : -1) *
          (Date.parse(a.operation.at) - Date.parse(b.operation.at)) ||
        `${a.kind}:${a.doc.id}`.localeCompare(`${b.kind}:${b.doc.id}`) ||
        b.index - a.index,
    );
}
export function processedCsv(rows, range = { from: "", to: "" }) {
  validateDateRange(range.from, range.to);
  const timeZone = processingTimeZone();
  const cell = (x) =>
    '"' +
    String(x ?? "")
      .replace(/^\s*[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [
      [
        "单据类型",
        "单号",
        "处理时事项",
        "申请人",
        "处理时部门",
        "处理时金额",
        "处理人",
        "当时角色",
        "处理动作",
        "处理节点",
        "流程版本",
        "提交轮次",
        "处理后状态",
        "当前状态",
        "处理时间",
        "处理备注",
        "总账科目",
        "核算归属",
        "付款参考号",
        "本地处理日期",
        "筛选开始日期",
        "筛选结束日期",
        "日期筛选时区",
      ],
      ...rows.map(({ doc, kind, operation: o }) => [
        kind === "expense" ? "报销" : "费用申请",
        doc.id,
        o.summary.name,
        o.summary.employee,
        o.summary.department,
        o.summary.amount,
        o.actorName,
        o.role,
        { approve: "通过", reject: "退回/驳回", pay: "付款登记" }[o.action],
        o.label,
        o.flowVersion ? `v${o.flowVersion}` : "历史固定流程",
        o.runId || "旧流程未提供",
        o.toStatus,
        doc.status,
        o.at,
        o.note,
        o.accounting?.account,
        o.accounting?.costCenter,
        o.payment?.reference,
        processingDate(o.at),
        range.from || "不限",
        range.to || "不限",
        timeZone,
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
