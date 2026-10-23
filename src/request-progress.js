import { ownsExpense } from "./expense-progress.js";
export const requestProgressStatuses = [
  "全部",
  "待审批",
  "已批准",
  "已驳回",
  "已关闭",
];
const inactive = new Set(["草稿", "已退回", "已撤回"]);
const cents = (n) => Math.round(n * 100);
export function requestProgress(request, items, actor, org) {
  const linked = items.filter(
    (d) => d.requestId === request.id && ownsExpense(d, actor, org),
  );
  const active = linked.filter((d) => !inactive.has(d.status));
  const paid = active
    .filter((d) => d.status === "已付款")
    .reduce((s, d) => s + cents(d.amount), 0);
  const inFlight = active
    .filter((d) => d.status !== "已付款")
    .reduce((s, d) => s + cents(d.amount), 0);
  const used = paid + inFlight,
    remaining = Math.max(0, cents(request.amount) - used) / 100;
  const a = request.approval;
  let stage = request.status,
    actorName = "",
    hint = "",
    steps = [];
  if (request.status === "待审批") {
    if (!a) {
      stage = "主管审批";
      actorName = "主管（按原角色处理）";
      hint = "旧申请没有具名路径，不按当前组织猜测审批人。";
    } else if (
      a.kind !== "request" ||
      a.cursor >= a.nodes.length ||
      a.nodes[a.cursor]?.stage !== "business"
    ) {
      stage = "无法确定节点";
      hint = "状态与审批路径不一致，请核对记录。";
    } else {
      const n = a.nodes[a.cursor],
        p = org.people.find((p) => p.id === n.actorId);
      stage = n.label;
      actorName = n.actorName;
      hint =
        p?.active && p.role === n.role
          ? "等待指定人员审批；页面不发送催办。"
          : "指定人员当前不可处理，请管理员核对，不自动改派。";
      steps = a.nodes.map((n, i) => ({
        ...n,
        state:
          i < a.cursor ? "已通过" : i === a.cursor ? "当前待处理" : "后续节点",
      }));
    }
  } else if (request.status === "已批准")
    hint = inFlight
      ? "仍有在途报销，当前不能结束申请；退回/撤回会使额度回到申请。"
      : "可关联同部门、月份、费用类型的本人报销，或查看申请详情结束并释放未用预算。";
  else if (request.status === "已关闭")
    hint = "申请已结束，不能再关联新报销；未使用额度当前不预留预算。";
  else if (request.status === "已驳回")
    hint =
      "申请未获批准，不预留预算；请核对原因后另行申请，本版不支持申请修改重提。";
  const rejection =
    request.status === "已驳回"
      ? [...(request.history || [])]
          .reverse()
          .find(
            (h) =>
              h.operation?.action === "reject" ||
              (!h.operation && /驳回/.test(h.text)),
          )
      : null;
  return {
    request,
    linked,
    paid: paid / 100,
    inFlight: inFlight / 100,
    used: used / 100,
    remaining,
    available: request.status === "已批准" ? remaining : 0,
    reserved: request.status === "已批准" ? remaining : 0,
    stage,
    actorName,
    hint,
    steps,
    reason:
      rejection?.operation?.note ||
      rejection?.text ||
      (request.status === "已驳回" ? "旧记录未提供驳回原因，请核对。" : ""),
    submittedAt: a?.submittedAt || null,
    version: a ? `v${a.version}` : "历史固定流程",
  };
}
export function requestProgressRows(
  requests,
  items,
  actor,
  org,
  { status = "全部", month = "", query = "" } = {},
) {
  const term = query.trim().toLocaleLowerCase();
  return requests
    .filter((r) => ownsExpense(r, actor, org))
    .map((r) => requestProgress(r, items, actor, org))
    .filter(
      (r) =>
        (status === "全部" || r.request.status === status) &&
        (!month || r.request.month === month) &&
        (!term ||
          [
            r.request.name,
            r.request.id,
            r.request.type,
            r.actorName,
            r.stage,
            r.request.trip?.destination,
            r.request.trip?.origin,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term)),
    )
    .sort((a, b) => {
      const x = Date.parse(a.submittedAt),
        y = Date.parse(b.submittedAt);
      return (
        (Number.isFinite(x) && Number.isFinite(y)
          ? y - x
          : Number.isFinite(x)
            ? -1
            : Number.isFinite(y)
              ? 1
              : 0) || a.request.id.localeCompare(b.request.id)
      );
    });
}
export function requestProgressCsv(
  rows,
  { status = "全部", month = "", query = "" } = {},
) {
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
        "申请单号",
        "事项",
        "申请人",
        "部门",
        "计划月份",
        "类型",
        "申请额度",
        "已占用额度",
        "在途报销",
        "已登记付款",
        "未使用额度",
        "可关联额度",
        "当前预留预算",
        "申请状态",
        "当前节点",
        "当前待处理人",
        "流程版本",
        "本次提交时间",
        "状态筛选",
        "月份筛选",
        "搜索条件",
      ],
      ...rows.map((r) => [
        r.request.id,
        r.request.name,
        r.request.employee,
        r.request.department,
        r.request.month,
        r.request.type,
        r.request.amount,
        r.used,
        r.inFlight,
        r.paid,
        r.remaining,
        r.available,
        r.reserved,
        r.request.status,
        r.stage,
        r.actorName || "无需处理或记录未提供",
        r.version,
        r.submittedAt || "旧记录未提供",
        status,
        month || "不限",
        query,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
