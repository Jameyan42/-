import { defaultEntities } from "./entity-rule";
import test from "node:test";
import assert from "node:assert/strict";
import { createExampleStandards } from "../r001/standards";
import { createMockHistory } from "../r002/invoiceMockData";
import { amountRule, auditAll, registry } from "./rules";
import {
  empty,
  saveDraft,
  execute,
  current,
  review,
  load,
  save,
} from "./model";
import type { Input, Context } from "./types";
const at = "2026-10-30T02:00:00.000Z";
const context = (): Context => ({
  at,
  entityConfig: defaultEntities(),
  standards: createExampleStandards(),
  invoiceHistory: createMockHistory(),
});
export const example = (): Input => ({
  id: "S001-TEST",
  companyId: "SZ",
  employee: "李四",
  grade: "普通员工",
  department: "财务部",
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
      id: "INV-TEST",
      type: "数电发票",
      code: "",
      number: "98765432101234567890",
      amountYuan: "600",
      currency: "CNY",
      date: "2026-10-22",
      sellerName: "模拟酒店",
      buyerName: "星河科技（深圳）有限公司",
      sellerTaxId: "",
      buyerTaxId: "DEMO-SZ-001",
      source: "manual",
    },
  ],
});
const submit = (d = example(), c = context()) =>
  execute(saveDraft(empty(), d, at), d.id, c, "B1");
