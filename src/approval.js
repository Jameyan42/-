import { makeOperation } from "./operations.js";
import { validateOrg } from "./organization.js";
export const selectors = ["manager", "departmentHead", "person"];
export function defaultFlows() {
  const flow = () => ({
    threshold: 3000,
    type: "全部",
    low: [{ selector: "manager" }],
    high: [{ selector: "manager" }, { selector: "departmentHead" }],
  });
  return {
    version: 1,
    expense: flow(),
    request: flow(),
    financeId: "finance-zhou",
  };
}
export function financeDivisionFlows(previous, org) {
  const next = structuredClone(previous);
  next.ledgerId =
    org.people.find((p) => p.active && p.role === "总账")?.id || "";
  next.payerId =
    org.people.find((p) => p.active && p.role === "付款")?.id || "";
  next.expense.low = [{ selector: "departmentHead" }];
  next.expense.high = [{ selector: "departmentHead" }];
  validateFlows(next, org);
  return next;
}
const types = ["全部", "差旅交通", "业务招待", "办公采购", "其他费用"];
export function validateFlows(flows, org) {
  validateOrg(org);
  if (
    !flows ||
    !Number.isInteger(flows.version) ||
    flows.version < 1 ||
    flows.version > 1000000
  )
    throw Error("流程版本无效");
  const f = org.people.find((p) => p.id === flows.financeId);
  if (!f?.active || f.role !== "财务") throw Error("请选择在岗财务审核人");
  if (flows.ledgerId !== undefined || flows.payerId !== undefined) {
    const ledger = org.people.find((p) => p.id === flows.ledgerId),
      payer = org.people.find((p) => p.id === flows.payerId);
    if (
      !ledger?.active ||
      ledger.role !== "总账" ||
      !payer?.active ||
      payer.role !== "付款"
    )
      throw Error("完整财务分工必须配置在岗总账和付款人员");
    if (new Set([f.id, ledger.id, payer.id]).size !== 3)
      throw Error("财务、总账和付款须由不同人员承担");
  }
  for (const kind of ["expense", "request"]) {
    const rule = flows[kind];
    if (
      !rule ||
      !Number.isFinite(rule.threshold) ||
      rule.threshold < 0 ||
      rule.threshold > 1000000 ||
      !types.includes(rule.type)
    )
      throw Error("金额条件或费用类型无效");
    for (const branch of ["low", "high"]) {
      if (
        !Array.isArray(rule[branch]) ||
        !rule[branch].length ||
        rule[branch].length > 4
      )
        throw Error("每条分支需配置 1～4 个顺序审批节点");
      for (const node of rule[branch]) {
        if (!node || !selectors.includes(node.selector))
          throw Error("审批节点选择器无效");
        if (node.selector === "person") {
          const p = org.people.find((p) => p.id === node.personId);
          if (!p?.active || !["主管", "管理员"].includes(p.role))
            throw Error("指定审批人必须是在岗主管或管理员");
        }
      }
    }
  }
  // Resolve both branches for every active applicant; no unmatched or unassigned routes may be published.
  for (const applicant of org.people.filter(
    (p) => p.active && p.role === "员工",
  ))
    for (const kind of ["expense", "request"])
      for (const branch of ["low", "high"])
        resolveNodes(flows[kind][branch], applicant, org);
  return flows;
}
function resolveNodes(nodes, applicant, org) {
  const result = [],
    seen = new Set();
  for (const node of nodes) {
    const id =
      node.selector === "manager"
        ? applicant.managerId
        : node.selector === "departmentHead"
          ? org.departments.find((d) => d.id === applicant.departmentId)?.headId
          : node.personId;
    const p = org.people.find((p) => p.id === id);
    if (!p?.active || !["主管", "管理员"].includes(p.role))
      throw Error(`${applicant.name}的审批路径缺少有效审批人`);
    if (p.id === applicant.id) throw Error("不允许申请人自批");
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    result.push({
      actorId: p.id,
      actorName: p.name,
      role: p.role,
      label:
        node.selector === "manager"
          ? "直属主管"
          : node.selector === "departmentHead"
            ? "部门负责人"
            : "指定人员",
      stage: "business",
    });
  }
  return result;
}
export function compileApproval(doc, kind, org, flows) {
  validateFlows(flows, org);
  const person = org.people.find(
    (p) => p.active && p.role === "员工" && p.name === doc.employee,
  );
  if (
    !person ||
    org.departments.find((d) => d.id === person.departmentId)?.name !==
      doc.department
  )
    throw Error("申请人与当前组织归属不一致，请核对组织配置");
  const rule = flows[kind],
    branch =
      doc.amount > rule.threshold &&
      (rule.type === "全部" || rule.type === doc.type)
        ? "high"
        : "low";
  const nodes = resolveNodes(rule[branch], person, org);
  if (kind === "expense") {
    const p = org.people.find((p) => p.id === flows.financeId);
    nodes.push({
      actorId: p.id,
      actorName: p.name,
      role: p.role,
      label: "财务审核",
      stage: "finance",
    });
  }
  const extended = kind === "expense" && flows.ledgerId !== undefined;
  let paymentActor;
  if (extended) {
    const ledger = org.people.find((p) => p.id === flows.ledgerId),
      payer = org.people.find((p) => p.id === flows.payerId);
    nodes.push({
      actorId: ledger.id,
      actorName: ledger.name,
      role: "总账",
      label: "总账复核",
      stage: "ledger",
    });
    paymentActor = {
      actorId: payer.id,
      actorName: payer.name,
      role: "付款",
      label: "付款登记",
      stage: "payment",
    };
  }
  return {
    schema: extended ? 2 : 1,
    ...(paymentActor ? { paymentActor } : {}),
    version: flows.version,
    kind,
    branch,
    condition: `金额 > ${rule.threshold} 且类型 ${rule.type}`,
    applicantId: person.id,
    submittedAt: new Date().toISOString(),
    nodes,
    cursor: 0,
  };
}
export function approvalStatus(snapshot) {
  const node = snapshot.nodes[snapshot.cursor];
  return node
    ? node.stage === "ledger"
      ? "待总账复核"
      : node.stage === "finance"
        ? "待财务审核"
        : snapshot.kind === "expense"
          ? "待主管审批"
          : "待审批"
    : snapshot.kind === "expense"
      ? "待付款"
      : "已批准";
}
export function canApprove(doc, actor) {
  if (!doc.approval) return false;
  const a = doc.approval;
  if (doc.status !== approvalStatus(a) || a.cursor >= a.nodes.length)
    return false;
  return (
    a.nodes[a.cursor].actorId === actor.id &&
    a.nodes[a.cursor].role === actor.role
  );
}
export function advanceApproval(
  doc,
  action,
  actor,
  note = "",
  ledgerReview = null,
) {
  if (!["approve", "reject"].includes(action) || !canApprove(doc, actor))
    throw Error("当前身份不是本节点指定审批人");
  if (action === "reject" && !note.trim()) throw Error("请填写退回/驳回原因");
  if (note.length > 500) throw Error("处理备注不能超过500字");
  const approval = structuredClone(doc.approval);
  const node = approval.nodes[approval.cursor];
  if (
    action === "approve" &&
    node.stage === "finance" &&
    (doc.flags || []).length
  )
    throw Error("存在未解决的预审风险，请退回员工修正");
  let accounting;
  if (action === "approve" && node.stage === "ledger") {
    if ((doc.flags || []).length)
      throw Error("存在未解决的预审风险，请退回员工修正");
    accounting = validateLedgerReview({
      ...ledgerReview,
      reviewedBy: actor.id,
      at: new Date().toISOString(),
    });
  }
  if (action === "approve") approval.cursor++;
  const status =
    action === "reject"
      ? approval.kind === "expense"
        ? "已退回"
        : "已驳回"
      : approvalStatus(approval);
  return {
    ...doc,
    approval,
    status,
    ...(accounting ? { ledgerReview: accounting } : {}),
    history: [
      ...doc.history,
      {
        operation: makeOperation({
          doc,
          kind: approval.kind,
          actor,
          action,
          stage: node.stage,
          label: node.label,
          toStatus: status,
          note,
          accounting,
        }),
        text: `${actor.name}（${node.label}）${action === "reject" ? "退回/驳回：" + note : "审批通过" + (note ? "：" + note : "")}`,
        time: new Date().toLocaleString("zh-CN"),
      },
    ],
  };
}
export function validateSnapshot(a, status, kind) {
  if (
    !a ||
    ![1, 2].includes(a.schema) ||
    a.kind !== kind ||
    !Number.isInteger(a.version) ||
    a.version < 1 ||
    !["low", "high"].includes(a.branch) ||
    typeof a.condition !== "string" ||
    a.condition.length > 200 ||
    typeof a.applicantId !== "string" ||
    !a.applicantId ||
    a.applicantId.length > 60 ||
    typeof a.submittedAt !== "string" ||
    Number.isNaN(Date.parse(a.submittedAt)) ||
    !Array.isArray(a.nodes) ||
    !a.nodes.length ||
    a.nodes.length > (a.schema === 2 ? 6 : 5) ||
    !Number.isInteger(a.cursor) ||
    a.cursor < 0 ||
    a.cursor > a.nodes.length
  )
    throw Error("审批快照格式无效");
  const ids = new Set();
  for (const n of a.nodes) {
    if (
      !n ||
      typeof n.actorId !== "string" ||
      !n.actorId ||
      n.actorId.length > 60 ||
      typeof n.actorName !== "string" ||
      !n.actorName ||
      n.actorName.length > 30 ||
      typeof n.label !== "string" ||
      n.label.length > 40 ||
      !["主管", "管理员", "财务", "总账"].includes(n.role) ||
      !["business", "finance", "ledger"].includes(n.stage) ||
      ids.has(n.actorId) ||
      n.actorId === a.applicantId ||
      (n.stage === "business" && !["主管", "管理员"].includes(n.role)) ||
      (n.stage === "finance" && n.role !== "财务") ||
      (n.stage === "ledger" && n.role !== "总账")
    )
      throw Error("审批快照节点无效");
    ids.add(n.actorId);
  }
  const financial = a.nodes.filter((n) => n.stage === "finance"),
    ledgers = a.nodes.filter((n) => n.stage === "ledger");
  const extended = a.schema === 2;
  if (kind === "expense") {
    if (
      financial.length !== 1 ||
      (extended
        ? ledgers.length !== 1 ||
          a.nodes.at(-1).stage !== "ledger" ||
          a.nodes.at(-2)?.stage !== "finance"
        : ledgers.length || a.nodes.at(-1).stage !== "finance")
    )
      throw Error("审批快照财务节点不完整");
  } else if (
    extended ||
    financial.length ||
    ledgers.length ||
    a.paymentActor !== undefined
  )
    throw Error("费用申请不允许财务尾节点");
  if (extended) {
    const p = a.paymentActor;
    if (
      !p ||
      typeof p.actorId !== "string" ||
      !p.actorId ||
      p.actorId.length > 60 ||
      typeof p.actorName !== "string" ||
      !p.actorName ||
      p.actorName.length > 30 ||
      p.role !== "付款" ||
      p.stage !== "payment" ||
      p.label !== "付款登记" ||
      ids.has(p.actorId) ||
      p.actorId === a.applicantId
    )
      throw Error("审批快照付款责任人无效");
  } else if (a.paymentActor !== undefined)
    throw Error("旧快照不能包含新付款节点");
  const terminal =
    kind === "expense" ? ["已退回", "已撤回"] : ["已驳回", "已关闭"];
  if (
    !terminal.includes(status) &&
    status !==
      (a.cursor === a.nodes.length
        ? kind === "expense" && status === "已付款"
          ? "已付款"
          : approvalStatus(a)
        : approvalStatus(a))
  )
    throw Error("单据状态与审批快照不一致");
  if (status === "草稿") throw Error("草稿不能包含运行中的审批快照");
  return a;
}

export function validateLedgerReview(value) {
  if (
    !value ||
    typeof value.account !== "string" ||
    !value.account.trim() ||
    value.account.length > 100 ||
    typeof value.costCenter !== "string" ||
    !value.costCenter.trim() ||
    value.costCenter.length > 100 ||
    typeof value.reviewedBy !== "string" ||
    !value.reviewedBy ||
    typeof value.at !== "string" ||
    Number.isNaN(Date.parse(value.at))
  )
    throw Error("请填写总账科目与核算归属（各1～100字）");
  return {
    account: value.account.trim(),
    costCenter: value.costCenter.trim(),
    reviewedBy: value.reviewedBy,
    at: value.at,
  };
}
