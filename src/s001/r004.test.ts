import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultEntities,
  buyerRule,
  checkBuyer,
  normalizeName,
  normalizeTax,
} from "./entity-rule";
import { auditAll } from "./rules";
import {
  empty,
  saveDraft,
  execute,
  current,
  review,
  noteReview,
  configureEntities,
  validate,
  load,
} from "./model";
import { createExampleStandards } from "../r001/standards";
import { createMockHistory } from "../r002/invoiceMockData";
import type { Input, Context, Invoice } from "./types";
const at = "2026-10-30T03:00:00.000Z";
const ctx = (): Context => ({
  at,
  standards: createExampleStandards(),
  invoiceHistory: createMockHistory(),
  entityConfig: defaultEntities(),
});
const bill = (): Input => ({
  id: "R004-BILL",
  companyId: "SZ",
  employee: "李四",
  department: "财务部",
  grade: "普通员工",
  expenseType: "住宿费",
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
      sellerTaxId: "DEMO-SELLER",
      buyerName: "星河科技（深圳）有限公司",
      buyerTaxId: "DEMO-SZ-001",
      source: "manual",
      recognitionStatus: "已人工核对",
      buyerTaxStatus: "已确认",
    },
  ],
});
const check = (p: Partial<Invoice> = {}) => {
  const d = bill();
  return checkBuyer({ ...d.invoices[0]!, ...p }, d, defaultEntities());
};
test("T001 企业名称及税号正确PASS", () => assert.equal(check().status, "PASS"));
test("T002 东莞子公司BLOCK", () =>
  assert.equal(
    check({ buyerName: "星河科技（东莞）有限公司", buyerTaxId: "DEMO-DG-001" })
      .status,
    "BLOCK",
  ));
test("T003 名称正确但明确税号错误BLOCK", () =>
  assert.equal(check({ buyerTaxId: "DEMO-WRONG" }).status, "BLOCK"));
test("T004 名称税号均错BLOCK", () =>
  assert.equal(
    check({ buyerName: "其他模拟企业", buyerTaxId: "OTHER-001" }).status,
    "BLOCK",
  ));
test("T005 税号对但名称未授权REVIEW", () =>
  assert.equal(check({ buyerName: "星河科技深圳有限公司" }).status, "REVIEW"));
test("T006 历史名称在有效期PASS、过期REVIEW，支持旧税号明确授权", () => {
  assert.equal(
    check({ buyerName: "深圳星河科技有限公司", date: "2025-10-01" }).status,
    "PASS",
  );
  assert.equal(check({ buyerName: "深圳星河科技有限公司" }).status, "REVIEW");
  const c = defaultEntities();
  c.companies[0]!.companyAliases[0]!.taxpayerId = "OLD-SZ";
  assert.equal(
    checkBuyer(
      {
        ...bill().invoices[0]!,
        buyerName: "深圳星河科技有限公司",
        buyerTaxId: "OLD-SZ",
        date: "2025-10-01",
      },
      bill(),
      c,
    ).status,
    "PASS",
  );
});
test("T007 已确认票面税号空BLOCK", () =>
  assert.equal(
    check({ buyerTaxId: "", buyerTaxStatus: "票面确为空" }).status,
    "BLOCK",
  ));
test("T008 OCR未读税号不等于票面空，信息不足；低可信差异先REVIEW", () => {
  assert.equal(
    check({
      source: "ocr-assisted",
      recognitionStatus: "待核对",
      buyerTaxId: "",
      buyerTaxStatus: "未确认",
    }).status,
    "INSUFFICIENT_DATA",
  );
  assert.equal(
    check({
      source: "ocr-assisted",
      recognitionStatus: "待核对",
      recognitionConfidence: 40,
      buyerTaxId: "WRONG",
    }).status,
    "REVIEW",
  );
});
test("T009 个人抬头普通企业票据BLOCK", () =>
  assert.equal(
    check({ buyerName: "李四", buyerTaxId: "PERSON-001" }).status,
    "BLOCK",
  ));
test("个人姓名即使误填正确企业税号仍不满足企业抬头政策", () =>
  assert.equal(check({ buyerName: "李四" }).status, "BLOCK"));
