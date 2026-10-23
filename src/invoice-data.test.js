import test from "node:test";
import assert from "node:assert/strict";
import {
  invoiceRecord,
  validateInvoices,
  invoiceTotal,
  invoiceEvidence,
  buyerComparison,
  validateInvoiceBuyer,
  structuredInvoiceRows,
  structuredInvoiceCsv,
} from "./invoice-data.js";
import { extractInvoiceDetails } from "./invoice-extract.js";
import { extractInvoiceFields } from "./ocr.js";
import {
  defaultPrecheck,
  effectivePrecheck,
  validatePrecheck,
  evaluatePrecheck,
  validatePrecheckReport,
  assertPrecheck,
} from "./precheck.js";
import { validatePolicy, validateBackup, defaultPolicy } from "./settings.js";
import { enterpriseOrg } from "./organization.js";
import { financeDivisionFlows, defaultFlows } from "./approval.js";
import {
  emptyEnterprise,
  saveSupplier,
  saveContract,
  reviewContract,
  submitCorporate,
  actCorporate,
  validateEnterprise,
} from "./enterprise.js";
import { demoContractText } from "./contract-review.js";
const fields = (extra = {}) => ({
  number: "22345678901234567890",
  amount: "265.00",
  date: "2026-10-24",
  buyerName: "星河科技",
  buyerTaxId: "DEMO-BUYER-001",
  sellerName: "远帆服务有限公司",
  sellerTaxId: "DEMO-SELLER-001",
  netAmount: "250.00",
  taxAmount: "15.00",
  ...extra,
});
const bundle = (...rows) => ({ schema: 1, records: rows });
const buyer = { name: "星河科技", taxId: "DEMO-BUYER-001" };
const doc = (invoices, extra = {}) => ({
  id: "BX-STRUCT",
  name: "结构化测试",
  employee: "林晓",
  department: "销售部",
  type: "其他费用",
  amount: 265,
  date: "2026-10-24",
  invoice: "",
  receipt: "虚构.png",
  note: "虚构用途",
  status: "待财务审核",
  history: [],
  invoices,
  ...extra,
});
const policy = () => ({
  ...defaultPolicy,
  invoiceBuyer: buyer,
  precheck: defaultPrecheck(),
});
test("显式中文英文购销标签、日期代码及金额税额提取，不混淆双方", () => {
  const text =
    "发票号码: 22345678901234567890\n发票代码:123456789012\n开票日期:2026年10月24日\n购买方名称: 星河科技\n购买方税号: DEMO-BUYER-001\n销售方名称: 远帆服务有限公司\n销售方税号: DEMO-SELLER-001\n不含税金额:250.00\n税额:15.00\n价税合计:265.00";
  const r = extractInvoiceDetails(text, extractInvoiceFields(text));
  assert.deepEqual(r, { ...fields(), code: "123456789012" });
  const english = extractInvoiceDetails(
    "Buyer\nName: Example\nTaxID: DEMO-BUYER-001\nSeller\nName: Vendor\nTaxID: DEMO-SELLER-001\nInvoiceDate:2026/10/24\nNetAmount:250.00\nTaxAmount:15.00",
  );
  assert.equal(english.buyerName, "Example");
  assert.equal(english.sellerName, "Vendor");
  assert.equal(english.taxAmount, "15.00");
});
test("无标签、双方冲突及不合法日期不猜测，金额空缺不当零", () => {
  const r = extractInvoiceDetails(
    "名称: 某公司\n税号: DEMO-UNKNOWN\n金额:123.00\n购买方名称:甲公司\n购买方名称:乙公司\n开票日期:2026-02-30",
  );
  assert.equal(r.buyerName, "");
  assert.equal(r.buyerTaxId, "");
  assert.equal(r.date, "");
  assert.equal(r.netAmount, "");
  const record = invoiceRecord(fields({ netAmount: "", taxAmount: "" }));
  assert.equal(record.netAmount, null);
  assert.equal(record.taxAmount, null);
  assert.equal(
    invoiceEvidence("expense", doc(bundle(record))).arithmetic.length,
    0,
  );
});
test("票据结构、上限、确认与数据类型校验，支持0税额拒绝负数红票", () => {
  const r = invoiceRecord(
    fields({ amount: 100, netAmount: 100, taxAmount: 0 }),
  );
  assert.equal(r.taxAmount, 0);
  assert.doesNotThrow(() => validateInvoices(bundle(r)));
  for (const f of [
    fields({ number: "abc" }),
    fields({ amount: -100 }),
    fields({ amount: 1.001 }),
    fields({ date: "2026-02-30" }),
    fields({ buyerTaxId: "<script>" }),
  ])
    assert.throws(() => invoiceRecord(f));
  const bad = structuredClone(r);
  bad.capture.confirmed = false;
  assert.throws(() => validateInvoices(bundle(bad)));
  assert.throws(() =>
    validateInvoices(
      bundle(...Array.from({ length: 6 }, () => invoiceRecord(fields()))),
    ),
  );
});
test("财务基准精确比对全半角/空白及税号，不做简称匹配或空字段假通过", () => {
  const r = invoiceRecord(
    fields({ buyerName: " 星 河 科 技 ", buyerTaxId: "demo-buyer-001" }),
  );
  assert.deepEqual(buyerComparison(r, buyer), {
    name: "抬头一致",
    tax: "税号一致",
  });
  assert.equal(
    buyerComparison({ ...r, buyerName: "星河" }, buyer).name,
    "抬头不一致",
  );
  assert.equal(
    buyerComparison({ ...r, buyerName: "" }, buyer).name,
    "缺少抬头",
  );
  assert.equal(
    buyerComparison(r, { name: "星河科技", taxId: "" }).tax,
    "基准未设税号",
  );
  assert.throws(() => validateInvoiceBuyer({ name: "", taxId: "" }));
});
test("多票按分合计、税额勾稽、同单及跨报销/对公重复证据", () => {
  const r = invoiceRecord(fields()),
    r2 = invoiceRecord(
      fields({
        number: "22345678901234567891",
        amount: 0.3,
        netAmount: "",
        taxAmount: "",
      }),
    );
  assert.equal(invoiceTotal(bundle(r, r2)), 265.3);
  const a = doc(bundle(r, r2)),
    b = doc(bundle(invoiceRecord(fields())), {
      id: "BX-OTHER",
      status: "已付款",
    }),
    c = { ...b, id: "DG-OTHER" };
  const ev = invoiceEvidence(
    "expense",
    a,
    { items: [a, b], enterprise: { payments: [c] } },
    buyer,
  );
  assert.equal(ev.duplicates.length, 2);
  assert.ok(ev.duplicates.some((x) => x.includes("DG-OTHER")));
  const broken = invoiceRecord(fields({ netAmount: 249 }));
  assert.equal(
    invoiceEvidence("expense", doc(bundle(broken)), {}, buyer).arithmetic
      .length,
    1,
  );
  assert.equal(
    invoiceEvidence(
      "expense",
      doc(bundle(r, invoiceRecord(fields()))),
      {},
      buyer,
    ).duplicates.length,
    1,
  );
});
test("四条票面规则可提醒或拦截，不覆盖申请金额；无采集不补造判断", () => {
  const r = invoiceRecord(
      fields({
        buyerName: "错误公司",
        buyerTaxId: "DEMO-WRONG",
        netAmount: 240,
      }),
    ),
    a = doc(bundle(r), { amount: 200 }),
    p = policy();
  let result = evaluatePrecheck("expense", a, { items: [a] }, p);
  for (const id of ["invoice-buyer", "invoice-total", "invoice-arithmetic"])
    assert.ok(result.findings.some((f) => f.id === id));
  assert.equal(a.amount, 200);
  assert.doesNotThrow(() => assertPrecheck(result, a.status));
  p.precheck.rules.find((r) => r.id === "invoice-buyer").effect = "block";
  result = evaluatePrecheck("expense", a, { items: [a] }, p);
  assert.throws(() => assertPrecheck(result, a.status), /抬头/);
  assert.doesNotThrow(() => validatePrecheckReport(result, "expense", a.id));
  assert.equal(
    evaluatePrecheck(
      "expense",
      { ...a, invoices: undefined },
      { items: [] },
      p,
    ).findings.some((f) => f.id.startsWith("invoice-")),
    false,
  );
});
test("旧10条规则和快照保留，运行补齐新提醒，保存完整14条；半截新目录拒绝", () => {
  const old = defaultPrecheck();
  old.rules = old.rules.slice(0, 10);
  assert.doesNotThrow(() => validatePrecheck(old));
  const p = { ...defaultPolicy, precheck: old };
  assert.equal(effectivePrecheck(p).rules.length, 14);
  assert.equal(p.precheck.rules.length, 10);
  assert.equal(validatePolicy(p).precheck.rules.length, 10);
  const bad = defaultPrecheck();
  bad.rules.pop();
  assert.throws(() => validatePrecheck(bad));
});
test("结构化台账票面金额不混申请金额，按号码含旧索引判重，CSV防公式", () => {
  const a = doc(bundle(invoiceRecord(fields({ buyerName: "=SUM(A1)" }))), {
      amount: 200,
    }),
    b = doc(undefined, { id: "OLD", invoice: fields().number });
  const rows = structuredInvoiceRows([a, b]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].duplicate, true);
  assert.equal(rows[0].record.amount, 265);
  assert.equal(rows[0].doc.amount, 200);
  const csv = structuredInvoiceCsv(rows);
  assert.ok(csv.includes("票面价税合计"));
  assert.ok(csv.includes("\'22345678901234567890"));
  assert.ok(csv.includes("'=SUM(A1)"));
});
test("报销新旧备份、票面及基准格式校验和未知企业查重保护", () => {
  const a = doc(bundle(invoiceRecord(fields()))),
    p = policy(),
    backup = {
      format: "qingbao-backup",
      version: 1,
      items: [a],
      budgets: { 销售部: 1000 },
      policy: p,
      audit: [],
    };
  assert.doesNotThrow(() => validateBackup(backup));
  const bad = structuredClone(backup);
  bad.items[0].invoices.records[0].amount = -1;
  assert.throws(() => validateBackup(bad));
  const old = structuredClone(backup);
  delete old.items[0].invoices;
  delete old.policy.invoiceBuyer;
  old.policy.precheck.rules = old.policy.precheck.rules.slice(0, 10);
  assert.doesNotThrow(() => validateBackup(old));
  const r = evaluatePrecheck(
    "expense",
    a,
    { items: [a], enterpriseHealthy: false },
    p,
  );
  assert.ok(
    r.findings.some((f) => f.id === "invoice-context" && f.effect === "block"),
  );
  assert.doesNotThrow(() => validatePrecheckReport(r, "expense", a.id));
});
test("对公单保留结构化票据、付款节点规则检查及处理时财务基准", () => {
  const org = enterpriseOrg(),
    who = (id) => org.people.find((p) => p.id === id),
    flows = financeDivisionFlows(defaultFlows(), org);
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "远帆服务有限公司（虚构）",
      creditCode: "DEMO-INVOICE",
      accountName: "远帆服务有限公司（虚构）",
      bankName: "演示银行",
      bankAccount: "DEMO-INVOICE-001",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "虚构合同",
      number: "HT-INVOICE",
      supplierId: s.suppliers[0].id,
      amount: 10000,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      text: demoContractText,
    },
    who("lin"),
    org,
  );
  s = reviewContract(s, s.contracts[0].id, who("finance-zhou"), {
    approve: true,
    confirmed: true,
    note: "核对通过",
  });
  s = submitCorporate(
    s,
    {
      name: "票面核对对公单",
      contractId: s.contracts[0].id,
      amount: 265,
      date: "2026-10-24",
      note: "虚构用途",
      invoices: bundle(invoiceRecord(fields({ buyerName: "错误公司" }))),
    },
    who("lin"),
    org,
    flows,
  );
  s = actCorporate(s, s.payments[0].id, who("head-xu"), "approve");
  const p = policy();
  p.precheck.rules.find((r) => r.id === "invoice-buyer").effect = "block";
  assert.throws(
    () =>
      actCorporate(
        s,
        s.payments[0].id,
        who("finance-zhou"),
        "approve",
        {},
        [],
        p,
      ),
    /抬头/,
  );
  assert.doesNotThrow(() => validateEnterprise(s));
  assert.deepEqual(s.payments[0].history.at(-1).precheck.policy.invoiceBuyer, {
    name: "星河科技",
    taxId: "",
  });
});

test("红票及显式外币合计不自动转成正数人民币", () => {
  assert.equal(extractInvoiceFields("价税合计：-100.00").amount, "");
  assert.equal(extractInvoiceFields("价税合计：￥-100.00").amount, "");
  assert.equal(
    extractInvoiceFields("Currency: USD\nTOTAL: $100.00").amount,
    "",
  );
});
