import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Shared fixtures and existing approval framework.
import { defaultOrg, enterpriseOrg } from "../organization.js";
// @ts-ignore Request compile is reused to demonstrate structured travel evidence.
import { compileApproval, defaultFlows, advanceApproval } from "../approval.js";
import {
  defaultWorkflowConfig,
  type Workflow,
  type Org,
} from "./workflow-config";
import {
  approvalCheck,
  attachmentCheck,
  workflowRule,
  selectPolicy,
  approvalNodes,
  validateWorkflowConfig,
} from "./workflow-rule";
import {
  submitWorkflow,
  recordApproval,
  activeWorkflow,
  configureWorkflow,
} from "./workflow-model";
import {
  empty,
  saveDraft,
  execute,
  current,
  review,
  validate,
  load,
  save,
} from "./model";
import { sampleFiles, testAt as at } from "./workflow-fixtures";
import { auditAll } from "./rules";
import { defaultEntities } from "./entity-rule";
import { createExampleStandards } from "../r001/standards";
import { createMockHistory } from "../r002/invoiceMockData";
import type { Input, Context } from "./types";
const bill = (): Input => ({
  id: "R006-BILL",
  applicantId: "lin",
  departmentId: "sales",
  companyId: "SZ",
  employee: "林晓",
  department: "销售部",
  grade: "普通员工",
  expenseType: "住宿费",
  businessDate: "2026-10-20",
  accountCode: "6602.01",
  accountStage: "财务确认",
  businessScenario: "出差住宿",
  businessDescription: "虚构出差",
  amountYuan: "800",
  currency: "CNY",
  city: "深圳",
  checkIn: "2026-10-20",
  checkOut: "2026-10-23",
  hotel: "模拟酒店",
  hotelAmountYuan: "800",
  partialReason: "",
  attachments: sampleFiles(["I1"]),
  invoices: [
    {
      id: "I1",
      type: "数电发票",
      code: "",
      number: "99887766554433221100",
      amountYuan: "800",
      currency: "CNY",
      date: "2026-10-23",
      sellerName: "模拟酒店",
      sellerTaxId: "",
      buyerName: "星河科技（深圳）有限公司",
      buyerTaxId: "DEMO-SZ-001",
      source: "manual",
    },
  ],
});
const ctx = (): Context => ({
  at,
  standards: createExampleStandards(),
  invoiceHistory: createMockHistory(),
  entityConfig: defaultEntities(),
});
const finance = { id: "finance-zhou", name: "周宁", role: "财务" },
  manager = { id: "manager-zhao", name: "赵航", role: "主管" },
  head = { id: "head-xu", name: "许明", role: "主管" };
function submitted(d = bill()) {
  return submitWorkflow(
    saveDraft(empty(), d, at),
    d.id,
    defaultOrg(),
    finance,
    "提交演示审批",
    at,
    "WF1",
  );
}
function approve(
  s: ReturnType<typeof empty>,
  actor = manager,
  status: "APPROVED" | "REJECTED" | "RETURNED" = "APPROVED",
) {
  return recordApproval(
    s,
    "R006-BILL",
    actor,
    status,
    "具名模拟审批意见",
    at,
    crypto.randomUUID(),
  );
}
const check = (s: ReturnType<typeof empty>) => {
  const d = s.claims[0]!,
    w = activeWorkflow(d)!;
  return approvalCheck(d.input, w, w.config, at, d.revision);
};
test("T001 800元主管通过，R006-A PASS且财务最终审核尚未完成", () =>
  assert.equal(check(approve(submitted())).status, "PASS"));
