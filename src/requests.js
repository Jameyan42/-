import { makeOperation, validateOperationHistory } from "./operations.js";
import { advanceApproval } from "./approval.js";
const inactive = new Set(["草稿", "已退回", "已撤回"]);
export const requestStatuses = ["待审批", "已批准", "已驳回", "已关闭"];
const cents = (n) => Math.round(n * 100);
export function requestBalance(request, items = []) {
  const linked = items.filter(
    (x) => x.requestId === request.id && !inactive.has(x.status),
  );
  const used = linked.reduce((s, x) => s + cents(x.amount), 0);
  return {
    used: used / 100,
    remaining: Math.max(0, cents(request.amount) - used) / 100,
    unpaid: linked.some((x) => x.status !== "已付款"),
  };
}
export function validateRequest(request) {
  const str = (x, max) =>
    typeof x === "string" && x.trim().length > 0 && x.length <= max;
  if (
    !request ||
    !str(request.id, 60) ||
    !str(request.name, 60) ||
    !str(request.employee, 30) ||
    !str(request.department, 30) ||
    !["差旅交通", "业务招待", "办公采购", "其他费用"].includes(request.type) ||
    !Number.isFinite(request.amount) ||
    request.amount < 0.01 ||
    Math.abs(Math.round(request.amount * 100) / 100 - request.amount) > 1e-8 ||
    request.amount > 1000000 ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month) ||
    !str(request.note, 500) ||
    !requestStatuses.includes(request.status) ||
    !Array.isArray(request.history) ||
    request.history.length > 500 ||
    request.history.some((h) => !h || !str(h.text, 1000) || !str(h.time, 100))
  )
    throw new Error("费用申请数据格式无效");
  validateOperationHistory(request.history, "request");
  return request;
}
export function assertClaimLink(item, requests, items) {
  if (!item.requestId) return;
  if (
    !Number.isFinite(item.amount) ||
    Math.abs(cents(item.amount) / 100 - item.amount) > 1e-8
  )
    throw new Error("关联报销金额最多两位小数");
  const r = requests.find((r) => r.id === item.requestId);
  if (!r || r.employee !== item.employee || r.department !== item.department)
    throw new Error("只能关联本人同部门的费用申请");
  if (r.month !== item.date.slice(0, 7) || r.type !== item.type)
    throw new Error("报销月份和费用类型必须与申请一致");
  if (inactive.has(item.status)) return;
  if (
    r.status !== "已批准" &&
    !(r.status === "已关闭" && item.status === "已付款")
  )
    throw new Error("只能提交关联已批准申请的报销");
  const used = requestBalance(
    r,
    items.filter((x) => x.id !== item.id),
  ).used;
  if (cents(used) + cents(item.amount) > cents(r.amount))
    throw new Error("报销超过申请剩余额度，请调整金额或另行申请");
}
export function requestAction(
  r,
  action,
  role,
  employee,
  items,
  note = "",
  actor = null,
) {
  validateRequest(r);
  if (actor && actor.role !== role) throw Error("处理身份与角色不一致");
  if (typeof note !== "string" || note.length > 200)
    throw new Error("处理原因不能超过200字");
  if (!["approve", "reject", "close"].includes(action))
    throw new Error("未知申请操作");
  if (r.approval && action !== "close")
    return advanceApproval(r, action, actor || {}, note);
  if (action === "close") {
    if (
      role !== "员工" ||
      r.employee !== employee ||
      !["待审批", "已批准"].includes(r.status)
    )
      throw new Error("仅本人可结束待审批或已批准申请");
    if (requestBalance(r, items).unpaid)
      throw new Error("仍有在途报销，请完成付款或退回/撤回后再结束申请");
  } else if (role !== "主管" || r.status !== "待审批")
    throw new Error("仅主管可审批待处理申请");
  if (action !== "approve" && (!note.trim() || note.length > 200))
    throw new Error("请填写 1～200 字处理原因");
  const status = { approve: "已批准", reject: "已驳回", close: "已关闭" }[
    action
  ];
  return {
    ...r,
    status,
    history: [
      ...r.history,
      {
        ...(actor && action !== "close"
          ? {
              operation: makeOperation({
                doc: r,
                kind: "request",
                actor,
                action,
                stage: "business",
                label: "主管审批",
                toStatus: status,
                note,
              }),
            }
          : {}),
        text: `${role}${status}${note.trim() ? "：" + note.trim() : ""}`,
        time: new Date().toLocaleString("zh-CN"),
      },
    ],
  };
}
export function validateRequestSet(requests, items) {
  if (!Array.isArray(requests) || requests.length > 1000)
    throw new Error("费用申请最多 1000 条");
  const ids = new Set();
  for (const r of requests) {
    validateRequest(r);
    if (ids.has(r.id)) throw new Error("费用申请标识重复");
    ids.add(r.id);
  }
  for (const x of items) {
    if (
      x.requestId !== undefined &&
      (typeof x.requestId !== "string" || x.requestId.length > 60)
    )
      throw new Error("关联申请格式无效");
    assertClaimLink(x, requests, items);
  }
}
