import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePrecheck,
  defaultPrecheck,
  validatePrecheck,
  nextPrecheck,
  validatePrecheckReport,
  assertPrecheck,
  basePolicy,
} from "./precheck.js";
import { validatePolicy, validateBackup } from "./settings.js";
import { transition, review } from "./domain.js";
import { batchPayment } from "./payment-batch.js";
import { enterpriseOrg } from "./organization.js";
import { defaultFlows, financeDivisionFlows } from "./approval.js";
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
const at = "2026-10-23T16:05:00Z";
const expense = (extra = {}) => ({
  id: "BX-CHECK",
  name: "虚构费用",
  employee: "林晓",
  department: "销售部",
  type: "其他费用",
  amount: 100,
  date: "2026-10-24",
  invoice: "INV-CHECK",
  receipt: "虚构.pdf",
  note: "虚构用途",
  status: "待财务审核",
  history: [],
  ...extra,
});
function policy(id, effect = "block", threshold) {
  const precheck = defaultPrecheck();
  const r = precheck.rules.find((r) => r.id === id);
  r.effect = effect;
  if (threshold !== undefined) r.threshold = threshold;
  return { ...basePolicy, precheck };
}
const org = enterpriseOrg(),
  flows = financeDivisionFlows(defaultFlows(), org),
  who = (id) => org.people.find((p) => p.id === id);