test("T002 1500元仅主管，正常待部门负责人REVIEW并阻止最终批准", () => {
  const d = bill();
  d.amountYuan = d.hotelAmountYuan = d.invoices[0]!.amountYuan = "1500";
  let s = approve(submitted(d));
  assert.equal(check(s).status, "REVIEW");
  s = execute(s, d.id, ctx(), "B1");
  assert.throws(
    () => review(s, d.id, "B1", "approved", "同意", "财务", at),
    /审批或附件/,
  );
});
test("T003 伪造角色文字不能赋予权限，未知/普通员工BLOCK", () => {
  const s = approve(submitted());
  const w = activeWorkflow(s.claims[0]!)!;
  w.records[0]!.approverId = "lin";
  w.records[0]!.approverName = "林晓";
  assert.equal(check(s).status, "BLOCK");
  assert.throws(
    () => approve(submitted(), { id: "lin", name: "林晓", role: "主管" }),
    /授权/,
  );
});
test("T004 强制顺序颠倒BLOCK，配置提醒REVIEW保留顺序依据", () => {
  const d = bill();
  d.amountYuan = "1500";
  let s = approve(approve(submitted(d)), head);
  const w = activeWorkflow(s.claims[0]!)!;
  w.records.reverse();
  assert.equal(check(s).status, "BLOCK");
  w.config.approvalPolicies.find(
    (p) => p.policyId === "AP-SZ-HIGH",
  )!.sequenceSeverity = "REVIEW";
  assert.equal(check(s).status, "REVIEW");
});
test("T005 当前版本驳回后不得覆盖/继续，修改后新版本新审批保留原拒绝", () => {
  let s = approve(submitted(), manager, "REJECTED");
  assert.equal(check(s).status, "BLOCK");
  assert.throws(() => approve(s));
  assert.throws(() =>
    submitWorkflow(s, "R006-BILL", defaultOrg(), finance, "重提", at, "WF2"),
  );
  s = saveDraft(
    s,
    { ...s.claims[0]!.input, businessDescription: "修改原因和资料" },
    at,
    { actor: "林晓", role: "员工", reason: "补正后重新提交" },
  );
  s = submitWorkflow(
    s,
    "R006-BILL",
    defaultOrg(),
    finance,
    "新版本提交",
    at,
    "WF2",
  );
  assert.equal(
    s.claims[0]!.workflows![0]!.records[0]!.approvalStatus,
    "REJECTED",
  );
  assert.equal(activeWorkflow(s.claims[0]!)!.records.length, 0);
});
test("T006 自审批与同人多节点禁止；配置允许兼任才可完成", () => {
  const d = bill();
  d.amountYuan = "1500";
  const org = defaultOrg() as Org;
  org.departments.find((d) => d.id === "sales")!.headId = "manager-zhao";
  let s = submitWorkflow(
    saveDraft(empty(), d, at),
    d.id,
    org,
    finance,
    "同人双节点测试",
    at,
    "WF",
  );
  s = approve(s);
  assert.throws(() => approve(s), /职责分离/);
  const w = activeWorkflow(s.claims[0]!)!;
  w.config.approvalPolicies.find(
    (p) => p.policyId === "AP-SZ-HIGH",
  )!.allowSamePerson = true;
  s = approve(s);
  assert.equal(check(s).status, "PASS");
  const bad = activeWorkflow(s.claims[0]!)!;
  bad.records[0]!.approverId = "lin";
  bad.records[0]!.approverName = "林晓";
  assert.equal(check(s).status, "BLOCK");
});
test("T007 审批后800改1500，旧审批和审核保留，新版本要求两节点", () => {
  let s = execute(approve(submitted()), "R006-BILL", ctx(), "B1");
  const before = structuredClone(s.claims[0]!.batches[0]);
  s = saveDraft(
    s,
    { ...s.claims[0]!.input, amountYuan: "1500", hotelAmountYuan: "1500" },
    at,
    { actor: "林晓", role: "员工", reason: "修改金额" },
  );
  assert.equal(current(s.claims[0]!), undefined);
  assert.equal(activeWorkflow(s.claims[0]!), undefined);
  s = submitWorkflow(
    s,
    "R006-BILL",
    defaultOrg(),
    finance,
    "金额变化重新提交",
    at,
    "WF2",
  );
  assert.equal(check(s).status, "REVIEW");
  assert.deepEqual(s.claims[0]!.batches[0], before);
  assert.equal((check(s).evidence.requiredNodes as unknown[]).length, 2);
});
test("T008 必要文件字节已保存且人工核实，R006-B PASS", () =>
  assert.equal(
    attachmentCheck(bill(), defaultWorkflowConfig()).status,
    "PASS",
  ));
test("T009 仅手工发票字段无文件INFO，不视为已上传", () =>
  assert.equal(
    attachmentCheck({ ...bill(), attachments: [] }, defaultWorkflowConfig())
      .status,
    "INSUFFICIENT_DATA",
  ));
test("T010 缺少规定出差材料INFO", () => {
  const d = bill();
  d.attachments = d.attachments!.filter((f) => f.materialType === "INVOICE");
  assert.match(
    attachmentCheck(d, defaultWorkflowConfig()).message,
    /出差审批材料/,
  );
});
test("T011 酒店明细是可选，未上传不误报", () =>
  assert.equal(
    attachmentCheck(bill(), defaultWorkflowConfig()).status,
    "PASS",
  ));
