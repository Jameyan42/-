import test from "node:test";
import assert from "node:assert/strict";
import {
  batchPayment,
  batchReferences,
  assertUniqueReference,
  paymentCsv,
} from "./payment-batch.js";
import { enterpriseOrg } from "./organization.js";
import {
  compileApproval,
  defaultFlows,
  financeDivisionFlows,
} from "./approval.js";
const org = enterpriseOrg(),
  actor = org.people.find((p) => p.id === "payer-du");
const doc = (id = "A") => {
  const d = {
    id,
    name: id,
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 200,
    date: "2026-10-23",
    status: "待付款",
    invoice: id,
    receipt: "虚构.pdf",
    note: "用途",
    history: [],
  };
  const a = compileApproval(
    d,
    "expense",
    org,
    financeDivisionFlows(defaultFlows(), org),
  );
  return {
    ...d,
    approval: { ...a, cursor: a.nodes.length },
    ledgerReview: {
      account: "6602",
      costCenter: "销售部",
      reviewedBy: "ledger-gao",
      at: "2026-10-23T00:00:00Z",
    },
  };
};
const data = () => ({
  prefix: "DEMO-TEST",
  date: "2026-10-23",
  method: "银行转账",
  confirmed: true,
  note: "虚构批次",
});
test("批量逐笔生成独立参考号、处理记录、元数据且不修改输入", () => {
  const items = [doc("A"), doc("B")],
    before = JSON.stringify(items),
    next = batchPayment(items, ["A", "B"], actor, data());
  assert(next.every((d) => d.status === "已付款"));
  assert.deepEqual(
    next.map((d) => d.payment.reference),
    ["DEMO-TEST-001", "DEMO-TEST-002"],
  );
  assert(
    next.every(
      (d) =>
        d.history.at(-1).operation.actorId === actor.id &&
        d.history.at(-1).operation.action === "pay",
    ),
  );
  assert.equal(JSON.stringify(items), before);
});
test("前缀数量确认日期和方式校验、重复ID及上限", () => {
  assert.deepEqual(batchReferences("ABC", 2), ["ABC-001", "ABC-002"]);
  for (const p of ["a", "<img>", "空 格"])
    assert.throws(() => batchReferences(p, 1));
  assert.throws(() => batchReferences("ABC", 21));
  for (const ids of [
    [],
    ["A", "A"],
    Array.from({ length: 21 }, (_, i) => String(i)),
  ])
    assert.throws(() => batchPayment([doc()], ids, actor, data()));
  for (const changes of [
    { confirmed: false },
    { date: "2026-02-30" },
    { method: "线上付款" },
    { note: "x".repeat(401) },
  ])
    assert.throws(() =>
      batchPayment([doc()], ["A"], actor, { ...data(), ...changes }),
    );
});
test("任一单权限状态或总账失败整批不生成可提交结果", () => {
  const items = [doc("A"), doc("B")],
    before = JSON.stringify(items);
  const bad = structuredClone(items);
  delete bad[1].ledgerReview;
  assert.throws(() => batchPayment(bad, ["A", "B"], actor, data()));
  assert.throws(() => batchPayment(items, ["A", "MISSING"], actor, data()));
  assert.throws(() =>
    batchPayment([{ ...items[0], status: "待总账复核" }], ["A"], actor, data()),
  );
  assert.throws(() =>
    batchPayment(items, ["A"], { ...actor, id: "other" }, data()),
  );
  assert.throws(() =>
    batchPayment(items, ["A"], { ...actor, role: "管理员" }, data()),
  );
  assert.throws(() =>
    batchPayment(items, ["A"], { ...actor, active: false }, data()),
  );
  assert.equal(JSON.stringify(items), before);
});
test("参考号跨现有已付款记录去空白及大小写判重，不改旧重复数据", () => {
  const paid = {
    ...doc("OLD"),
    status: "已付款",
    payment: {
      reference: " demo-test-002 ",
      date: "2026-10-22",
      method: "银行转账",
      confirmed: true,
    },
  };
  const items = [doc("A"), doc("B"), paid],
    before = JSON.stringify(items);
  assert.throws(() => batchPayment(items, ["A", "B"], actor, data()), /已使用/);
  assert.throws(() => assertUniqueReference("DEMO-TEST-002", items), /已使用/);
  assert.doesNotThrow(() => assertUniqueReference("new-ref", items));
  assert.equal(JSON.stringify(items), before);
});
test("旧角色财务及schema1付款兼容，批量有风险不可办理", () => {
  const finance = org.people.find((p) => p.id === "finance-zhou"),
    legacy = doc("OLD");
  delete legacy.approval;
  delete legacy.ledgerReview;
  assert.equal(
    batchPayment([legacy], ["OLD"], finance, data())[0].status,
    "已付款",
  );
  const d = { ...legacy, id: "SNAP", invoice: "SNAP" },
    a = compileApproval(d, "expense", org, defaultFlows());
  d.approval = { ...a, cursor: a.nodes.length };
  assert.equal(
    batchPayment([d], ["SNAP"], finance, data())[0].status,
    "已付款",
  );
  assert.throws(
    () => batchPayment([{ ...legacy, receipt: "" }], ["OLD"], finance, data()),
    /预审风险/,
  );
});
test("付款清单导出明确责任人总账及筛选、防公式，不导出额外单据", () => {
  const d = doc("A");
  d.name = " =SUM(1)";
  const csv = paymentCsv([d], { filter: "待付款", query: "销售部" });
  assert.match(csv, /' =SUM/);
  assert.match(csv, /杜川/);
  assert.match(csv, /6602/);
  assert.match(csv, /状态筛选/);
  assert.match(csv, /销售部/);
  assert(!csv.includes("未传入单据"));
});
