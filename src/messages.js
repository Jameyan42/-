import { canHandleDocument } from "./inbox.js";
import { ownsExpense } from "./expense-progress.js";
export const emptyMessageRead = () => ({ schema: 1, byActor: {} });
export function validateMessageRead(state) {
  if (
    !state ||
    state.schema !== 1 ||
    !state.byActor ||
    typeof state.byActor !== "object" ||
    Array.isArray(state.byActor) ||
    Object.keys(state.byActor).length > 200
  )
    throw Error("消息已读记录格式无效");
  let total = 0;
  for (const [actor, keys] of Object.entries(state.byActor)) {
    if (
      !actor ||
      actor.length > 60 ||
      !Array.isArray(keys) ||
      keys.length > 1000 ||
      new Set(keys).size !== keys.length ||
      keys.some((k) => typeof k !== "string" || !k || k.length > 1000)
    )
      throw Error("消息已读记录格式无效");
    total += keys.length;
  }
  if (total > 20000 || JSON.stringify(state).length > 400000)
    throw Error("消息已读记录容量已达上限，请保留备份后处理");
  return state;
}
export function markMessagesRead(state, actorId, keys) {
  validateMessageRead(state);
  if (!Array.isArray(keys)) throw Error("消息标识列表无效");
  if (typeof actorId !== "string" || !actorId || actorId.length > 60)
    throw Error("消息人员标识无效");
  const previous = Object.hasOwn(state.byActor, actorId)
    ? state.byActor[actorId]
    : [];
  const next = {
    schema: 1,
    byActor: {
      ...state.byActor,
      [actorId]: [...new Set([...previous, ...keys])],
    },
  };
  return validateMessageRead(next);
}
export function businessMessages(
  items,
  requests,
  actor,
  org,
  readState = emptyMessageRead(),
) {
  if (!actor?.id || !actor.active) return [];
  const read = new Set(
    Object.hasOwn(readState.byActor, actor.id)
      ? readState.byActor[actor.id]
      : [],
  );
  return [
    ...items.map((doc) => ({ doc, kind: "expense" })),
    ...requests.map((doc) => ({ doc, kind: "request" })),
  ]
    .flatMap(({ doc, kind }) => {
      const todo = canHandleDocument(doc, kind, actor),
        own = ownsExpense(doc, actor, org);
      const relevant =
        kind === "expense"
          ? ["已退回", "待付款", "已付款"]
          : ["已批准", "已驳回", "已关闭"];
      if (!todo && !(own && relevant.includes(doc.status))) return [];
      const a = doc.approval,
        last = doc.history?.at(-1),
        operation = last?.operation;
      const key = JSON.stringify([
        kind,
        doc.id,
        todo ? "todo" : "update",
        doc.status,
        a?.submittedAt || "",
        a?.cursor ?? null,
        doc.history?.length || 0,
        operation?.at || last?.time || "",
      ]);
      const at = operation?.at || (todo ? a?.submittedAt : null);
      const time = at && Number.isFinite(Date.parse(at)) ? at : null;
      const node =
        doc.status === "待付款"
          ? a?.paymentActor || a?.nodes.at(-1)
          : a?.nodes[a.cursor];
      const title = todo
        ? doc.status === "待付款"
          ? "有一笔报销等待你登记模拟付款"
          : "有一笔" + (kind === "expense" ? "报销" : "费用申请") + "等待你处理"
        : {
            已退回: "报销已退回，请核对并修改",
            待付款: "报销审批已完成，等待模拟付款",
            已付款: "报销已完成模拟付款登记",
            已批准: "费用申请已批准，可查看额度",
            已驳回: "费用申请已驳回，请核对原因",
            已关闭: "费用申请已结束",
          }[doc.status];
      const reason = ["已退回", "已驳回"].includes(doc.status)
        ? [...(doc.history || [])]
            .reverse()
            .find(
              (h) =>
                h.operation?.action === "reject" ||
                (!h.operation && /退回|驳回/.test(h.text)),
            )
        : null;
      return [
        {
          key,
          kind,
          doc,
          type: todo ? "todo" : "update",
          title,
          time,
          unread: !read.has(key),
          stage: todo
            ? doc.status === "待付款"
              ? "付款登记"
              : node?.label || "历史角色审批"
            : doc.status,
          hint: todo
            ? a
              ? `提交时指定：${node?.actorName || "请核对路径"}`
              : "旧单按原角色匹配，未指定具体人员"
            : doc.status === "已付款"
              ? "仅表示模拟登记，不代表银行到账。"
              : doc.status === "已关闭"
                ? "未使用额度当前不预留，不能再关联新报销。"
                : "查看单据和流转记录了解详情。",
          reason: reason?.operation?.note || reason?.text || "",
        },
      ];
    })
    .sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      const x = Date.parse(a.time),
        y = Date.parse(b.time);
      return (
        (Number.isFinite(x) && Number.isFinite(y)
          ? y - x
          : Number.isFinite(x)
            ? -1
            : Number.isFinite(y)
              ? 1
              : 0) || a.key.localeCompare(b.key)
      );
    });
}
export function filterMessages(
  rows,
  { type = "all", unread = "all", query = "" } = {},
) {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(
    (r) =>
      (type === "all" || r.type === type) &&
      (unread === "all" || r.unread) &&
      (!q ||
        [
          r.title,
          r.doc.id,
          r.doc.name,
          r.doc.employee,
          r.doc.department,
          r.stage,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q)),
  );
}
