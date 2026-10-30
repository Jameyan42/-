import { defaultEntities } from "./entity-rule";
// @ts-ignore Original JS module remains shared with legacy expense approvals.
import { resolveBusinessApprovalNodes, validateSnapshot } from "../approval.js";
// @ts-ignore Reuse existing signature/bytes/format/size checks, never trust filenames alone.
import { validateAttachments } from "../attachments.js";
// @ts-ignore Existing request schema and operation-history validation.
import { validateRequest } from "../requests.js";
import { calendarOrdinal, parseYuan } from "../r001/rule";
import {
  defaultWorkflowConfig,
  materialTypes,
  materialLabels,
  type WorkflowConfig,
  type Workflow,
  type ApprovalPolicy,
  type AttachmentPolicy,
  type Org,
  type StoredFile,
  type NodeRole,
} from "./workflow-config";
import type { Input, Context, RuleResult, Status } from "./types";
export type Subcheck = {
  status: Status;
  message: string;
  evidence: Record<string, unknown>;
};
const time = (s: string) =>
  typeof s === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString() === s;
export function validateWorkflowConfig(c: WorkflowConfig) {
  if (
    !c ||
    !Number.isSafeInteger(c.version) ||
    c.version < 1 ||
    !Array.isArray(c.approvalPolicies) ||
    !Array.isArray(c.attachmentPolicies) ||
    c.approvalPolicies.length > 100 ||
    c.attachmentPolicies.length > 100
  )
    throw Error("审批附件政策格式或容量无效");
  const text = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= 500;
  for (const list of [c.approvalPolicies, c.attachmentPolicies]) {
    if (new Set(list.map((p) => p.policyId)).size !== list.length)
      throw Error("政策编号重复");
    for (const p of list)
      if (
        !text(p.policyId) ||
        !text(p.companyId) ||
        !text(p.expenseType) ||
        !text(p.description) ||
        !Number.isSafeInteger(p.minAmount) ||
        p.minAmount < 0 ||
        (p.maxAmount !== null &&
          (!Number.isSafeInteger(p.maxAmount) || p.maxAmount < p.minAmount)) ||
        calendarOrdinal(p.effectiveFrom) === null ||
        (p.effectiveTo !== null &&
          (calendarOrdinal(p.effectiveTo) === null ||
            p.effectiveTo < p.effectiveFrom)) ||
        !["ACTIVE", "DISABLED"].includes(p.status)
      )
        throw Error("政策金额（整数分）、日期或字段无效");
  }
  for (const p of c.approvalPolicies)
    if (
      (p.grade !== null && !text(p.grade)) ||
      !Array.isArray(p.requiredApprovalRoles) ||
      !p.requiredApprovalRoles.length ||
      p.requiredApprovalRoles.length > 2 ||
      new Set(p.requiredApprovalRoles).size !==
        p.requiredApprovalRoles.length ||
      p.requiredApprovalRoles.some(
        (r) => !["直属主管", "部门负责人"].includes(r),
      ) ||
      !Array.isArray(p.approvalSequence) ||
      p.approvalSequence.length !== p.requiredApprovalRoles.length ||
      new Set(p.approvalSequence).size !== p.approvalSequence.length ||
      p.approvalSequence.some((r) => !p.requiredApprovalRoles.includes(r)) ||
      typeof p.strictSequence !== "boolean" ||
      !["BLOCK", "REVIEW"].includes(p.sequenceSeverity) ||
      typeof p.allowSelf !== "boolean" ||
      typeof p.allowSamePerson !== "boolean"
    )
      throw Error("审批节点/顺序/职责分离配置无效");
  for (const p of c.attachmentPolicies)
    if (
      typeof p.requireBusinessDescription !== "boolean" ||
      !Array.isArray(p.requirements) ||
      p.requirements.length > 10 ||
      p.requirements.some(
        (r) =>
          !materialTypes.includes(r.type) ||
          typeof r.required !== "boolean" ||
          typeof r.perInvoice !== "boolean" ||
          typeof r.allowApprovedTravel !== "boolean" ||
          (r.allowApprovedTravel && r.type !== "TRAVEL_APPROVAL") ||
          (r.perInvoice && r.type !== "INVOICE"),
      )
    )
      throw Error("附件要求配置无效");
}
export function selectPolicy<T extends ApprovalPolicy | AttachmentPolicy>(
  d: Input,
  list: T[],
): { status: Status; matches: T[]; policy: T | null; message: string } {
  const n = parseYuan(d.amountYuan),
    date = d.businessDate || (d.expenseType === "住宿费" ? d.checkIn : "");
  if (
    !d.companyId ||
    !n.ok ||
    d.currency !== "CNY" ||
    calendarOrdinal(date) === null
  )
    return {
      status: "INSUFFICIENT_DATA",
      matches: [],
      policy: null,
      message: "请补充法人、业务日期与有效人民币金额",
    };
  const active = list.filter(
    (p) =>
      p.status === "ACTIVE" &&
      p.expenseType === d.expenseType &&
      ("grade" in p ? !p.grade || p.grade === d.grade : true) &&
      n.cents >= p.minAmount &&
      (p.maxAmount === null || n.cents <= p.maxAmount) &&
      date >= p.effectiveFrom &&
      (!p.effectiveTo || date <= p.effectiveTo),
  );
  const own = active.filter((p) => p.companyId === d.companyId),
    matches = own.length ? own : active.filter((p) => p.companyId === "*");
  if (!matches.length)
    return {
      status: "INSUFFICIENT_DATA",
      matches,
      policy: null,
      message: "没有适用政策，不默认合规",
    };
  // Multiple matching policy IDs are a configuration ambiguity even if wording is similar.
  if (matches.length > 1)
    return {
      status: "REVIEW",
      matches,
      policy: null,
      message: "同优先级有效政策冲突，请财务核实配置",
    };
  return {
    status: "PASS",
    matches,
    policy: matches[0]!,
    message: "命中唯一适用政策",
  };
}
export function approvalNodes(d: Input, org: Org, p: ApprovalPolicy) {
  const person = org.people.find((x) => x.id === d.applicantId && x.active);
  if (
    !person ||
    person.name !== d.employee ||
    org.departments.find((x) => x.id === person.departmentId)?.name !==
      d.department
  )
    throw Error("申请人编号、姓名及部门不符合当前组织关系");
  return resolveBusinessApprovalNodes(
    person.id,
    p.approvalSequence.map((r) => ({
      selector: r === "直属主管" ? "manager" : "departmentHead",
    })),
    org,
    { allowSelf: p.allowSelf, keepRepeated: true },
  ) as {
    actorId: string;
    actorName: string;
    role: string;
    label: NodeRole;
    stage: string;
  }[];
}
export function approvalCheck(
  d: Input,
  w: Workflow | null | undefined,
  config: WorkflowConfig,
  at: string,
  revision?: number,
): Subcheck {
  const match = selectPolicy(d, config.approvalPolicies),
    ev: Record<string, unknown> = {
      policyVersion: config.version,
      policy: match.policy,
      matches: match.matches,
      requiredNodes: match.policy?.approvalSequence || [],
      completedNodes: [],
      pendingNodes: [],
      records: w?.records || [],
      permissionCheck: "未校验",
      sequenceCheck: "未校验",
    };
  const out = (status: Status, message: string): Subcheck => ({
    status,
    message,
    evidence: ev,
  });
  if (!match.policy) return out(match.status, match.message);
  if (!w)
    return out(
      "REVIEW",
      "尚未提交业务审批，正常等待前置节点；最终财务批准前必须完成",
    );
  if (w.claimId !== d.id || w.applicantId !== d.applicantId)
    return out("BLOCK", "审批记录关联单据或申请人不一致");
  if (w.reimbursementVersion !== revision)
    return out("REVIEW", "资料已修改，旧版本审批失效，必须重新提交审批");
  let nodes: ReturnType<typeof approvalNodes>;
  try {
    nodes = approvalNodes(d, w.org, match.policy);
  } catch (e) {
    return out(
      String(e).includes("自批") ? "BLOCK" : "INSUFFICIENT_DATA",
      String(e),
    );
  }
  ev.requiredNodes = nodes;
  const records = w.records;
  if (
    records.some(
      (r) =>
        r.reimbursementId !== d.id ||
        r.reimbursementVersion !== w.reimbursementVersion ||
        r.policyVersion !== config.version ||
        !time(r.approvalTime) ||
        r.approvalTime < w.submittedAt ||
        r.approvalTime > at ||
        !r.approvalComment.trim(),
    )
  )
    return out("BLOCK", "审批记录版本、时间或关联信息不符合提交快照");
  for (const r of records) {
    const node = nodes[r.approvalLevel];
    const person = w.org.people.find((x) => x.id === r.approverId && x.active);
    if (
      !node ||
      node.label !== r.approverRole ||
      !person ||
      person.id !== node.actorId ||
      person.name !== r.approverName ||
      !["主管", "管理员"].includes(person.role)
    )
      return out("BLOCK", "审批记录中的审批人员不具备当前节点的授权权限");
    if (!match.policy.allowSelf && person.id === w.applicantId)
      return out("BLOCK", "审批存在职责分离冲突：禁止本人审批");
  }
  ev.permissionCheck = "依据提交时组织具名授权核验通过（模拟）";
  if (records.some((r) => r.approvalStatus === "REJECTED"))
    return out(
      "BLOCK",
      "当前版本存在有效审批驳回记录，不能继续批准；请修改并重新提交新版本",
    );
  if (records.some((r) => r.approvalStatus === "RETURNED"))
    return out("REVIEW", "当前版本已退回补充材料，必须补充并提交新版本审批");
  const approved = records.filter((r) => r.approvalStatus === "APPROVED");
  if (new Set(approved.map((r) => r.approvalLevel)).size !== approved.length)
    return out("BLOCK", "同一审批节点重复处理，记录异常");
  if (
    !match.policy.allowSamePerson &&
    new Set(approved.map((r) => r.approverId)).size !== approved.length
  )
    return out("BLOCK", "审批存在职责分离限制冲突：同一人不得完成多个制约节点");
  const actual = approved.map((r) => r.approvalLevel);
  ev.actualSequence = actual;
  if (
    match.policy.strictSequence &&
    approved.some(
      (r, i) =>
        r.approvalLevel !== i ||
        (i > 0 && r.approvalTime < approved[i - 1]!.approvalTime),
    )
  ) {
    ev.sequenceCheck = "审批顺序不符合制度";
    return out(match.policy.sequenceSeverity, "规定审批顺序与实际记录不一致");
  }
  ev.sequenceCheck = match.policy.strictSequence
    ? "强制顺序符合"
    : "政策未强制顺序";
  const pending = nodes.filter(
    (_, i) => !approved.some((r) => r.approvalLevel === i),
  );
  ev.completedNodes = approved;
  ev.pendingNodes = pending;
  return pending.length
    ? out(
        "REVIEW",
        `正常待审批：${pending.map((n) => n.label).join("、")}尚未完成，不代表员工违规`,
      )
    : out(
        "PASS",
        "当前报销单已完成适用政策要求的业务审批；财务最终审核尚需单独确认",
      );
}
export function allFiles(d: Input): StoredFile[] {
  return [
    ...(d.attachments || []),
    ...d.invoices.flatMap((i) =>
      i.attachment
        ? [
            {
              ...(i.attachment as StoredFile),
              storageStatus:
                (i.attachment as StoredFile).storageStatus || "SAVED",
              verificationStatus:
                (i.attachment as StoredFile).verificationStatus || "UNVERIFIED",
              materialType: "INVOICE" as const,
              linkedInvoiceIds: (i.attachment as StoredFile).linkedInvoiceIds
                ?.length
                ? (i.attachment as StoredFile).linkedInvoiceIds
                : [i.id],
            },
          ]
        : [],
    ),
  ];
}
export function inspectFile(
  f: StoredFile,
): "SAVED" | "MISSING" | "UNVERIFIED" | "REJECTED" {
  if (f.storageStatus !== "SAVED") return "MISSING";
  try {
    validateAttachments([f]);
  } catch {
    return "MISSING";
  }
  if (f.verificationStatus === "REJECTED") return "REJECTED";
  return f.verificationStatus === "VERIFIED" &&
    f.verifiedBy?.trim() &&
    f.verifiedAt &&
    time(f.verifiedAt)
    ? "SAVED"
    : "UNVERIFIED";
}
export function approvedTravel(d: Input, request: unknown): boolean {
  const r = request as any;
  try {
    validateRequest(r);
    validateSnapshot(r.approval, r.status, "request");
    if (!(
      r.id === d.travelRequestId &&
      r.status === "已批准" &&
      r.employee === d.employee &&
      r.approval.applicantId === d.applicantId &&
      r.department === d.department &&
      r.trip?.destination === d.city &&
      r.trip.start <= d.checkIn &&
      r.trip.end >= d.checkOut
    ))
      return false;
    const ops = r.history
      .map((h: any) => h.operation)
      .filter(
        (o: any) =>
          o &&
          o.runId === r.approval.submittedAt &&
          o.flowVersion === r.approval.version,
      );
    return (
      ops.length === r.approval.nodes.length &&
      ops.every(
        (o: any, i: number) =>
          o.action === "approve" &&
          o.kind === "request" &&
          o.actorId === r.approval.nodes[i].actorId &&
          o.role === r.approval.nodes[i].role &&
          o.summary.employee === r.employee &&
          o.summary.department === r.department &&
          o.summary.amount === r.amount &&
          o.at >= r.approval.submittedAt &&
          (!i || o.at >= ops[i - 1].at),
      ) &&
      ops.at(-1)?.toStatus === "已批准"
    );
  } catch {
    return false;
  }
}
export function attachmentCheck(
  d: Input,
  config: WorkflowConfig,
  travelRequest?: unknown,
): Subcheck {
  const match = selectPolicy(d, config.attachmentPolicies),
    files = allFiles(d),
    missing: string[] = [],
    unverified: string[] = [],
    rejected: string[] = [],
    ev = {
      policyVersion: config.version,
      policy: match.policy,
      matches: match.matches,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        materialType: f.materialType,
        storageStatus: f.storageStatus,
        verificationStatus: f.verificationStatus,
        linkedInvoiceIds: f.linkedInvoiceIds,
        inspection: inspectFile(f),
      })),
      missing,
      unverified,
      rejected,
    };
  const out = (status: Status, message: string): Subcheck => ({
    status,
    message,
    evidence: ev,
  });
  if (!match.policy) return out(match.status, match.message);
  for (const req of match.policy.requirements.filter((r) => r.required)) {
    if (req.allowApprovedTravel && approvedTravel(d, travelRequest)) {
      (ev as Record<string, unknown>).travelRequest = travelRequest;
      continue;
    }
    const groups = req.perInvoice
      ? d.invoices.map((i) => ({ key: i.id, label: `发票${i.number || i.id}` }))
      : [{ key: "", label: materialLabels[req.type] }];
    if (req.perInvoice && !groups.length) missing.push("发票记录及逐票原件");
    for (const group of groups) {
      const candidates = files.filter(
        (f) =>
          f.materialType === req.type &&
          (!group.key || f.linkedInvoiceIds?.includes(group.key)),
      );
      const good = candidates.filter((f) => inspectFile(f) !== "MISSING");
      // Approved travel exemption is accepted only through an explicit trusted context, not a UI checkbox.
      if (!good.length) {
        missing.push(group.label);
        continue;
      }
      if (good.some((f) => inspectFile(f) === "SAVED")) continue;
      if (good.some((f) => inspectFile(f) === "REJECTED"))
        rejected.push(group.label);
      else unverified.push(group.label);
    }
  }
  if (match.policy.requireBusinessDescription && !d.businessDescription?.trim())
    missing.push("招待事由/对象业务说明");
  if (rejected.length)
    return out("BLOCK", "必要附件内容核实为不符，请更换后重新审核");
  if (missing.length)
    return out(
      "INSUFFICIENT_DATA",
      "缺少必要附件或文件未成功保存：" + missing.join("、"),
    );
  if (unverified.length)
    return out(
      "REVIEW",
      "附件类型已登记，但内容尚未核实：" + unverified.join("、"),
    );
  return out(
    "PASS",
    "已满足配置的附件完整性要求；人工内容核实不代表票据真实或官方验真",
  );
}
export function workflowRule(d: Input, c: Context): RuleResult {
  const config =
    c.workflow?.config || c.workflowConfig || defaultWorkflowConfig();
  validateWorkflowConfig(config);
  const date = d.businessDate || (d.expenseType === "住宿费" ? d.checkIn : "");
  const validEntity = (c.entityConfig || defaultEntities()).companies.some(
    (x) =>
      x.companyId === d.companyId &&
      x.status === "启用" &&
      date >= x.effectiveFrom &&
      (!x.effectiveTo || date <= x.effectiveTo),
  );
  const entityIssue: Subcheck = {
    status: "INSUFFICIENT_DATA",
    message: "报销法人未配置、停用或不在业务日期有效期内",
    evidence: { companyId: d.companyId || "", date },
  };
  const approval = !validEntity
      ? entityIssue
      : c.authorizationHealthy === false
        ? {
            status: "INSUFFICIENT_DATA" as const,
            message: "当前组织配置异常，无法确认审批授权，已暂停财务批准",
            evidence: { authorizationHealthy: false },
          }
        : approvalCheck(d, c.workflow, config, c.at, c.claimRevision),
    attachments = !validEntity
      ? entityIssue
      : attachmentCheck(d, config, c.workflow?.travelRequest),
    priority: Status[] = [
      "ERROR",
      "BLOCK",
      "INSUFFICIENT_DATA",
      "REVIEW",
      "PASS",
      "NOT_APPLICABLE",
    ];
  const status = priority.find((s) =>
    [approval.status, attachments.status].includes(s),
  )!;
  return {
    ruleId: "R006",
    ruleKey: "workflow.approval-materials",
    ruleName: "审批流程与附件完整性",
    status,
    severity:
      status === "PASS" ? "none" : status === "REVIEW" ? "medium" : "high",
    message: `审批：${approval.message}；附件：${attachments.message}`,
    evidence: { approval, attachments, policyVersion: config.version },
    suggestedAction:
      status === "PASS"
        ? "进入独立财务最终复核，不重复要求财务前置批准"
        : "补齐必要审批和材料后重新审核；普通财务复核不得跳过未完成节点",
  };
}
export function workflowReady(r: RuleResult) {
  const e = r.evidence as { approval?: Subcheck; attachments?: Subcheck };
  return (
    r.status === "PASS" &&
    e?.approval?.status === "PASS" &&
    e?.attachments?.status === "PASS"
  );
}
