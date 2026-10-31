import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Existing organization shared with all expense approvals.
import { defaultOrg } from "../organization.js";
import { defaultBudgetBook, type BudgetBook } from "./budget-config";
import {
  budgetRule,
  budgetTotals,
  allocations,
  validateBudgetBook,
} from "./budget-rule";
import {
  configureBudgets,
  seedBudgetOpening,
  reconcileBudget,
  releaseBudget,
  withdrawClaim,
  consumeBudget,
} from "./budget-model";
import {
  empty,
  saveDraft,
  execute,
  current,
  review,
  validate,
  save,
  load,
} from "./model";
import {
  submitWorkflow,
  recordApproval,
  activeWorkflow,
  requestBudgetAuthorization,
} from "./workflow-model";
import { approvalNodes, selectPolicy } from "./workflow-rule";
import { sampleFiles } from "./workflow-fixtures";
import { auditAll } from "./rules";
import { centsToYuan, parseYuan } from "../r001/rule";
import { createExampleStandards } from "../r001/standards";
import { createMockHistory } from "../r002/invoiceMockData";
import { defaultEntities } from "./entity-rule";
import type { State, Input, Context } from "./types";
const at = "2026-10-31T03:00:00.000Z",
  finance = { id: "finance-zhou", name: "周宁", role: "财务" },
  bid = "B-SZ-sales-住宿费-2026-10";
