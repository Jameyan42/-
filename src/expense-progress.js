export const progressGroups = [
  ["all", "全部"],
  ["active", "流转中"],
  ["action", "待我完善"],
  ["paid", "已登记付款"],
];
export function ownsExpense(doc, actor, org) {
  if (!actor?.id || actor.active === false || actor.role !== "员工")
    return false;
  if (doc.approval) return doc.approval.applicantId === actor.id;
  // Legacy documents and drafts have no applicant ID. Require an unambiguous exact name and department.
  return (
    org.people.filter((p) => p.name === doc.employee).length === 1 &&
    doc.employee === actor.name &&
    org.departments.find((d) => d.id === actor.departmentId)?.name ===
      doc.department
  );
}
export function expenseProgress(doc, org) {
  const status = doc.status;
  const group = ["草稿", "已退回", "已撤回"].includes(status)
    ? "action"
    : status === "已付款"
      ? "paid"
      : "active";
  const base = {
    doc,
    group,
    stage: status,
    actorName: "",
    hint: "",
    steps: [],
    submittedAt: doc.approval?.submittedAt || null,
    version: doc.approval ? `v${doc.approval.version}` : "历史固定流程",
  };
  if (group === "action") {
    const last =
      status === "已退回"
        ? [...(doc.history || [])]
            .reverse()
            .find(
              (h) =>
                h.operation?.action === "reject" ||
                (!h.operation && /退回/.test(h.text)),
            )
        : null;
    return {
      ...base,
      actorName: doc.employee,
      hint:
        status === "草稿"
          ? "继续填写并提交，草稿尚未进入审批。"
          : status === "已撤回"
            ? "核对资料后可重新提交，重新提交会按届时流程生成路径。"
            : "查看退回说明，修正后重新提交。",
      reason:
        last?.operation?.note ||
        last?.text ||
        (status === "已退回" ? "旧记录未提供退回说明，请与审核人核对。" : ""),
    };
  }
  if (group === "paid")
    return {
      ...base,
      stage: "付款已登记",
      hint: "仅表示已完成模拟付款登记，不代表银行到账。",
    };
  const a = doc.approval;
  if (!a) {
    const stages = {
      待主管审批: "主管审批",
      待财务审核: "财务审核",
      待付款: "付款登记",
    };
    return {
      ...base,
      stage: stages[status] || "无法确定节点",
      actorName: stages[status]
        ? status === "待主管审批"
          ? "主管（按原角色处理）"
          : "财务（按原角色处理）"
        : "未提供处理人",
      hint: "历史单据未保存具名路径，不按当前组织推测人员。",
    };
  }
  const payment = a.paymentActor || a.nodes.at(-1);
  const node =
    status === "待付款" && a.cursor === a.nodes.length
      ? payment
      : a.nodes[a.cursor];
  const expected =
    node?.stage === "business"
      ? "待主管审批"
      : node?.stage === "finance"
        ? "待财务审核"
        : node?.stage === "ledger"
          ? "待总账复核"
          : null;
  if (
    !node ||
    (status !== "待付款" && status !== expected) ||
    (status === "待付款" && a.cursor !== a.nodes.length)
  )
    return {
      ...base,
      stage: "无法确定节点",
      actorName: "请核对单据记录",
      hint: "状态与审批路径不一致，未推测处理人。",
    };
  const current = org.people.find((p) => p.id === node.actorId);
  const unavailable = !current?.active || current.role !== node.role;
  const steps = [
    ...a.nodes.map((n, i) => ({
      ...n,
      state:
        i < a.cursor ? "已通过" : i === a.cursor ? "当前待处理" : "后续节点",
    })),
    {
      ...payment,
      label: "付款登记",
      state: status === "待付款" ? "当前待处理" : "后续节点",
    },
  ];
  return {
    ...base,
    stage: status === "待付款" ? "付款登记" : node.label,
    actorName: node.actorName,
    steps,
    hint: unavailable
      ? "路径中的人员当前不可处理，请管理员核对；不会自动改派。"
      : "等待指定人员处理；页面不承诺处理时限，也不会发送催办。",
  };
}
export function progressRows(
  items,
  actor,
  org,
  { group = "all", query = "" } = {},
) {
  const term = query.trim().toLocaleLowerCase();
  return items
    .filter((d) => ownsExpense(d, actor, org))
    .map((d) => expenseProgress(d, org))
    .filter(
      (r) =>
        (group === "all" || r.group === group) &&
        (!term ||
          [r.doc.name, r.doc.id, r.doc.type, r.doc.status, r.stage, r.actorName]
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
              : 0) || a.doc.id.localeCompare(b.doc.id)
      );
    });
}
