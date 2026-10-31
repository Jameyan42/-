import { resolveVersion, applySelection } from "./rule-config";
import { reconcileBudget, releaseBudget, budgetContext } from "./budget-model";
import { requiredBudgetEscalation } from "./budget-rule";
import { defaultEntities } from "./entity-rule";
import type { State, Claim, Input } from "./types";
import type {
  Org,
  Workflow,
  WorkflowConfig,
  ApprovalRecord,
  AuditOperation,
} from "./workflow-config";
import { defaultWorkflowConfig } from "./workflow-config";
import {
  selectPolicy,
  approvalNodes,
  approvalCheck,
  validateWorkflowConfig,
  allFiles,
} from "./workflow-rule";
// @ts-ignore Shared existing named-actor check, not a new workflow engine.
import { canApprove, approvalStatus } from "../approval.js";
// @ts-ignore Original organization validation remains authoritative.
import { validateOrg } from "../organization.js";
export function activeWorkflow(d: Claim) {
  if (d.withdrawal?.revision === d.revision) return undefined;
  return [...(d.workflows || [])]
    .reverse()
    .find((w) => w.reimbursementVersion === d.revision && !w.cancelledAt);
}
export function operation(
  d: Claim,
  type: string,
  actor: string,
  role: string,
  reason: string,
  at: string,
  before: unknown,
  after: unknown,
) {
  d.operations = [
    ...(d.operations || []),
    {
      id: crypto.randomUUID(),
      claimId: d.id,
      type,
      actor,
      role,
      reason,
      at,
      before: structuredClone(before),
      after: structuredClone(after),
    },
  ];
}
function validTime(s: string) {
  return (
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString() === s
  );
}
export function validateWorkflow(w: Workflow) {
  validateWorkflowConfig(w.config);
  validateOrg(w.org);
  if (
    !w.id ||
    !w.claimId ||
    !w.applicantId ||
    !Number.isSafeInteger(w.reimbursementVersion) ||
    w.reimbursementVersion < 1 ||
    !validTime(w.submittedAt) ||
    !Array.isArray(w.records) ||
    w.records.length > 20 ||
    new Set(w.records.map((r) => r.approvalId)).size !== w.records.length
  )
    throw Error("审批快照格式无效");
  for (const r of w.records)
    if (
      !r.approvalId ||
      r.reimbursementId !== w.claimId ||
      !r.approverId ||
      !r.approverName ||
      !["直属主管", "部门负责人", "预算负责人"].includes(r.approverRole) ||
      !Number.isInteger(r.approvalLevel) ||
      r.approvalLevel < 0 ||
      r.approvalLevel > 2 ||
      !["PENDING", "APPROVED", "REJECTED", "RETURNED"].includes(
        r.approvalStatus,
      ) ||
      !validTime(r.approvalTime) ||
      r.approvalTime < w.submittedAt ||
      !r.approvalComment.trim() ||
      r.approvalComment.length > 500 ||
      r.reimbursementVersion !== w.reimbursementVersion ||
      r.policyVersion !== w.config.version
    )
      throw Error("审批记录关联、状态、意见或版本无效");
}
export function submitWorkflow(
  s: State,
  id: string,
  org: Org,
  actor: { id: string; name: string; role: string },
  reason: string,
  at: string,
  workflowId: string,
  travelRequest?: unknown,
): State {
  const n = structuredClone(s),
    d = n.claims.find((d) => d.id === id);
  if (!d || !validTime(at) || !reason.trim() || reason.length > 500)
    throw Error("提交人员、原因、时间或单据无效");
  validateOrg(org);
  const person = org.people.find(
    (p) =>
      p.id === actor.id &&
      p.active &&
      p.role === actor.role &&
      p.name === actor.name,
  );
  if (
    !person ||
    !(
      person.id === d.input.applicantId ||
      ["财务", "管理员"].includes(person.role)
    )
  )
    throw Error("仅申请人或模拟财务/管理员可代提交业务审批");
  const date =
    d.input.businessDate ||
    (d.input.expenseType === "住宿费" ? d.input.checkIn : "");
  if (
    !(s.entityConfig || defaultEntities()).companies.some(
      (c) =>
        c.companyId === d.input.companyId &&
        c.status === "启用" &&
        date >= c.effectiveFrom &&
        (!c.effectiveTo || date <= c.effectiveTo),
    )
  )
    throw Error("报销法人未配置、停用或不在业务日期有效期内");
  if (d.budgetOpening || d.withdrawal?.revision === d.revision)
    throw Error(
      "期初模拟或已撤销版本不可直接提交，请创建/修改真实模拟报销版本",
    );
  const old = activeWorkflow(d);
  if (old)
    throw Error(
      "当前版本已经提交；驳回/退回后须修改资料形成新版本，不覆盖旧审批",
    );
  const ruleSelection=s.ruleBook?resolveVersion(s.ruleBook,d.input,'R006',at):undefined;
  const cfg=ruleSelection?applySelection(d.input,{at,standards:null,invoiceHistory:null,workflowConfig:s.workflowConfig},ruleSelection).workflowConfig:s.workflowConfig;
  const config = structuredClone(cfg || defaultWorkflowConfig());
  validateWorkflowConfig(config);
  const match = selectPolicy(d.input, config.approvalPolicies);
  if (!match.policy) throw Error(match.message);
  approvalNodes(d.input, org, match.policy);
  const w: Workflow = {
    ...(ruleSelection?{ruleSelection}:{}),
    id: workflowId,
    claimId: id,
    applicantId: d.input.applicantId!,
    reimbursementVersion: d.revision,
    submittedAt: at,
    config,
    org: structuredClone(org),
    records: [],
    ...(requiredBudgetEscalation(d.input, budgetContext(s, d, at, org), org)
      ? {
          budgetEscalation: requiredBudgetEscalation(
            d.input,
            budgetContext(s, d, at, org),
            org,
          )!,
        }
      : {}),
    ...(travelRequest ? { travelRequest: structuredClone(travelRequest) } : {}),
  };
  d.workflows = [...(d.workflows || []), w];
  d.submittedAt = d.submittedAt || at;
  d.currentBatchId = null;
  d.status = "草稿";
  operation(d, "提交业务审批", actor.name, actor.role, reason, at, null, {
    workflowId,
    revision: d.revision,
    policyVersion: config.version,
  });
  n.revision++;
  return reconcileBudget(n, id, "SUBMIT-" + workflowId, at, actor, org);
}
export function recordApproval(
  s: State,
  id: string,
  actor: { id: string; name: string; role: string },
  status: "APPROVED" | "REJECTED" | "RETURNED",
  comment: string,
  at: string,
  approvalId: string,
): State {
  const n = structuredClone(s),
    d = n.claims.find((d) => d.id === id),
    w = d && activeWorkflow(d);
  if (
    !d ||
    !w ||
    !validTime(at) ||
    at < w.submittedAt ||
    !comment.trim() ||
    comment.length > 500 ||
    !["APPROVED", "REJECTED", "RETURNED"].includes(status)
  )
    throw Error("审批意见、时间或有效提交版本缺失");
  const check = approvalCheck(d.input, w, w.config, at, d.revision);
  if (
    check.status === "BLOCK" ||
    w.records.some((r) => ["REJECTED", "RETURNED"].includes(r.approvalStatus))
  )
    throw Error("当前审批异常或已结束；须修改后重新提交新版本");
  const match = selectPolicy(d.input, w.config.approvalPolicies);
  if (!match.policy) throw Error(match.message);
  const nodes = approvalNodes(d.input, w.org, match.policy, w.budgetEscalation),
    level = nodes.findIndex(
      (_, i) =>
        !w.records.some(
          (r) => r.approvalLevel === i && r.approvalStatus === "APPROVED",
        ),
    );
  if (level < 0) throw Error("业务审批已完成，不重复处理");
  const snapshot = { kind: "expense", nodes, cursor: level };
  if (
    !canApprove({ approval: snapshot, status: approvalStatus(snapshot) }, actor)
  )
    throw Error("当前模拟身份不是本节点具名授权审批人");
  if (
    !match.policy.allowSamePerson &&
    w.records.some(
      (r) => r.approvalStatus === "APPROVED" && r.approverId === actor.id,
    )
  )
    throw Error("职责分离限制：同一人不得完成多个审批节点");
  if (!match.policy.allowSelf && actor.id === w.applicantId)
    throw Error("禁止本人自审批");
  const r: ApprovalRecord = {
    approvalId,
    reimbursementId: id,
    approverId: actor.id,
    approverName: actor.name,
    approverRole: nodes[level]!.label,
    approvalLevel: level,
    approvalStatus: status,
    approvalTime: at,
    approvalComment: comment.trim(),
    reimbursementVersion: d.revision,
    policyVersion: w.config.version,
  };
  if (actor.name !== nodes[level]!.actorName)
    throw Error("审批身份姓名与授权快照不符");
  w.records.push(r);
  d.currentBatchId = null;
  d.status = "草稿";
  operation(
    d,
    status === "APPROVED"
      ? "业务审批通过"
      : status === "REJECTED"
        ? "业务审批驳回"
        : "业务审批退回",
    actor.name,
    actor.role,
    comment,
    at,
    { pending: nodes[level] },
    r,
  );
  n.revision++;
  return status === "APPROVED"
    ? n
    : releaseBudget(
        n,
        id,
        "APPROVAL-" + approvalId,
        at,
        actor,
        status === "REJECTED" ? "业务驳回释放预算" : "业务退回补充释放预算",
      );
}
export function workflowStage(d: Claim): string {
  if (d.budgetOpening)
    return (
      "期初模拟" +
      (d.budgetOpening === "USED" ? "已使用（非正式财务审核）" : "预占")
    );
  if (d.withdrawal?.revision === d.revision) return "已撤销，需修改后重新提交";
  const w = activeWorkflow(d);
  if (!w)
    return d.workflows?.length
      ? "资料已变更，需重新提交审批"
      : "尚未提交业务审批";
  const r = approvalCheck(
    d.input,
    w,
    w.config,
    "9999-12-31T23:59:59.999Z",
    d.revision,
  );
  if (w.records.some((r) => r.approvalStatus === "REJECTED"))
    return "业务审批已驳回";
  if (w.records.some((r) => r.approvalStatus === "RETURNED"))
    return "待补充材料并重新提交";
  return r.status === "PASS" ? "待财务最终审核" : r.message;
}
export function configureWorkflow(
  s: State,
  config: WorkflowConfig,
  actor: { name: string; role: string },
  reason: string,
  at: string,
): State {
  if (
    !["财务", "管理员"].includes(actor.role) ||
    !actor.name.trim() ||
    !reason.trim() ||
    reason.length > 500 ||
    !validTime(at)
  )
    throw Error("仅模拟财务/管理员可维护制度，原因必填");
  if(s.ruleBook)throw Error("已启用版本管理，请在规则管理中心发布R006新版本");
  validateWorkflowConfig(config);
  const n = structuredClone(s);
  n.workflowConfig = {
    ...structuredClone(config),
    version: (s.workflowConfig?.version || 1) + 1,
  };
  n.workflowConfigChanges = [
    ...(n.workflowConfigChanges || []),
    {
      id: crypto.randomUUID(),
      claimId: "CONFIG",
      type: "审批附件政策变更",
      actor: actor.name,
      role: actor.role,
      reason,
      at,
      before: structuredClone(s.workflowConfig || defaultWorkflowConfig()),
      after: structuredClone(n.workflowConfig),
    },
  ];
  n.revision++;
  return n;
}
export function validateOperations(list: AuditOperation[]) {
  if (
    !Array.isArray(list) ||
    list.length > 200 ||
    new Set(list.map((x) => x.id)).size !== list.length
  )
    throw Error("操作日志容量或格式无效");
  for (const l of list)
    if (
      !l.id ||
      !l.claimId ||
      !l.type ||
      !l.actor?.trim() ||
      !l.role?.trim() ||
      !l.reason?.trim() ||
      l.reason.length > 500 ||
      !validTime(l.at) ||
      l.before === undefined ||
      l.after === undefined
    )
      throw Error("操作日志缺少前后内容或人员时间原因");
}
export function fileSummary(d: Input) {
  return allFiles(d).map((f) => ({
    id: f.id,
    name: f.name,
    materialType: f.materialType,
    linkedInvoiceIds: f.linkedInvoiceIds,
    verificationStatus: f.verificationStatus,
    storageStatus: f.storageStatus,
  }));
}