test("S01 正常600三规则通过，非最终财务批准", () => {
  const s = submit(),
    d = s.claims[0]!;
  assert.equal(d.status, "规则检查通过（待财务确认）");
  assert.deepEqual(
    current(d)!.results.map((r) => r.status),
    ["PASS", "PASS", "PASS", "PASS"],
  );
});
test("S02 800限额申请1200票1000重复，同批超400/重复/拦截200", () => {
  const d = example(),
    c = context();
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
  };
  const r = current(submit(d, c).claims[0]!)!.results;
  assert.deepEqual(
    r.map((r) => r.status),
    ["REVIEW", "REVIEW", "BLOCK", "PASS"],
  );
  assert.equal((r[0]!.evidence as { excessCents: number }).excessCents, 40000);
  assert.equal(
    (r[2]!.evidence as { differenceCents: number }).differenceCents,
    20000,
  );
});
test("S03 部分报销原因保留，低于票额不判违规", () => {
  const d = example();
  d.amountYuan = "800";
  d.invoices[0]!.amountYuan = "1000";
  d.partialReason = "个人承担差额";
  const r = amountRule(d);
  assert.equal(r.status, "REVIEW");
  assert.match(JSON.stringify(r.evidence), /个人承担差额/);
});
test("S04 缺失/负数/多位小数/外币不假通过", () => {
  for (const amount of ["", "-1", "100.001"]) {
    const d = example();
    d.invoices[0]!.amountYuan = amount;
    assert.equal(amountRule(d).status, "INSUFFICIENT_DATA");
  }
  const d = example();
  d.invoices[0]!.currency = "USD";
  assert.equal(amountRule(d).status, "INSUFFICIENT_DATA");
});
test("S05 财务意见独立保存、刷新保留、不重复复核", () => {
  const s = submit(),
    next = review(s, "S001-TEST", "B1", "approved", "已核查材料", "财务", at);
  assert.deepEqual(
    next.claims[0]!.batches[0]!.results,
    s.claims[0]!.batches[0]!.results,
  );
  assert.equal(next.claims[0]!.status, "已通过");
  assert.throws(() =>
    review(next, "S001-TEST", "B1", "rejected", "再次处理", "财务", at),
  );
  const m = new Map<string, string>(),
    storage = {
      getItem: (k: string) => m.get(k) || null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    };
  save(storage, next, null);
  assert.deepEqual(load(storage).state, next);
});
test("S06 修改使当前审核失效并清除批准，旧历史不变", () => {
  const s = review(
      submit(),
      "S001-TEST",
      "B1",
      "approved",
      "核查通过",
      "财务",
      at,
    ),
    d = example();
  d.amountYuan = "700";
  const next = saveDraft(s, d, at, {
    actor: "李四",
    role: "员工",
    reason: "修正金额",
  });
  assert.equal(next.claims[0]!.status, "草稿");
  assert.equal(current(next.claims[0]!), undefined);
  assert.deepEqual(next.claims[0]!.batches, s.claims[0]!.batches);
  assert.throws(() =>
    review(next, d.id, "B1", "approved", "旧批次不可用", "财务", at),
  );
});
test("S08 同单连续重审不自匹配，批次保留", () => {
  const s = execute(submit(), "S001-TEST", context(), "B2");
  assert.equal(s.claims[0]!.batches.length, 2);
  assert.equal(current(s.claims[0]!)!.results[1]!.status, "PASS");
});
test("多票合计400+300=700；0.01+0.02=0.03精确", () => {
  for (const [a, b, total] of [
    ["400", "300", "700"],
    ["0.01", "0.02", "0.03"],
  ]) {
    const d = example();
    d.amountYuan = total!;
    d.invoices = [
      { ...d.invoices[0]!, amountYuan: a! },
      { ...d.invoices[0]!, id: "SECOND", amountYuan: b! },
    ];
    assert.equal(amountRule(d).status, "PASS");
  }
});
test("同单两张同票命中；另一单同票命中并保留自身排除", () => {
  const d = example();
  d.invoices.push({ ...d.invoices[0]!, id: "SECOND" });
  assert.equal(auditAll(d, context())[1]!.status, "REVIEW");
  let s = submit();
  const other = {
    ...example(),
    id: "OTHER",
    invoices: [{ ...example().invoices[0]!, id: "INV-OTHER" }],
  };
  s = execute(saveDraft(s, other, at), "OTHER", context(), "B2");
  assert.equal(current(s.claims[0]!)!.results[1]!.status, "REVIEW");
});
test("BLOCK/资料不足/ERROR不可普通通过，允许驳回；意见必填", () => {
  const d = example();
  d.amountYuan = d.hotelAmountYuan = "800";
  const s = submit(d);
  assert.throws(() => review(s, d.id, "B1", "approved", "例外", "财务", at));
  assert.equal(
    review(s, d.id, "B1", "rejected", "缺票请补充", "财务", at).claims[0]!
      .status,
    "已驳回",
  );
  assert.throws(() => review(submit(), d.id, "B1", "approved", "", "财务", at));
});
test("单规则失败独立ERROR，其他照常执行；可注册新规则", () => {
  const rs = auditAll(example(), context(), [
    ...registry,
    {
      ruleId: "R004",
      ruleKey: "test",
      ruleName: "测试",
      execute: () => {
        throw Error("mock failure");
      },
    },
  ]);
  assert.equal(rs.length, 5);
  assert.equal(rs[0]!.status, "PASS");
  assert.equal(rs[4]!.status, "ERROR");
});
test("旧库损坏时相应规则ERROR，不影响金额规则", () => {
  const c = context();
  c.invoiceHistory = null;
  const rs = auditAll(example(), c);
  assert.equal(rs[1]!.status, "ERROR");
  assert.equal(rs[2]!.status, "PASS");
});
test("草稿及旧输入不可变、存储失败/冲突保留原值", () => {
  const d = example(),
    before = JSON.stringify(d);
  submit(d);
  assert.equal(JSON.stringify(d), before);
  const s = submit(),
    storage = {
      getItem: () => "other page",
      setItem: () => {
        throw Error("quota");
      },
    };
  assert.throws(() => save(storage, s, null));
  assert.throws(() => save(storage, s, "other page"));
});
test("真实UUID单号和票据编号适配后不超过原R002的80字符上限", () => {
  const d = example();
  d.id = "BX-S001-12345678-1234-1234-1234-123456789012";
  d.invoices[0]!.id = "12345678-1234-1234-1234-123456789012";
  assert.equal(auditAll(d, context())[1]!.status, "PASS");
});
test("追加注册规则后旧批次仍可读取，不偷偷补写新规则", () => {
  const s = submit();
  s.claims[0]!.batches[0]!.ruleKeys = s.claims[0]!.batches[0]!.ruleKeys.filter(
    (k) => k !== "invoice.buyer-entity",
  );
  s.claims[0]!.batches[0]!.results = s.claims[0]!.batches[0]!.results.filter(
    (r) => r.ruleId !== "R004",
  );
  registry.push({
    ruleId: "R004",
    ruleKey: "future.test",
    ruleName: "未来规则测试",
    execute: () => ({
      ruleId: "R004",
      ruleKey: "future.test",
      ruleName: "未来规则测试",
      status: "PASS",
      severity: "none",
      message: "测试",
      evidence: null,
      suggestedAction: "测试",
    }),
  });
  try {
    const m = new Map<string, string>(),
      storage = {
        getItem: (k: string) => m.get(k) || null,
        setItem: (k: string, v: string) => {
          m.set(k, v);
        },
      };
    save(storage, s, null);
    assert.equal(load(storage).state.claims[0]!.batches[0]!.results.length, 3);
  } finally {
    registry.pop();
  }
});
