import { assertTravelSubmission } from "./travel.js";
import { makeOperation } from "./operations.js";
import { advanceApproval } from "./approval.js";
import { defaultPolicy } from "./settings.js";
import { validatePayment, inactiveStatuses } from "./expenses.js";
export const stages = ["待主管审批", "待财务审核", "待付款", "已付款"];
export function review(item, all = [], policy = defaultPolicy) {
  const flags = [];
  if (["草稿", "已撤回"].includes(item.status)) return flags;
  if (item.travel) {
    try {
      assertTravelSubmission(item.travel, item.amount, item.type);
    } catch (e) {
      flags.push(e.message);
    }
  }
  if (item.amount > policy.limit)
    flags.push(
      `超过单笔 ${policy.limit.toLocaleString("zh-CN")} 元标准，需说明业务必要性`,
    );
  if (policy.requireReceipt && !item.receipt)
    flags.push("缺少票据附件，财务审核前需补充");
  if (
    policy.checkDuplicate &&
    item.invoice &&
    all.some(
      (x) =>
        x.id !== item.id &&
        !inactiveStatuses.includes(x.status) &&
        x.invoice === item.invoice,
    )
  )
    flags.push("发票号码与历史报销重复，请核对");
  return flags;
}
export function transition(
  item,
  action,
  role,
  note = "",
  payment = null,
  actor = null,
  ledgerReview = null,
) {
  if (!["approve", "reject"].includes(action)) throw new Error("未知操作");
  if (typeof note !== "string" || note.length > 500)
    throw Error("处理备注不能超过500字");
  if (actor && actor.role !== role) throw Error("处理身份与角色不一致");
  if (item.approval && item.status !== "待付款")
    return advanceApproval(item, action, actor || {}, note, ledgerReview);
  if (
    item.approval &&
    (!actor ||
      (item.approval.paymentActor || item.approval.nodes.at(-1)).actorId !==
        actor.id ||
      (item.approval.paymentActor || item.approval.nodes.at(-1)).role !==
        actor.role)
  )
    throw Error("仅快照中的财务人员可登记付款或退回");
  const allowed =
    (role === "主管" && item.status === stages[0]) ||
    (role === "财务" && [stages[1], stages[2]].includes(item.status)) ||
    (role === "付款" &&
      item.approval?.schema === 2 &&
      item.status === "待付款");
  if (!allowed) throw new Error("当前角色不能处理这笔报销");
  if (action === "reject" && !note.trim()) throw new Error("请填写退回原因");
  if (
    action === "approve" &&
    item.status === stages[1] &&
    (item.flags || []).length
  )
    throw new Error("存在未解决的预审风险，请退回员工修正");
  const paid =
    action === "approve" && item.status === "待付款"
      ? validatePayment(payment)
      : null;
  const status =
    action === "reject" ? "已退回" : stages[stages.indexOf(item.status) + 1];
  return {
    ...item,
    status,
    ...(paid ? { payment: paid } : {}),
    history: [
      ...item.history,
      {
        ...(actor
          ? {
              operation: makeOperation({
                doc: item,
                kind: "expense",
                actor,
                action: paid ? "pay" : action,
                stage:
                  item.status === "待付款"
                    ? "payment"
                    : item.status === "待主管审批"
                      ? "business"
                      : "finance",
                label:
                  item.status === "待付款"
                    ? "付款登记"
                    : item.status === "待主管审批"
                      ? "主管审批"
                      : "财务审核",
                toStatus: status,
                note,
                payment: paid || undefined,
              }),
            }
          : {}),
        text:
          action === "reject"
            ? `${role}退回：${note}`
            : `${role}${status === "已付款" ? "登记付款" : "审核通过"}`,
        time: new Date().toLocaleString("zh-CN"),
      },
    ],
  };
}