test("T012 保存失败/只有元数据/伪文件签名均不得通过", () => {
  for (const patch of [
    { storageStatus: "FAILED" },
    { storageStatus: "METADATA_ONLY" },
    { data: "data:application/pdf;base64," + btoa("not pdf"), size: 7 },
  ]) {
    const d = bill();
    Object.assign(d.attachments![0]!, patch);
    assert.equal(
      attachmentCheck(d, defaultWorkflowConfig()).status,
      "INSUFFICIENT_DATA",
    );
  }
});
test("T013 内容未核实REVIEW，明确不符BLOCK，不冒充官方验真", () => {
  const d = bill();
  d.attachments![0]!.verificationStatus = "UNVERIFIED";
  assert.equal(attachmentCheck(d, defaultWorkflowConfig()).status, "REVIEW");
  d.attachments![0]!.verificationStatus = "REJECTED";
  assert.equal(attachmentCheck(d, defaultWorkflowConfig()).status, "BLOCK");
});
test("T014 三票逐张关联，单文件不自动覆盖；明确关联多票PDF可用", () => {
  const d = bill();
  d.invoices = [
    d.invoices[0]!,
    { ...d.invoices[0]!, id: "I2" },
    { ...d.invoices[0]!, id: "I3" },
  ];
  assert.equal(
    attachmentCheck(d, defaultWorkflowConfig()).status,
    "INSUFFICIENT_DATA",
  );
  d.attachments![0]!.linkedInvoiceIds = ["I1", "I2", "I3"];
  assert.equal(attachmentCheck(d, defaultWorkflowConfig()).status, "PASS");
});
test("T015 删除/替换必要附件，当前批准及审批失效，前后文件和操作日志保留", () => {
  let s = execute(approve(submitted()), "R006-BILL", ctx(), "B1");
  const approved = review(
    s,
    "R006-BILL",
    "B1",
    "approved",
    "六规则已核实",
    "财务",
    at,
  );
  assert.throws(
    () =>
      saveDraft(
        approved,
        { ...approved.claims[0]!.input, attachments: [] },
        at,
        { actor: "林晓", role: "员工", reason: "批准后不可删原件" },
      ),
    /冲销/,
  );
  s = saveDraft(s, { ...s.claims[0]!.input, attachments: [] }, at, {
    actor: "林晓",
    role: "员工",
    reason: "删除附件测试",
  });
  assert.equal(current(s.claims[0]!), undefined);
  assert.equal(activeWorkflow(s.claims[0]!), undefined);
  assert.equal(s.claims[0]!.changes!.at(-1)!.before.attachments!.length, 2);
  assert.equal(approved.claims[0]!.batches[0]!.review!.decision, "approved");
  assert.ok(s.claims[0]!.operations!.some((l) => l.type === "资料/附件变更"));
  assert.ok(s.claims[0]!.operations!.some((l) => l.type === "附件删除"));
});
test("T016 政策修改不改变已提交审批/历史审核，只有新提交采用新版本", () => {
  let s = execute(approve(submitted()), "R006-BILL", ctx(), "B1");
  const old = structuredClone(s.claims[0]!.batches[0]);
  const c = defaultWorkflowConfig();
  c.approvalPolicies.find((p) => p.policyId === "AP-SZ-LOW")!.maxAmount = 50000;
  c.approvalPolicies.find((p) => p.policyId === "AP-SZ-HIGH")!.minAmount =
    50001;
  s = configureWorkflow(s, c, finance, "修订制度", at);
  s = execute(s, "R006-BILL", ctx(), "B2");
  assert.deepEqual(s.claims[0]!.batches[0], old);
  assert.equal(current(s.claims[0]!)!.context.workflow!.config.version, 1);
  s = saveDraft(
    s,
    { ...s.claims[0]!.input, businessDescription: "新业务版本" },
    at,
    { actor: "财务", role: "财务", reason: "制度新版本重提" },
  );
  s = submitWorkflow(
    s,
    "R006-BILL",
    defaultOrg(),
    finance,
    "明确重提",
    at,
    "WF2",
  );
  assert.equal(activeWorkflow(s.claims[0]!)!.config.version, 2);
  validate(s);
});
test("六规则正常→独立财务批准→刷新，无最终审批循环依赖", () => {
  let s = execute(approve(submitted()), "R006-BILL", ctx(), "B1");
  assert.deepEqual(
    current(s.claims[0]!)!.results.map((r) => r.status),
    Array(7).fill("PASS"),
  );
  assert.equal(current(s.claims[0]!)!.review, null);
  s = review(s, "R006-BILL", "B1", "approved", "独立财务复核", "财务", at);
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_k: string, v: string) => {
      raw = v;
    },
  };
  save(storage, s, null);
  assert.deepEqual(load(storage).state, s);
});
test("六异常同批并保留R006-A/B，缺附件不隐藏待部门负责人", () => {
  const d = bill();
  d.amountYuan = d.hotelAmountYuan = "1800";
  d.checkOut = "2026-10-21";
  d.attachments = [];
  d.accountCode = "6602.02";
  Object.assign(d.invoices[0]!, {
    type: "增值税电子普通发票",
    code: "044001900111",
    number: "12345678",
    amountYuan: "1000",
    buyerName: "星河科技（东莞）有限公司",
    buyerTaxId: "DEMO-DG-001",
  });
  const s = execute(approve(submitted(d)), d.id, ctx(), "B1"),
    r = current(s.claims[0]!)!.results;
  assert.deepEqual(
    r.map((r) => r.status),
    [
      "REVIEW",
      "REVIEW",
      "BLOCK",
      "BLOCK",
      "BLOCK",
      "INSUFFICIENT_DATA",
      "PASS",
    ],
  );
  const e = r[5]!.evidence as any;
  assert.equal(e.approval.status, "REVIEW");
  assert.equal(e.attachments.status, "INSUFFICIENT_DATA");
});
test("不同法人阈值、有效期、缺失、冲突和执行ERROR", () => {
  const c = defaultWorkflowConfig(),
    d = bill();
  d.amountYuan = "1500";
  assert.equal(
    selectPolicy(d, c.approvalPolicies).policy!.requiredApprovalRoles.length,
    2,
  );
  d.companyId = "DG";
  assert.equal(
    selectPolicy(d, c.approvalPolicies).policy!.requiredApprovalRoles.length,
    1,
  );
  d.companyId = "SZ";
  c.approvalPolicies.push({
    ...c.approvalPolicies.find((p) => p.policyId === "AP-SZ-HIGH")!,
    policyId: "CONFLICT",
  });
  assert.equal(selectPolicy(d, c.approvalPolicies).status, "REVIEW");
  c.approvalPolicies = [];
  assert.equal(selectPolicy(d, c.approvalPolicies).status, "INSUFFICIENT_DATA");
  c.version = -1;
  const rs = auditAll(d, { ...ctx(), workflowConfig: c });
  assert.equal(rs[5]!.status, "ERROR");
  assert.equal(rs.length, 7);
  assert.throws(() => validateWorkflowConfig(c));
});
test("RETURNED与PENDING不伪造已通过，审计保护存储并发和配额", () => {
  let s = approve(submitted(), manager, "RETURNED");
  assert.equal(check(s).status, "REVIEW");
  s = execute(s, "R006-BILL", ctx(), "B1");
  assert.throws(
    () => review(s, "R006-BILL", "B1", "approved", "跳过退回", "财务", at),
    /审批或附件/,
  );
  const before = JSON.stringify(s);
  assert.throws(() =>
    save(
      {
        getItem: () => null,
        setItem: () => {
          throw Error("quota");
        },
      },
      s,
      null,
    ),
  );
  assert.equal(JSON.stringify(s), before);
  const w = activeWorkflow(s.claims[0]!)!;
  w.records[0]!.approvalStatus = "PENDING";
  assert.equal(check(s).status, "REVIEW");
});
test("有完整系统出差审批时按政策可替代截图，伪造已批准文字/不匹配不得替代", () => {
  const d = bill();
  d.travelRequestId = "REQ1";
  d.attachments = d.attachments!.filter((f) => f.materialType === "INVOICE");
  const r = {
    id: "REQ1",
    name: "虚构出差申请",
    employee: "林晓",
    department: "销售部",
    status: "已批准",
    type: "差旅交通",
    amount: 2000,
    month: "2026-10",
    note: "虚构申请",
    history: [],
    trip: {
      origin: "东莞",
      destination: "深圳",
      cityLevel: "重点城市",
      grade: "普通员工",
      start: "2026-10-20",
      end: "2026-10-23",
    },
    approval: {
      schema: 1,
      version: 1,
      kind: "request",
      branch: "low",
      condition: "模拟审批",
      applicantId: "lin",
      submittedAt: at,
      nodes: [
        {
          actorId: "manager-zhao",
          actorName: "赵航",
          role: "主管",
          label: "直属主管",
          stage: "business",
        },
      ],
      cursor: 1,
    },
  };
  const pending = { ...r, status: "待审批" };
  pending.approval = compileApproval(
    pending,
    "request",
    defaultOrg(),
    defaultFlows(),
  );
  const approved = advanceApproval(
    pending,
    "approve",
    manager,
    "已批准虚构出差",
  );
  assert.equal(
    attachmentCheck(d, defaultWorkflowConfig(), approved).status,
    "PASS",
  );
  assert.equal(
    attachmentCheck(d, defaultWorkflowConfig(), r).status,
    "INSUFFICIENT_DATA",
  );
  assert.equal(
    attachmentCheck(d, defaultWorkflowConfig(), { ...r, approval: null })
      .status,
    "INSUFFICIENT_DATA",
  );
  assert.equal(
    attachmentCheck(d, defaultWorkflowConfig(), { ...r, employee: "其他人" })
      .status,
    "INSUFFICIENT_DATA",
  );
});
test("旧五规则批次保持五项，不追补R006；原始数据无静默重写", () => {
  const s = execute(approve(submitted()), "R006-BILL", ctx(), "B1"),
    b = s.claims[0]!.batches[0]!;
  b.ruleKeys = b.ruleKeys.filter(
    (k) => !["workflow.approval-materials", "budget.capacity"].includes(k),
  );
  b.results = b.results.filter((r) => !["R006", "R007"].includes(r.ruleId));
  delete b.context.workflow;
  delete b.context.workflowConfig;
  delete b.context.claimRevision;
  delete s.claims[0]!.workflows;
  delete s.workflowConfig;
  validate(s);
  const raw = JSON.stringify(s);
  assert.equal(load({ getItem: () => raw }).raw, raw);
  assert.equal(b.results.length, 5);
  assert.throws(
    () =>
      review(
        s,
        "R006-BILL",
        "B1",
        "approved",
        "旧规则不能作新批准",
        "财务",
        at,
      ),
    /未执行R006/,
  );
});
test("组织配置损坏不使用回退组织宣称授权通过，旧真实文件默认待核实", () => {
  const d = bill(),
    s = approve(submitted()),
    w = activeWorkflow(s.claims[0]!)!;
  const r = workflowRule(d, {
    ...ctx(),
    workflow: w,
    claimRevision: 1,
    authorizationHealthy: false,
  });
  assert.equal((r.evidence as any).approval.status, "INSUFFICIENT_DATA");
  const legacy = d.attachments![0]!;
  d.attachments = d.attachments!.slice(1);
  d.invoices[0]!.attachment = {
    id: legacy.id,
    name: legacy.name,
    type: legacy.type,
    kind: "发票",
    size: legacy.size,
    data: legacy.data,
  };
  assert.equal(attachmentCheck(d, defaultWorkflowConfig()).status, "REVIEW");
});
test("本人审批只有组织关系与政策显式授权时才允许；否则BLOCK", () => {
  const d = bill();
  d.amountYuan = "1500";
  const org = defaultOrg() as Org;
  org.people.find((p) => p.id === "lin")!.role = "主管";
  org.departments.find((d) => d.id === "sales")!.headId = "lin";
  const config = defaultWorkflowConfig();
  config.approvalPolicies.find((p) => p.policyId === "AP-SZ-HIGH")!.allowSelf =
    true;
  let s = empty();
  s.workflowConfig = config;
  s = submitWorkflow(
    saveDraft(s, d, at),
    d.id,
    org,
    finance,
    "演示明确允许本人审批",
    at,
    "SELF",
  );
  s = approve(s);
  s = approve(s, { id: "lin", name: "林晓", role: "主管" });
  assert.equal(check(s).status, "PASS");
  activeWorkflow(s.claims[0]!)!.config.approvalPolicies.find(
    (p) => p.policyId === "AP-SZ-HIGH",
  )!.allowSelf = false;
  assert.equal(check(s).status, "BLOCK");
});