test("T010 明确特殊票据NA，未知类型信息不足", () => {
  assert.equal(
    check({ type: "客运票据（模拟特例）", buyerName: "李四", buyerTaxId: "" })
      .status,
    "NOT_APPLICABLE",
  );
  assert.equal(check({ type: "其他" }).status, "INSUFFICIENT_DATA");
});
test("T011 三票PASS/BLOCK/资料不足逐张保留，BLOCK不被抵消", () => {
  const d = bill();
  d.invoices = [
    d.invoices[0]!,
    { ...d.invoices[0]!, id: "I2", buyerTaxId: "WRONG" },
    { ...d.invoices[0]!, id: "I3", buyerName: "" },
  ];
  const r = buyerRule(d, ctx());
  assert.equal(r.status, "BLOCK");
  assert.deepEqual(
    (r.evidence as { details: { status: string }[] }).details.map(
      (x) => x.status,
    ),
    ["PASS", "BLOCK", "INSUFFICIENT_DATA"],
  );
});
test("T012 变更所属法人需原因、旧审批失效、重审保留旧PASS及修改前后信息", () => {
  let s = execute(saveDraft(empty(), bill(), at), "R004-BILL", ctx(), "B1");
  s = review(s, "R004-BILL", "B1", "approved", "核实一致", "财务", at);
  const d = { ...bill(), companyId: "DG" };
  assert.throws(() => saveDraft(s, d, at));
  const next = execute(
    saveDraft(s, d, at, {
      actor: "李四",
      role: "员工",
      reason: "更正归属公司",
    }),
    d.id,
    ctx(),
    "B2",
  );
  assert.equal(next.claims[0]!.batches[0]!.results[3]!.status, "PASS");
  assert.equal(next.claims[0]!.batches[1]!.results[3]!.status, "BLOCK");
  assert.equal(next.claims[0]!.changes![0]!.before.companyId, "SZ");
  assert.equal(next.claims[0]!.changes![0]!.after.companyId, "DG");
  validate(next);
});
test("集成A 四项异常同批输出", () => {
  const d = bill();
  d.city = "北京";
  d.grade = "部门经理";
  d.checkOut = "2026-10-21";
  d.amountYuan = d.hotelAmountYuan = "1200";
  d.invoices[0] = {
    ...d.invoices[0]!,
    type: "增值税电子普通发票",
    code: "044001900111",
    number: "12345678",
    amountYuan: "1000",
    buyerName: "星河科技（东莞）有限公司",
    buyerTaxId: "DEMO-DG-001",
  };
  assert.deepEqual(
    auditAll(d, ctx()).map((r) => r.status),
    ["REVIEW", "REVIEW", "BLOCK", "BLOCK"],
  );
});
test("配置更改后新批次用新版本、旧快照重放不变；非财务不得改配置", () => {
  const s = execute(saveDraft(empty(), bill(), at), bill().id, ctx(), "B1"),
    c = defaultEntities();
  c.companies[0]!.taxpayerId = "NEW-SZ";
  assert.throws(() => configureEntities(s, c, "员工", "员工", "改配置", at));
  const next = configureEntities(s, c, "财务", "财务", "模拟税号变更", at);
  validate(next);
  assert.equal(next.claims[0]!.batches[0]!.results[3]!.status, "PASS");
  const after = execute(
    next,
    bill().id,
    { ...ctx(), entityConfig: next.entityConfig },
    "B2",
  );
  assert.equal(current(after.claims[0]!)!.results[3]!.status, "BLOCK");
  assert.equal(after.entityConfigChanges!.length, 1);
});
test("信息不足记录需补材料/已核实信息，不篡改自动结果或普通批准", () => {
  const d = bill();
  d.invoices[0]!.buyerTaxId = "";
  let s = execute(saveDraft(empty(), d, at), d.id, ctx(), "B1");
  const before = JSON.stringify(s.claims[0]!.batches[0]);
  s = noteReview(s, d.id, "需补充材料", "请核对原票税号", "财务", "财务", at);
  s = noteReview(
    s,
    d.id,
    "已核实信息",
    "仍需员工补正字段再审",
    "财务",
    "财务",
    at,
  );
  assert.equal(s.claims[0]!.reviewNotes!.length, 2);
  assert.equal(JSON.stringify(s.claims[0]!.batches[0]), before);
  assert.throws(() =>
    review(s, d.id, "B1", "approved", "直接放行", "财务", at),
  );
});
test("格式标准化不丢城市或组织形式；购买方不使用销售方税号", () => {
  assert.equal(
    normalizeName(" 星河科技（深圳）有限公司 "),
    "星河科技(深圳)有限公司",
  );
  assert.equal(normalizeTax(" demo- sz-001 "), "DEMO-SZ-001");
  assert.equal(
    check({ buyerTaxId: "WRONG", sellerTaxId: "DEMO-SZ-001" }).status,
    "BLOCK",
  );
  assert.equal(
    check({ buyerName: "星河科技（东莞）有限公司" }).status,
    "REVIEW",
  );
});
test("旧三规则批次和旧输入可读取、不自动补R004", () => {
  const s = execute(saveDraft(empty(), bill(), at), bill().id, ctx(), "B1"),
    b = s.claims[0]!.batches[0]!;
  b.ruleKeys = b.ruleKeys.filter((k) => k !== "invoice.buyer-entity");
  b.results = b.results.filter((r) => r.ruleId !== "R004");
  delete b.context.entityConfig;
  delete s.entityConfig;
  delete s.claims[0]!.input.companyId;
  delete b.input.companyId;
  validate(s);
  assert.equal(
    load({ getItem: () => JSON.stringify(s) }).state.claims[0]!.batches[0]!
      .results.length,
    3,
  );
});
test("法人有效期/状态、坏配置、日期、识别失败不会假通过", () => {
  const c = defaultEntities();
  c.companies[0]!.status = "停用";
  assert.equal(checkBuyer(bill().invoices[0]!, bill(), c).status, "REVIEW");
  assert.equal(check({ date: "2026-02-30" }).status, "INSUFFICIENT_DATA");
  assert.equal(
    check({ recognitionStatus: "识别失败" }).status,
    "INSUFFICIENT_DATA",
  );
  const context = ctx();
  context.entityConfig!.version = -1;
  assert.equal(auditAll(bill(), context)[3]!.status, "ERROR");
});
