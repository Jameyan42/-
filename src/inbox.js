import { canApprove } from "./approval.js";

export function canHandleDocument(doc, kind, actor) {
  if (
    !actor ||
    actor.active === false ||
    !["expense", "request"].includes(kind)
  )
    return false;
  if (doc.approval) {
    if (kind === "expense" && doc.status === "待付款") {
      const finance = doc.approval.nodes.at(-1);
      return (
        finance?.stage === "finance" &&
        doc.approval.cursor === doc.approval.nodes.length &&
        actor.role === "财务" &&
        finance.actorId === actor.id
      );
    }
    return doc.approval.kind === kind && canApprove(doc, actor);
  }
  // Existing documents retain the role-based responsibility they had before snapshots.
  return kind === "request"
    ? actor.role === "主管" && doc.status === "待审批"
    : (actor.role === "主管" && doc.status === "待主管审批") ||
        (actor.role === "财务" &&
          ["待财务审核", "待付款"].includes(doc.status));
}

export function inboxRows(
  items,
  requests,
  actor,
  { kind = "all", query = "", order = "oldest" } = {},
) {
  const term = query.trim().toLocaleLowerCase();
  return [
    ...items.map((doc) => ({ kind: "expense", doc })),
    ...requests.map((doc) => ({ kind: "request", doc })),
  ]
    .filter((row) => canHandleDocument(row.doc, row.kind, actor))
    .map((row) => {
      const a = row.doc.approval;
      const at = a?.submittedAt;
      const submittedAt = at && Number.isFinite(Date.parse(at)) ? at : null;
      const payment = row.doc.status === "待付款";
      return {
        ...row,
        submittedAt,
        actorName: a
          ? (payment ? a.nodes.at(-1) : a.nodes[a.cursor])?.actorName
          : null,
        stage: payment
          ? "付款登记"
          : a?.nodes[a.cursor]?.label ||
            (row.kind === "request" || row.doc.status === "待主管审批"
              ? "主管审批"
              : "财务审核"),
        progress: a
          ? `${a.cursor}/${a.nodes.length} 节点已通过`
          : "历史固定流程",
        version: a ? `v${a.version}` : "历史固定流程",
      };
    })
    .filter(
      ({ doc, kind: rowKind }) =>
        (kind === "all" || rowKind === kind) &&
        (!term ||
          [doc.name, doc.id, doc.employee, doc.department, doc.type]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term)),
    )
    .sort((a, b) => {
      if (!a.submittedAt && b.submittedAt) return 1;
      if (a.submittedAt && !b.submittedAt) return -1;
      const delta =
        a.submittedAt && b.submittedAt
          ? Date.parse(a.submittedAt) - Date.parse(b.submittedAt)
          : 0;
      return (
        (order === "newest" ? -delta : delta) ||
        `${a.kind}:${a.doc.id}`.localeCompare(`${b.kind}:${b.doc.id}`)
      );
    });
}

export function inboxCsv(rows) {
  const cell = (value) =>
    '"' +
    String(value ?? "")
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [
      [
        "单据类型",
        "单号",
        "事项",
        "申请人",
        "部门",
        "金额",
        "状态",
        "当前节点",
        "处理人",
        "流程版本",
        "提交时间",
      ],
      ...rows.map((r) => [
        r.kind === "expense" ? "报销" : "费用申请",
        r.doc.id,
        r.doc.name,
        r.doc.employee,
        r.doc.department,
        r.doc.amount,
        r.doc.status,
        r.stage,
        r.actorName || "按原角色处理",
        r.version,
        r.submittedAt || "历史记录未提供",
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