function corporate() {
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "远帆服务有限公司（虚构）",
      creditCode: "DEMO-CREDIT",
      accountName: "远帆服务有限公司（虚构）",
      bankName: "虚构银行",
      bankAccount: "DEMO-CORP-CHECK",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "虚构服务",
      number: "HT-CHECK",
      amount: 10000,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      supplierId: s.suppliers[0].id,
      text: demoContractText,
    },
    who("lin"),
    org,
  );
  s = reviewContract(s, s.contracts[0].id, who("finance-zhou"), {
    approve: true,
    note: "全文核对通过",
    confirmed: true,
  });
  return submitCorporate(
    s,
    {
      name: "虚构服务付款",
      contractId: s.contracts[0].id,
      amount: 4000,
      date: "2026-10-24",
      note: "虚构用途",
    },
    who("lin"),
    org,
    flows,
  );
}
function toFinance(s) {
  return actCorporate(
    s,
    s.payments[0].id,
    who(s.payments[0].approval.nodes[0].actorId),
    "approve",
  );
}
test("原有三项硬规则保留，补充提示不混入旧拦截数组", () => {
  const d = expense({ amount: 4000, receipt: "" }),
    other = expense({ id: "OTHER" });
  const r = evaluatePrecheck(
    "expense",
    d,
    { items: [d, other] },
    basePolicy,
    at,
  );
  assert.equal(r.findings.filter((f) => f.effect === "block").length, 3);
  assert.equal(review(d, [d, other]).length, 3);
  assert.ok(
    r.findings
      .find((f) => f.id === "legacy-duplicate")
      .evidence.includes("OTHER"),
  );
  assert.ok(
    r.findings.some((f) => f.id === "expense-file" && f.effect === "warn"),
  );
  assert.doesNotThrow(() => validatePrecheckReport(r, "expense", d.id));
});
test("提醒允许人工继续，配置拦截在财务总账付款生效，主管保留转交", () => {
  const d = expense(),
    warn = evaluatePrecheck("expense", d, { items: [d] }, basePolicy, at),
    block = evaluatePrecheck(
      "expense",
      d,
      { items: [d] },
      policy("expense-file"),
      at,
    );
  assert.doesNotThrow(() => assertPrecheck(warn, "待财务审核"));
  for (const status of ["待财务审核", "待总账复核", "待付款"])
    assert.throws(() => assertPrecheck(block, status), /预审风险/);
  assert.doesNotThrow(() => assertPrecheck(block, "待主管审批"));
  assert.throws(
    () =>
      transition(d, "approve", "财务", "", null, null, null, {
        items: [d],
        policy: policy("expense-file"),
      }),
    /原文件/,
  );
  assert.equal(
    transition(d, "reject", "财务", "补充原文件", null, null, null, {
      items: [d],
      policy: policy("expense-file"),
    }).status,
    "已退回",
  );
});
test("同人同日同金额按分检索，排除自身、退回撤回草稿及其他人员", () => {
  const d = expense({ amount: 0.3 }),
    other = expense({ id: "MATCH", amount: 0.1 + 0.2, invoice: "OTHER" });
  const items = [
    d,
    other,
    ...["草稿", "已退回", "已撤回"].map((status, i) => ({
      ...other,
      id: "INACTIVE" + i,
      status,
    })),
    { ...other, id: "OTHER-PERSON", employee: "陈嘉" },
  ];
  const before = JSON.stringify(items);
  const r = evaluatePrecheck("expense", d, { items }, basePolicy, at);
  const f = r.findings.find((f) => f.id === "expense-similar");
  assert.ok(f.evidence.includes("MATCH"));
  assert.ok(!f.evidence.includes("INACTIVE"));
  assert.equal(JSON.stringify(items), before);
  assert.equal(
    evaluatePrecheck(
      "expense",
      { ...d, status: "草稿" },
      { items },
      basePolicy,
      at,
    ).findings.length,
    0,
  );
});
test("时效按上海自然日且边界包含，不将票据名或OCR当原文件", () => {
  const d = expense({
    date: "2026-10-23",
    invoice: "",
    ocr: { confirmed: true },
  });
  const p = policy("expense-age", "warn", 1);
  let r = evaluatePrecheck(
    "expense",
    d,
    { items: [d] },
    p,
    "2026-10-24T15:59:59Z",
  );
  assert.ok(!r.findings.some((f) => f.id === "expense-age"));
  r = evaluatePrecheck("expense", d, { items: [d] }, p, "2026-10-24T16:00:00Z");
  assert.ok(r.findings.some((f) => f.id === "expense-age"));
  assert.ok(r.findings.some((f) => f.id === "expense-invoice"));
  assert.ok(
    r.findings
      .find((f) => f.id === "expense-file")
      .evidence.includes("旧票据名称"),
  );
  assert.ok(
    !evaluatePrecheck(
      "expense",
      { ...d, attachments: [{ kind: "发票" }] },
      { items: [d] },
      p,
      at,
    ).findings.some((f) => f.id === "expense-file"),
  );
});
test("规则配置拒绝未知或重复ID、非法方式阈值及非整数天数；旧政策不增加新字段", () => {
  assert.deepEqual(validatePolicy(basePolicy), basePolicy);
  for (const mutate of [
    (c) => (c.rules[0].id = "eval"),
    (c) => (c.rules[1].id = c.rules[0].id),
    (c) => (c.rules[0].effect = "autoapprove"),
    (c) => (c.rules.find((r) => r.id === "expense-age").threshold = 1.5),
    (c) => (c.rules.find((r) => r.id === "corporate-usage").threshold = 101),
    (c) => c.rules.pop(),
  ]) {
    const c = defaultPrecheck();
    mutate(c);
    assert.throws(() => validatePrecheck(c));
  }
  const p = policy("corporate-amount", "block", 2000);
  assert.equal(nextPrecheck(p, p.precheck.rules).version, 2);
  assert.deepEqual(validatePolicy(p), p);
});
test("对公金额、停用、账户变化、日期、相似单和累计比例提供证据", () => {
  let s = corporate();
  const p = s.payments[0];
  s.suppliers[0].active = false;
  s.suppliers[0].bankAccount = "DEMO-CHANGED";
  p.date = "2027-01-01";
  s.payments.push({ ...structuredClone(p), id: "DG-MATCH" });
  const cfg = policy("corporate-amount", "warn", 2000);
  cfg.precheck.rules.find((r) => r.id === "corporate-usage").threshold = 80;
  const r = evaluatePrecheck("corporate", p, { enterprise: s }, cfg, at);
  for (const id of [
    "corporate-amount",
    "corporate-supplier",
    "corporate-account",
    "corporate-date",
    "corporate-similar",
    "corporate-usage",
  ])
    assert.ok(
      r.findings.some((f) => f.id === id),
      id,
    );
  assert.ok(
    r.findings
      .find((f) => f.id === "corporate-account")
      .evidence.includes("DEMO-CHANGED"),
  );
  assert.ok(
    r.findings
      .find((f) => f.id === "corporate-similar")
      .evidence.includes("DG-MATCH"),
  );
  assert.doesNotThrow(() => validatePrecheckReport(r, "corporate", p.id));
});
test("缺合同上下文、合同版本与累计超额为固定完整性校验，关闭补充规则不绕过", () => {
  const s = corporate(),
    d = s.payments[0],
    cfg = policy("corporate-account");
  cfg.precheck.rules.forEach((r) => (r.enabled = false));
  assert.throws(
    () =>
      assertPrecheck(
        evaluatePrecheck("corporate", d, {}, cfg, at),
        "待财务审核",
      ),
    /关联校验/,
  );
  const bad = structuredClone(s);
  bad.contracts[0].status = "待复核";
  bad.contracts[0].amount = 3000;
  const r = evaluatePrecheck("corporate", d, { enterprise: bad }, cfg, at);
  assert.deepEqual(
    r.findings.map((f) => f.id),
    ["corporate-contract", "corporate-balance"],
  );
});
test("对公真实处理重新检查且拒绝未修正风险，提醒可通过并保存版本快照", () => {
  let s = toFinance(corporate()),
    p = s.payments[0],
    cfg = policy("corporate-amount", "block", 2000),
    before = JSON.stringify(s);
  assert.throws(
    () => actCorporate(s, p.id, who("finance-zhou"), "approve", {}, [], cfg),
    /金额/,
  );
  assert.equal(JSON.stringify(s), before);
  cfg.precheck.rules.find((r) => r.id === "corporate-amount").effect = "warn";
  s = actCorporate(
    s,
    p.id,
    who("finance-zhou"),
    "approve",
    { note: "核对分期付款依据" },
    [],
    cfg,
  );
  const snapshot = structuredClone(s.payments[0].history.at(-1).precheck);
  cfg.precheck.version = 3;
  cfg.precheck.rules.find((r) => r.id === "corporate-amount").threshold = 9000;
  assert.deepEqual(s.payments[0].history.at(-1).precheck, snapshot);
  assert.equal(snapshot.policy.precheck.version, 1);
  assert.ok(snapshot.findings.some((f) => f.id === "corporate-amount"));
  assert.doesNotThrow(() => validateEnterprise(s));
});
test("报销审批及批量付款保存处理时快照，任一新增拦截整批不保存", () => {
  const a = expense({ status: "待付款" }),
    b = expense({ id: "BX-SECOND", status: "待付款", invoice: "INV-SECOND" }),
    actor = who("finance-zhou"),
    opts = {
      prefix: "CHECK-PAY",
      date: "2026-10-24",
      method: "银行转账",
      confirmed: true,
    };
  const items = [a, b],
    before = JSON.stringify(items);
  assert.throws(
    () =>
      batchPayment(
        items,
        items.map((x) => x.id),
        actor,
        opts,
        policy("expense-file"),
      ),
    /预审风险/,
  );
  assert.equal(JSON.stringify(items), before);
  const result = batchPayment(
    items,
    items.map((x) => x.id),
    actor,
    opts,
    basePolicy,
  );
  for (const p of result) {
    assert.equal(p.status, "已付款");
    assert.ok(p.history.at(-1).precheck);
    assert.equal(p.history.at(-1).precheck.docId, p.id);
    assert.doesNotThrow(() =>
      validatePrecheckReport(p.history.at(-1).precheck, "expense", p.id),
    );
  }
});
test("历史预审快照与新旧备份兼容，畸形快照或规则拒绝导入", () => {
  const d = expense(),
    next = transition(
      d,
      "approve",
      "财务",
      "已核对",
      null,
      who("finance-zhou"),
      null,
      { items: [d], policy: basePolicy },
    );
  const backup = {
    format: "qingbao-backup",
    version: 1,
    items: [next],
    budgets: { 销售部: 10000 },
    policy: basePolicy,
    audit: [],
  };
  assert.doesNotThrow(() => validateBackup(backup));
  const bad = structuredClone(backup);
  bad.items[0].history[0].precheck.kind = "corporate";
  assert.throws(() => validateBackup(bad), /快照/);
  const r = structuredClone(next.history[0].precheck);
  r.findings.push({ ...r.findings[0] });
  assert.throws(() => validatePrecheckReport(r, "expense", d.id), /条目/);
  const old = structuredClone(backup);
  delete old.items[0].history[0].precheck;
  assert.doesNotThrow(() => validateBackup(old));
});
