import { sampleFiles, executePrepared as execute } from "./workflow-fixtures";
import test from "node:test";
import assert from "node:assert/strict";
import { defaultAccounts } from "./account-config";
import { accountRule, validateAccounts } from "./account-rule";
import { defaultEntities } from "./entity-rule";
import { auditAll, registry } from "./rules";
import {
  empty,
  saveDraft,
  current,
  configureAccounts,
  validate,
  review,
  load,
  save,
} from "./model";
import { createExampleStandards } from "../r001/standards";
import { createMockHistory } from "../r002/invoiceMockData";
import type { Input, Context } from "./types";
const at = "2026-10-30T03:00:00.000Z";
const bill = (): Input => ({
  id: "R005-TEST",
  applicantId: "lin",
  attachments: sampleFiles(["I1"]),
  companyId: "SZ",
  employee: "李四",
  department: "财务部",
  grade: "普通员工",
  expenseType: "住宿费",
  businessDate: "2026-10-20",
  accountCode: "6602.01",
  accountStage: "财务确认",
  businessScenario: "出差住宿",
  amountYuan: "600",
  currency: "CNY",
  city: "深圳",
  checkIn: "2026-10-20",
  checkOut: "2026-10-22",
  hotel: "模拟酒店",
  hotelAmountYuan: "600",
  partialReason: "",
  invoices: [
    {
      id: "I1",
      type: "数电发票",
      code: "",
      number: "99887766554433221100",
      amountYuan: "600",
      currency: "CNY",
      date: "2026-10-22",
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
  accountConfig: defaultAccounts(),
});
const check = (patch: Partial<Input> = {}, c = ctx()) =>
  accountRule({ ...bill(), ...patch }, c);
test("T001 正确科目PASS并附规则证据", () => {
  const r = check();
  assert.equal(r.status, "PASS");
  assert.equal((r.evidence as any).mappingRuleId, "MAP-G1");
});
test("T002 住宿选择招待科目BLOCK", () =>
  assert.equal(check({ accountCode: "6602.02" }).status, "BLOCK"));
test("T003 员工未选科目待财务确认而非拒绝", () => {
  const r = check({ accountCode: "", accountStage: "员工提交" });
  assert.equal(r.status, "INSUFFICIENT_DATA");
  assert.match(r.message, /待财务确认/);
  assert.equal((r.evidence as any).recommendedAccountCode, "6602.01");
});
test("T004 财务阶段必填科目", () => {
  assert.equal(check({ accountCode: "" }).status, "INSUFFICIENT_DATA");
  assert.equal(
    check({ accountCode: "", businessScenario: "客户宴请" }).status,
    "INSUFFICIENT_DATA",
  );
});
test("T005 未配置不能随机推荐", () => {
  const r = check({ expenseType: "设备维修费" });
  assert.equal(r.status, "INSUFFICIENT_DATA");
  assert.equal((r.evidence as any).recommendedAccountCode, "");
});
test("T006 允许的非推荐培训科目PASS", () =>
  assert.equal(
    check({
      expenseType: "培训费",
      businessScenario: "员工培训",
      accountCode: "6602.05",
    }).status,
    "PASS",
  ));
test("T007 法人专属覆盖集团、禁止套用深圳科目", () => {
  assert.equal(check({ companyId: "DG" }).status, "BLOCK");
  assert.equal(
    check({ companyId: "DG", accountCode: "6602.11" }).status,
    "PASS",
  );
  assert.equal(check({ companyId: "SH" }).status, "PASS");
});
test("T008 同优先级冲突REVIEW无推荐；相同政策可并存", () => {
  const c = ctx();
  const m = structuredClone(c.accountConfig!.mappings[0]!);
  m.ruleId = "CONFLICT";
  c.accountConfig!.mappings.push(m);
  assert.equal(check({}, c).status, "PASS");
  m.allowedAccountCodes = ["6602.11"];
  m.recommendedAccountCode = "6602.11";
  const r = check({}, c);
  assert.equal(r.status, "REVIEW");
  assert.equal((r.evidence as any).recommendedAccountCode, "");
});
test("T009 按业务日期选新旧有效期；停用专属回退集团", () => {
  const c = ctx(),
    m = c.accountConfig!.mappings[0]!;
  m.effectiveTo = "2026-10-20";
  c.accountConfig!.mappings.push({
    ...structuredClone(m),
    ruleId: "NEW",
    allowedAccountCodes: ["6602.11"],
    recommendedAccountCode: "6602.11",
    effectiveFrom: "2026-10-21",
    effectiveTo: null,
  });
  assert.equal(check({}, c).status, "PASS");
  assert.equal(check({ businessDate: "2026-10-21" }, c).status, "BLOCK");
  c.accountConfig!.mappings.find((m) => m.companyId === "DG")!.status =
    "DISABLED";
  assert.equal(check({ companyId: "DG" }, c).status, "PASS");
});
test("T010 科目变更旧批准失效、记录前后值、重审保留结果和刷新", () => {
  const d = bill();
  d.accountCode = "6602.02";
  let s = execute(saveDraft(empty(), d, at), d.id, ctx(), "B1");
  const before = structuredClone(s.claims[0]!.batches[0]);
  s = saveDraft(s, { ...d, accountCode: "6602.01" }, at, {
    actor: "王财务",
    role: "财务",
    reason: "更正住宿科目",
  });
  assert.equal(current(s.claims[0]!), undefined);
  s = execute(s, d.id, ctx(), "B2");
  assert.deepEqual(s.claims[0]!.batches[0], before);
  assert.equal(s.claims[0]!.changes![0]!.before.accountCode, "6602.02");
  assert.equal(current(s.claims[0]!)!.results[4]!.status, "PASS");
  s = review(s, d.id, "B2", "approved", "已核实", "财务", at);
  validate(s);
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
test("T011 特殊事项无政策REVIEW不推荐普通科目", () => {
  for (const expenseType of ["固定资产购置", "预付款", "在建工程"]) {
    const r = check({ expenseType });
    assert.equal(r.status, "REVIEW");
    assert.equal((r.evidence as any).recommendedAccountCode, "");
  }
});
test("T012 运行故障ERROR且不丢失其他结果", () => {
  const c = ctx();
  c.accountConfig!.mappings[0]!.allowedAccountCodes = ["不存在"];
  const rs = auditAll(bill(), c);
  assert.equal(rs.length, 6);
  assert.equal(rs[4]!.status, "ERROR");
  assert.equal(rs[0]!.status, "PASS");
});
test("T013 自由文本不擅改类型，结构化矛盾REVIEW", () => {
  assert.equal(
    check({
      expenseType: "业务招待费",
      accountCode: "6602.02",
      businessScenario: "未指定",
      businessDescription: "员工出差酒店住宿",
    }).status,
    "PASS",
  );
  assert.equal(
    check({ expenseType: "业务招待费", accountCode: "6602.02" }).status,
    "REVIEW",
  );
});
test("T014 配置新版本不改变历史，重新审核保存新快照", () => {
  let s = execute(saveDraft(empty(), bill(), at), bill().id, ctx(), "B1");
  const old = structuredClone(s.claims[0]!.batches[0]);
  const c = defaultAccounts();
  c.mappings[0]!.allowedAccountCodes = ["6602.11"];
  c.mappings[0]!.recommendedAccountCode = "6602.11";
  s = configureAccounts(s, c, "财务", "财务", "修订制度", at);
  const context = ctx();
  delete context.accountConfig;
  s = execute(s, bill().id, context, "B2");
  assert.deepEqual(s.claims[0]!.batches[0], old);
  assert.equal(s.claims[0]!.batches[1]!.context.accountConfig!.version, 2);
  assert.equal(current(s.claims[0]!)!.results[4]!.status, "BLOCK");
  validate(s);
});
test("T015 五异常同批全部保留", () => {
  const d = bill();
  d.checkOut = "2026-10-21";
  d.amountYuan = d.hotelAmountYuan = "1800";
  d.accountCode = "6602.02";
  Object.assign(d.invoices[0]!, {
    type: "增值税电子普通发票",
    code: "044001900111",
    number: "12345678",
    amountYuan: "1000",
    buyerName: "星河科技（东莞）有限公司",
    buyerTaxId: "DEMO-DG-001",
  });
  assert.deepEqual(
    auditAll(d, ctx()).map((r) => r.status),
    ["REVIEW", "REVIEW", "BLOCK", "BLOCK", "BLOCK", "REVIEW"],
  );
});
test("T016 旧四规则批次无新增通过、不写数据", () => {
  let s = execute(saveDraft(empty(), bill(), at), bill().id, ctx(), "B1");
  const b = s.claims[0]!.batches[0]!;
  b.ruleKeys = b.ruleKeys.filter(
    (k) =>
      !["expense.account-mapping", "workflow.approval-materials"].includes(k),
  );
  b.results = b.results.filter((r) => !["R005", "R006"].includes(r.ruleId));
  delete b.context.accountConfig;
  delete s.accountConfig;
  validate(s);
  const raw = JSON.stringify(s);
  assert.equal(load({ getItem: () => raw }).raw, raw);
  assert.equal(b.results.length, 4);
});
test("T017 无效配置、缺失日期、未启用主体、未确认候选科目", () => {
  const c = defaultAccounts();
  c.mappings[0]!.effectiveTo = "2019-01-01";
  assert.throws(() => validateAccounts(c));
  assert.equal(
    check({ businessDate: "2026-02-30" }).status,
    "INSUFFICIENT_DATA",
  );
  assert.equal(check({ companyId: "UNKNOWN" }).status, "INSUFFICIENT_DATA");
  assert.equal(check({ accountStage: "员工提交" }).status, "INSUFFICIENT_DATA");
});
test("T018 特殊业务未确认科目不可借REVIEW放行，非财务不可改科目", () => {
  const d = {
    ...bill(),
    expenseType: "预付款",
    accountCode: "",
    accountStage: "员工提交" as const,
  };
  let s = execute(saveDraft(empty(), d, at), d.id, ctx(), "B1");
  assert.throws(
    () => review(s, d.id, "B1", "approved", "同意", "财务", at),
    /确认科目|不能普通放行/,
  );
  assert.throws(
    () =>
      saveDraft(s, { ...d, accountCode: "6602.01" }, at, {
        actor: "员工",
        role: "员工",
        reason: "改科目",
      }),
    /仅模拟财务/,
  );
});
