import test from "node:test";
import assert from "node:assert/strict";
import { createState } from "./contractMockData";
import {
  auditContractPayment as audit,
  stageLimits,
  validateContract,
} from "./contractPaymentRule";
import { append, review, restore, load, save, KEY } from "./contractRepository";
import type { Application, State } from "./contractTypes";
const date = "2026-10-25",
  at = "2026-10-25T02:00:00.000Z";
const app = (patch: Partial<Application> = {}): Application => ({
  id: "APP-TEST",
  applicant: "李四（模拟）",
  department: "财务部",
  contractId: "HT-002",
  stageId: "S2",
  amountYuan: "35000",
  date,
  remark: "模拟",
  ...patch,
});
const run = (a = app(), s = createState(date)) =>
  audit(a, s.contracts, s.payments, date, at);
const missing = (s: State, c: number, id: string) => {
  s.contracts[c]!.evidence.find((e) => e.id === id)!.status = "缺失";
  return s;
};
test("T01 一次性小于余额通过", () =>
  assert.equal(
    run(app({ contractId: "HT-001", amountYuan: "70000" })).status,
    "passed",
  ));
test("T02 一次性超过余额", () =>
  assert.equal(
    run(app({ contractId: "HT-001", amountYuan: "90000" })).calculation
      ?.contractExcessCents,
    1000000,
  ));
test("T03 第二阶段25000通过", () =>
  assert.equal(run(app({ amountYuan: "25000" })).status, "passed"));
test("T04 第二阶段35000超5000", () => {
  const r = run();
  assert.equal(r.status, "review_required");
  assert.equal(r.calculation?.stageExcessCents, 500000);
});
test("T05 缺交付证明", () =>
  assert.ok(
    run(
      app({ amountYuan: "25000" }),
      missing(createState(date), 1, "delivery"),
    ).risks.some((r) => r.rule === "R003-05"),
  ));
test("T06 尾款缺验收报告", () =>
  assert.equal(
    run(
      app({ stageId: "S3", amountYuan: "100" }),
      missing(createState(date), 1, "report"),
    ).status,
    "review_required",
  ));
test("T07 结算余额30000通过", () =>
  assert.equal(
    run(app({ contractId: "HT-003", amountYuan: "30000" })).status,
    "passed",
  ));
test("T08 结算超10000", () =>
  assert.equal(
    run(app({ contractId: "HT-003", amountYuan: "40000" })).calculation
      ?.settlementExcessCents,
    1000000,
  ));
test("T09 合同不存在不计算", () =>
  assert.equal(run(app({ contractId: "NONE" })).calculation, null));
test("T10 终止转人工", () =>
  assert.equal(
    run(app({ contractId: "HT-004", amountYuan: "1" })).status,
    "review_required",
  ));
test("T11 过期转人工", () => {
  const s = createState(date);
  s.contracts[1]!.expiryDate = "2026-01-01";
  assert.equal(run(app(), s).status, "review_required");
});
test("T12 负金额错误", () =>
  assert.equal(run(app({ amountYuan: "-1" })).status, "invalid"));
test("T13 零元人工", () =>
  assert.equal(run(app({ amountYuan: "0" })).status, "review_required"));
test("T14 支付已满再申请", () => {
  const s = createState(date);
  s.payments[0]!.amountCents = 10000000;
  assert.equal(
    run(app({ contractId: "HT-001", amountYuan: "1" }), s).status,
    "review_required",
  );
});
test("T15 同时报阶段超额和缺证明", () => {
  const r = run(app(), missing(createState(date), 1, "delivery"));
  assert.ok(r.risks.some((r) => r.rule === "R003-04"));
  assert.ok(r.risks.some((r) => r.rule === "R003-05"));
});
const pending = () => {
  const s = createState(date);
  s.payments.push({
    id: "PENDING",
    contractId: "HT-002",
    applicationId: "OTHER",
    stageId: "S2",
    amountCents: 2000000,
    date,
    status: "待支付",
  });
  return s;
};
test("T16 待支付导致潜在超额", () =>
  assert.ok(
    run(app({ amountYuan: "25000" }), pending()).risks.some(
      (r) => r.rule === "R003-07",
    ),
  ));
test("T17 待支付不计已支付", () => {
  const n = run(app(), pending()).calculation!;
  assert.equal(n.paidCents, 4000000);
  assert.equal(n.pendingCents, 2000000);
});
test("T18 同单重审排除自身已支付", () => {
  const s = createState(date);
  s.payments.push({
    id: "SELF",
    contractId: "HT-002",
    applicationId: "APP-TEST",
    stageId: "S2",
    amountCents: 5000000,
    date,
    status: "已支付",
  });
  assert.equal(run(app({ amountYuan: "25000" }), s).status, "passed");
});
test("T19 合同修改新审核采用新金额", () => {
  let s = append(createState(date), app(), date, at, "V1");
  s.contracts[1]!.totalCents = 20000000;
  s = append(s, app(), date, at, "V2");
  assert.equal(s.documents[0]!.audits[1]!.automatic.status, "passed");
});
test("T20 旧快照不变", () => {
  const s = append(createState(date), app(), date, at, "V1"),
    before = JSON.stringify(s.documents);
  s.contracts[1]!.totalCents = 20000000;
  assert.equal(JSON.stringify(s.documents), before);
});
for (const [n, decision] of [
  ["T21", "approved"],
  ["T22", "rejected"],
] as const)
  test(n + " 人工结果保留自动且不改付款", () => {
    const s = append(createState(date), app(), date, at, "V1"),
      old = JSON.stringify(s.documents[0]!.audits[0]!.automatic),
      ps = JSON.stringify(s.payments);
    const next = review(
      s,
      "APP-TEST",
      "V1",
      decision,
      "模拟复核原因",
      "财务",
      at,
    );
    assert.equal(JSON.stringify(next.documents[0]!.audits[0]!.automatic), old);
    assert.equal(JSON.stringify(next.payments), ps);
  });