export function requestBudgetAuthorization(
  s: State,
  id: string,
  org: Org,
  actor: { id: string; name: string; role: string },
  reason: string,
  at: string,
): State {
  const n = structuredClone(s),
    d = n.claims.find((d) => d.id === id),
    w = d && activeWorkflow(d);
  if (
    !d ||
    !w ||
    !reason.trim() ||
    !validTime(at) ||
    !(
      actor.id === d.input.applicantId ||
      ["财务", "管理员"].includes(actor.role)
    )
  )
    throw Error("仅申请人/模拟财务可更新有效流程预算授权");
  if (
    w.records.some((r) => ["REJECTED", "RETURNED"].includes(r.approvalStatus))
  )
    throw Error("已驳回/退回流程须修改后重提");
  const extra = requiredBudgetEscalation(
    d.input,
    budgetContext(n, d, at, org),
    org,
  );
  if (!extra) throw Error("当前没有柔性超预算授权要求");
  if (w.records.some((r) => r.approverRole === "预算负责人"))
    throw Error(
      "原授权条件已变化，不能覆盖旧审批，请修改说明形成新版本并重新提交",
    );
  w.budgetEscalation = extra;
  d.currentBatchId = null;
  d.status = "草稿";
  operation(
    d,
    "增加预算负责人审批",
    actor.name,
    actor.role,
    reason,
    at,
    null,
    extra,
  );
  n.revision++;
  return n;
}