const bill = (yuan = "800"): Input => ({
  id: "R007-BILL",
  departmentId: "sales",
  applicantId: "lin",
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
  amountYuan: yuan,
  currency: "CNY",
  city: "深圳",
  checkIn: "2026-10-20",
  checkOut: "2026-10-23",
  hotel: "模拟酒店",
  hotelAmountYuan: yuan,
  partialReason: "",
  attachments: sampleFiles(["I1"]),
  invoices: [
    {
      id: "I1",
      type: "数电发票",
      code: "",
      number: "99887766554433221100",
      amountYuan: yuan,
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
const ctx = (s: State): Context => ({
  at,
  standards: createExampleStandards(),
  invoiceHistory: createMockHistory(),
  entityConfig: defaultEntities(),
  budgetOrg: defaultOrg(),
  budgetBook: s.budgetBook,
});
function base(
  yuan = "800",
  mode: "HARD" | "SOFT" | "WARNING" = "HARD",
  opening = true,
) {
  let s = empty();
  s.budgetBook!.budgets.find((b) => b.budgetId === bid)!.controlMode = mode;
  if (opening)
    s = seedBudgetOpening(s, bid, 600000, 200000, finance, at, "SEED");
  return saveDraft(s, bill(yuan), at);
}
const check = (
  s: State,
  d = s.claims.find((d) => d.id === "R007-BILL")!.input,
) => budgetRule(d, ctx(s));
const submit = (s: State, wf = "WF1") =>
  submitWorkflow(s, "R007-BILL", defaultOrg(), finance, "提交并预占", at, wf);
function approveAll(s: State, count = 9) {
  for (let i = 0; i < count; i++) {
    const d = s.claims.find((d) => d.id === "R007-BILL")!,
      w = activeWorkflow(d)!;
    const p = selectPolicy(d.input, w.config.approvalPolicies).policy!,
      nodes = approvalNodes(d.input, w.org, p, w.budgetEscalation),
      idx = w.records.filter((r) => r.approvalStatus === "APPROVED").length;
    if (idx >= nodes.length) break;
    const node = nodes[idx]!;
    s = recordApproval(
      s,
      d.id,
      { id: node.actorId, name: node.actorName, role: node.role },
      "APPROVED",
      "明确具名授权",
      at,
      crypto.randomUUID(),
    );
  }
  return s;
}
const run = (s: State, batch = "B1") => execute(s, "R007-BILL", ctx(s), batch);
const totals = (s: State, id = bid) => budgetTotals(s.budgetBook!, id);
const doc = (s: State) => s.claims.find((d) => d.id === "R007-BILL")!;
test("T001 预算充足PASS，排除自身的额度可解释", () => {
  const s = base("1000");
  const r = check(s);
  assert.equal(r.status, "PASS");
  assert.equal((r.evidence as any).availableForCurrentCents, 200000);
});
test("T002 HARD超500元BLOCK，失败提交不产生预占或伪审批", () => {
  const s = base("2500"),
    before = JSON.stringify(s);
  assert.equal(check(s).status, "BLOCK");
  assert.equal((check(s).evidence as any).excessCents, 50000);
  assert.throws(() => submit(s), /预算/);
  assert.equal(JSON.stringify(s), before);
});
test("T003 SOFT超额REVIEW，R006追加具名预算负责人，授权前禁止最终批准", () => {
  let s = submit(base("2500", "SOFT"));
  assert.equal(check(s).status, "REVIEW");
  assert.equal(totals(s).reserved, 450000);
  s = run(approveAll(s, 2));
  assert.equal(current(doc(s))!.results[5]!.status, "REVIEW");
  assert.throws(
    () => review(s, "R007-BILL", "B1", "approved", "尝试跳过", "周宁", at),
    /审批或附件/,
  );
  s = run(approveAll(s), "B2");
  assert.equal(current(doc(s))!.results[5]!.status, "PASS");
  assert.equal(current(doc(s))!.results[6]!.status, "REVIEW");
  s = review(s, "R007-BILL", "B2", "approved", "预算负责人已授权", "周宁", at);
  assert.equal(totals(s).used, 850000);
  assert.equal(totals(s).reserved, 200000);
  assert.equal((check(s).evidence as any).excessCents, 50000);
  validate(s);
});
test("T004 WARNING当前85%加500预计90%，PASS并预警", () => {
  let s = base("500", "WARNING", false);
  s = seedBudgetOpening(s, bid, 650000, 200000, finance, at, "OPEN2");
  const r = check(s),
    e = r.evidence as any;
  assert.equal(r.status, "PASS");
  assert.equal(e.currentUsageBps, 8500);
  assert.equal(e.projectedUsageBps, 9000);
  assert.ok(e.warnings.includes(90));
});
test("T005 正好用完2000不误拦，预计0", () => {
  const r = check(base("2000"));
  assert.equal(r.status, "PASS");
  assert.equal((r.evidence as any).projectedRemainingCents, 0);
});
test("T006 没配置不是无限额度，草稿不占用", () => {
  const s = base();
  s.budgetBook!.budgets = [];
  s.budgetBook!.transactions = [];
  s.budgetBook!.events = [];
  assert.equal(check(s).status, "INSUFFICIENT_DATA");
});
test("T007 改部门释放原预占，匹配新部门，仅一份占用", () => {
  let s = submit(base());
  const input = {
    ...doc(s).input,
    departmentId: "product",
    department: "产品部",
    applicantId: "chen",
    employee: "陈嘉",
  };
  s = saveDraft(s, input, at, {
    actor: "周宁",
    role: "财务",
    reason: "更正业务归属",
  });
  assert.equal(totals(s).reserved, 200000);
  assert.equal(totals(s, "B-SZ-product-住宿费-2026-10").reserved, 80000);
  assert.equal(
    allocations(s.budgetBook!).get("R007-BILL")!.budgetId,
    "B-SZ-product-住宿费-2026-10",
  );
  validate(s);
});
test("T008 800改1200只调400，不能累成2000，超额修改原子拒绝", () => {
  let s = submit(base());
  s = saveDraft(
    s,
    { ...doc(s).input, amountYuan: "1200", hotelAmountYuan: "1200" },
    at,
    { actor: "林晓", role: "员工", reason: "修改金额" },
  );
  assert.equal(allocations(s.budgetBook!).get("R007-BILL")!.reserved, 120000);
  assert.equal(s.budgetBook!.transactions.at(-1)!.transactionType, "ADJUST");
  assert.equal(s.budgetBook!.transactions.at(-1)!.amount, 40000);
  assert.equal(current(doc(s)), undefined);
  const before = JSON.stringify(s);
  assert.throws(
    () =>
      saveDraft(s, { ...doc(s).input, amountYuan: "2500" }, at, {
        actor: "林晓",
        role: "员工",
        reason: "超额修改",
      }),
    /预算/,
  );
  assert.equal(JSON.stringify(s), before);
});
test("T009 十月费用十一月提交仍十月；跨两月不擅拆REVIEW", () => {
  const s = base();
  assert.equal(
    (
      budgetRule(bill(), { ...ctx(s), at: "2026-11-05T03:00:00.000Z" })
        .evidence as any
    ).period,
    "2026-10",
  );
  assert.equal(
    check(s, { ...bill(), checkOut: "2026-11-02" }).status,
    "REVIEW",
  );
});
test("T010 重叠预算REVIEW，停用无有效配置INFO", () => {
  const s = base();
  const b = s.budgetBook!.budgets.find((b) => b.budgetId === bid)!;
  s.budgetBook!.budgets.push({ ...b, budgetId: "CONFLICT" });
  assert.equal(check(s).status, "REVIEW");
  s.budgetBook!.budgets.forEach((b) => (b.status = "DISABLED"));
  assert.equal(check(s).status, "INSUFFICIENT_DATA");
});
test("T011 重复自动审核只增历史，不改变流水和占用", () => {
  let s = submit(base());
  const ledger = JSON.stringify(s.budgetBook);
  s = run(s);
  s = run(s, "B2");
  assert.equal(JSON.stringify(s.budgetBook), ledger);
  assert.equal(
    (current(doc(s))!.results[6]!.evidence as any).otherReservedCents,
    200000,
  );
});
test("T012 重复提交不重复预占，同业务事件幂等且参数冲突拒绝", () => {
  let s = submit(base());
  const before = JSON.stringify(s.budgetBook);
  assert.throws(() => submit(s, "WF2"), /已经提交/);
  assert.equal(JSON.stringify(s.budgetBook), before);
  const n = reconcileBudget(
    s,
    "R007-BILL",
    "RESERVE-AGAIN",
    at,
    finance,
    defaultOrg(),
  );
  const again = reconcileBudget(
    n,
    "R007-BILL",
    "RESERVE-AGAIN",
    at,
    finance,
    defaultOrg(),
  );
  assert.equal(again, n);
  assert.equal(totals(again).reserved, 280000);
});
test("T013 业务驳回释放、已使用不加、重复释放不回补两次", () => {
  let s = submit(base("1000"));
  s = recordApproval(
    s,
    "R007-BILL",
    { id: "manager-zhao", name: "赵航", role: "主管" },
    "REJECTED",
    "不同意虚构业务",
    at,
    "REJECT1",
  );
  assert.equal(totals(s).reserved, 200000);
  assert.equal(totals(s).used, 600000);
  const n = releaseBudget(
    s,
    "R007-BILL",
    "RELEASE2",
    at,
    finance,
    "再次释放无新增",
  );
  assert.equal(
    n.budgetBook!.transactions.length,
    s.budgetBook!.transactions.length,
  );
  assert.equal(
    releaseBudget(n, "R007-BILL", "RELEASE2", at, finance, "再次释放无新增"),
    n,
  );
});
test("T014 撤销释放且禁止原版本重提，已批准不可撤销", () => {
  let s = submit(base());
  s = withdrawClaim(
    s,
    "R007-BILL",
    { id: "lin", name: "林晓", role: "员工" },
    "撤销修改",
    at,
    "WITHDRAW",
  );
  assert.equal(totals(s).reserved, 200000);
  assert.equal(activeWorkflow(doc(s)), undefined);
  assert.throws(() => submit(s), /撤销/);
  assert.equal(
    withdrawClaim(
      s,
      "R007-BILL",
      { id: "lin", name: "林晓", role: "员工" },
      "撤销修改",
      at,
      "WITHDRAW",
    ),
    s,
  );
});
test("T015 最终批准预占转使用，总可用只减少一次", () => {
  let s = run(approveAll(submit(base())));
  const before = totals(s);
  s = review(s, "R007-BILL", "B1", "approved", "全部核实", "周宁", at);
  const after = totals(s);
  assert.equal(after.used, 680000);
  assert.equal(after.reserved, 200000);
  assert.equal(before.used + before.reserved, after.used + after.reserved);
  assert.equal(s.budgetBook!.transactions.at(-1)!.transactionType, "CONSUME");
  assert.throws(
    () => withdrawClaim(s, "R007-BILL", finance, "不能直接撤销", at, "X"),
    /冲销/,
  );
  assert.throws(
    () =>
      saveDraft(s, { ...doc(s).input, amountYuan: "100" }, at, {
        actor: "周宁",
        role: "财务",
        reason: "不可改已使用",
      }),
    /冲销/,
  );
});
test("T016 刷新同源预算/预占/流水/审核保留，写入冲突和配额失败不改变旧数据", () => {
  const s = run(submit(base()));
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_k: string, v: string) => {
      raw = v;
    },
  };
  save(storage, s, null);
  assert.deepEqual(load(storage).state, s);
  const old = raw;
  assert.throws(() => save(storage, s, "OTHER"));
  assert.equal(raw, old);
  assert.throws(() =>
    save(
      {
        getItem: () => raw,
        setItem: () => {
          throw Error("quota");
        },
      },
      s,
      raw,
    ),
  );
  assert.equal(raw, old);
});
test("T017 不同法人预算不串，部门亦不可借用", () => {
  const s = base();
  const r = check(s, { ...bill(), companyId: "DG" });
  assert.equal((r.evidence as any).otherReservedCents, 0);
  assert.equal((r.evidence as any).budget.companyId, "DG");
  assert.equal(
    check(s, { ...bill(), departmentId: "NO-DEPT" }).status,
    "INSUFFICIENT_DATA",
  );
});
test("T018 零预算不除零，HARD拦、WARNING放行提醒", () => {
  const s = base("0.01", "HARD", false);
  const b = s.budgetBook!.budgets.find((b) => b.budgetId === bid)!;
  b.budgetAmount = 0;
  assert.equal(check(s).status, "BLOCK");
  assert.equal((check(s).evidence as any).projectedUsageBps, null);
  b.controlMode = "WARNING";
  assert.equal(check(s).status, "PASS");
});
test("T019 无汇率不同币种INFO，金额小数精度按分", () => {
  const s = base("0.03", "HARD", false);
  assert.equal(
    check(s, { ...bill(), currency: "USD" }).status,
    "INSUFFICIENT_DATA",
  );
  s.budgetBook!.budgets.find((b) => b.budgetId === bid)!.budgetAmount = 3;
  assert.equal(check(s).status, "PASS");
  assert.equal((check(s).evidence as any).projectedRemainingCents, 0);
  assert.equal(
    check(s, { ...bill(), amountYuan: "0.031" }).status,
    "INSUFFICIENT_DATA",
  );
  for (const cents of [
    9007199254740982, 9007199254740985, 9007199254740987, 9007199254740990,
  ]) {
    const seeded = seedBudgetOpening(
        empty(),
        bid,
        cents,
        0,
        finance,
        at,
        "BIG-" + cents,
      ),
      opening = seeded.claims.find((d) => d.budgetOpening === "USED")!;
    const parsed = parseYuan(opening.input.amountYuan);
    assert.equal(parsed.ok && parsed.cents, cents);
    assert.equal(opening.input.amountYuan, centsToYuan(cents));
  }
});
test("T020 预算更新保留旧审核，新审使用新版本，最终批准重查最新额度", () => {
  let s = run(approveAll(submit(base())));
  const old = structuredClone(doc(s).batches[0]);
  const budgets = structuredClone(s.budgetBook!.budgets);
  budgets.find((b) => b.budgetId === bid)!.budgetAmount = 810000;
  s = configureBudgets(s, budgets, finance, "模拟预算降额", at, "CFG1");
  assert.deepEqual(doc(s).batches[0], old);
  assert.throws(
    () => review(s, "R007-BILL", "B1", "approved", "旧通过不可用", "周宁", at),
    /最新预算/,
  );
  s = run(s, "B2");
  assert.equal(current(doc(s))!.results[6]!.status, "BLOCK");
  validate(s);
});
test("T021 R007运行错误独立ERROR，不丢前六项", () => {
  const s = base();
  s.budgetBook!.schema = 0 as 1;
  const r = auditAll(bill(), ctx(s));
  assert.equal(r.length, 7);
  assert.equal(r[6]!.status, "ERROR");
  assert.equal(r[0]!.status, "PASS");
});
test("T022 批准事件重复不会再次消耗，新批准事件也不能重复消费", () => {
  let s = run(approveAll(submit(base())));
  s = review(s, "R007-BILL", "B1", "approved", "确认", "周宁", at);
  const before = JSON.stringify(s);
  assert.equal(consumeBudget(s, "R007-BILL", "FINANCE-B1", at, finance), s);
  assert.throws(() =>
    consumeBudget(s, "R007-BILL", "NEW-APPROVE", at, finance),
  );
  assert.throws(() =>
    review(s, "R007-BILL", "B1", "approved", "重复", "周宁", at),
  );
  assert.throws(() => run(s, "REOPEN"), /最终批准/);
  const legacy = structuredClone(s);
  delete legacy.budgetBook;
  assert.throws(
    () =>
      reconcileBudget(legacy, "R007-BILL", "REBOOK", at, finance, defaultOrg()),
    /已批准/,
  );
  assert.equal(JSON.stringify(s), before);
});
test("SOFT可配置暂不预占，仍须授权并在最终时原子占用/结转", () => {
  let s = base("2500", "SOFT");
  s.budgetBook!.budgets.find((b) => b.budgetId === bid)!.reserveOnSoftExceeded =
    false;
  s = run(approveAll(submit(s)));
  assert.equal(totals(s).reserved, 200000);
  s = review(s, "R007-BILL", "B1", "approved", "明确超额授权", "周宁", at);
  assert.equal(totals(s).used, 850000);
  assert.equal(totals(s).reserved, 200000);
});
test("普通员工不能改预算、预算维度不能覆盖、停用历史保留", () => {
  const s = base(),
    list = structuredClone(s.budgetBook!.budgets);
  assert.throws(() =>
    configureBudgets(
      s,
      list,
      { name: "林晓", role: "员工" },
      "越权",
      at,
      "CFG",
    ),
  );
  list.find((b) => b.budgetId === bid)!.departmentId = "product";
  assert.throws(
    () => configureBudgets(s, list, finance, "不能原地改维度", at, "CFG"),
    /维度/,
  );
});
test("七规则异常独立保留，超预算不能隐藏发票/科目/审批风险", () => {
  const s = base("2500"),
    d = {
      ...bill("2500"),
      checkOut: "2026-10-21",
      accountCode: "6602.02",
      attachments: [],
    };
  Object.assign(d.invoices[0]!, {
    type: "增值税电子普通发票",
    code: "044001900111",
    number: "12345678",
    amountYuan: "1000",
    buyerName: "星河科技（东莞）有限公司",
    buyerTaxId: "DEMO-DG-001",
  });
  assert.deepEqual(
    auditAll(d, ctx(s)).map((r) => r.status),
    [
      "REVIEW",
      "REVIEW",
      "BLOCK",
      "BLOCK",
      "BLOCK",
      "INSUFFICIENT_DATA",
      "BLOCK",
    ],
  );
});
test("在途预算变为SOFT后追加授权节点，原业务审批保留，结转记当前预算版本", () => {
  let s = run(approveAll(submit(base())));
  const budgets = structuredClone(s.budgetBook!.budgets),
    b = budgets.find((b) => b.budgetId === bid)!;
  b.budgetAmount = 810000;
  b.controlMode = "SOFT";
  s = configureBudgets(
    s,
    budgets,
    finance,
    "由刚性调整为柔性授权",
    at,
    "SOFT-UPDATE",
  );
  s = run(s, "B2");
  assert.equal(current(doc(s))!.results[5]!.status, "REVIEW");
  const records = structuredClone(activeWorkflow(doc(s))!.records);
  s = requestBudgetAuthorization(
    s,
    "R007-BILL",
    defaultOrg(),
    finance,
    "按新预算补充授权",
    at,
  );
  assert.deepEqual(activeWorkflow(doc(s))!.records, records);
  s = run(approveAll(s), "B3");
  s = review(
    s,
    "R007-BILL",
    "B3",
    "approved",
    "额外预算授权已完成",
    "周宁",
    at,
  );
  assert.equal(s.budgetBook!.transactions.at(-1)!.budgetVersion, 2);
  assert.equal(
    (doc(s).batches.at(-1)!.budgetAtReview!.evidence as any).budget.version,
    2,
  );
  validate(s);
});
test("流水金额被篡改时拒绝计算，不补造预算余额", () => {
  const s = submit(base());
  s.budgetBook!.transactions.find((t) => t.scope === "CLAIM")!.amount += 1;
  assert.throws(() => validateBudgetBook(s.budgetBook!));
  const rs = auditAll(doc(s).input, ctx(s));
  assert.equal(rs[6]!.status, "ERROR");
});
test("已使用维度不能换新预算编号重置消耗，配置事件不悄悄释放历史", () => {
  const s = base(),
    budgets = structuredClone(s.budgetBook!.budgets),
    old = budgets.find((b) => b.budgetId === bid)!;
  old.status = "DISABLED";
  budgets.push({ ...old, status: "ACTIVE", budgetId: "REPLACED-ID" });
  assert.throws(
    () =>
      configureBudgets(s, budgets, finance, "禁止重置已有占用", at, "REPLACE"),
    /重置/,
  );
});
test("实际并发写入冲突只拒绝覆盖，不宣称解决跨窗口原子性", () => {
  const s = submit(base());
  const before = JSON.stringify(s);
  const storage = {
    getItem: () => '{"otherWriter":true}',
    setItem: () => {
      throw Error("不应覆盖");
    },
  };
  assert.throws(() => save(storage, s, null), /其他页面/);
  assert.equal(JSON.stringify(s), before);
});
test("历史六规则批次原样可读，新财务批准须R007且不能靠核查意见免占用", () => {
  const s = run(approveAll(submit(base()))),
    b = current(doc(s))!;
  b.ruleKeys = b.ruleKeys.filter((k) => k !== "budget.capacity");
  b.results = b.results.filter((r) => r.ruleId !== "R007");
  delete b.context.budgetBook;
  delete b.context.budgetOrg;
  delete b.context.budgetEscalation;
  validate(s);
  assert.throws(
    () =>
      review(s, "R007-BILL", "B1", "approved", "不能免预算检查", "周宁", at),
    /未执行R007/,
  );
});