test("T23 原因空阻止", () =>
  assert.throws(() =>
    review(
      append(createState(date), app(), date, at, "V1"),
      "APP-TEST",
      "V1",
      "approved",
      "",
      "财务",
      at,
    ),
  ));
test("T24 100.01精确10001分", () =>
  assert.equal(
    run(app({ amountYuan: "100.01" })).calculation?.amountCents,
    10001,
  ));
test("T25 超两位小数错误", () =>
  assert.equal(run(app({ amountYuan: "100.001" })).status, "invalid"));
test("T26 比例和错误不能保存", () => {
  const s = createState(date);
  s.contracts[1]!.stages[0]!.basisPoints = 2000;
  assert.throws(() => validateContract(s.contracts[1]!));
});
test("T27 排除自身待支付", () => {
  const s = pending();
  s.payments.at(-1)!.applicationId = "APP-TEST";
  assert.equal(
    run(app({ amountYuan: "25000" }), s).calculation?.pendingCents,
    0,
  );
});
test("T28 证据变化新结果旧快照不变", () => {
  let s = append(
    createState(date),
    app({ amountYuan: "25000" }),
    date,
    at,
    "V1",
  );
  s = missing(s, 1, "delivery");
  s = append(s, app({ amountYuan: "25000" }), date, at, "V2");
  assert.equal(s.documents[0]!.audits[0]!.automatic.status, "passed");
  assert.equal(s.documents[0]!.audits[1]!.automatic.status, "review_required");
});
function storage() {
  const m = new Map<string, string>();
  return {
    m,
    storage: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    } as Storage,
  };
}
test("T29 恢复保留R001/R002和R003证据", () => {
  const { m, storage: s } = storage();
  m.set("qingbao-r001-v1", "原单1");
  m.set("qingbao-r002-v1", "原单2");
  const original = append(createState(date), app(), date, at, "V1");
  save(s, restore(original, date), null);
  assert.equal(m.get("qingbao-r001-v1"), "原单1");
  assert.equal(m.get("qingbao-r002-v1"), "原单2");
  assert.deepEqual(load(s, date).state.documents, original.documents);
});
import { auditLodging } from "../r001/rule";
import { auditInvoiceDuplicate } from "../r002/invoiceDuplicateRule";
import { exampleClaim, createMockHistory } from "../r002/invoiceMockData";
test("T30 R001函数保留及R002原T02回归", () => {
  assert.equal(typeof auditLodging, "function");
  assert.equal(
    auditInvoiceDuplicate(exampleClaim(), createMockHistory(), {
      at,
      dataRevision: 1,
    }).status,
    "review_required",
  );
});
test("尾差合计和小金额", () => {
  const c = createState(date).contracts[1]!;
  c.totalCents = 1;
  assert.deepEqual(stageLimits(c), [0, 0, 1]);
  c.totalCents = 10001;
  assert.equal(
    stageLimits(c).reduce((a, b) => a + b, 0),
    10001,
  );
});
test("历史超额、无效日期及坏状态不生成假金额", () => {
  const s = createState(date);
  s.payments[0]!.amountCents = 11000000;
  const r = run(app({ contractId: "HT-001", amountYuan: "1" }), s);
  assert.equal(r.calculation?.remainingCents, 0);
  assert.ok(r.risks.some((r) => r.message.includes("历史数据异常")));
  assert.equal(run(app({ date: "2026-02-30" })).calculation, null);
  s.payments[0]!.amountCents = NaN;
  assert.equal(run(app(), s).calculation, null);
});
test("结算与总额同时超限都返回", () => {
  const r = run(app({ contractId: "HT-003", amountYuan: "80000" }));
  assert.ok(r.risks.some((r) => r.rule === "R003-03"));
  assert.ok(r.risks.some((r) => r.rule === "R003-06"));
});
test("持久化、冲突、重复复核、纯函数不改输入", () => {
  const { storage: s } = storage(),
    initial = createState(date),
    before = JSON.stringify(initial);
  run(app(), initial);
  assert.equal(JSON.stringify(initial), before);
  const next = review(
    append(initial, app(), date, at, "V1"),
    "APP-TEST",
    "V1",
    "rejected",
    "不符",
    "财务",
    at,
  );
  save(s, next, null);
  assert.deepEqual(load(s, date).state, next);
  assert.throws(() => save(s, next, null));
  assert.throws(() =>
    review(next, "APP-TEST", "V1", "approved", "改判", "财务", at),
  );
  s.setItem(KEY, "坏JSON");
  assert.throws(() => load(s, date));
});
