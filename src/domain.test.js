import test from "node:test";
import assert from "node:assert/strict";
import { review, transition } from "./domain.js";
const clean = () => ({
  id: "a",
  amount: 200,
  receipt: "a.pdf",
  invoice: "001",
  status: "待主管审批",
  history: [],
  flags: [],
});
test("识别超标、缺附件和重复票据，排除自身", () => {
  const x = { ...clean(), amount: 3100, receipt: "" };
  assert.equal(review(x, [x, { id: "b", invoice: "001" }]).length, 3);
  assert.equal(review(clean(), [clean()]).length, 0);
});
test("正常单完成主管、财务审核及付款", () => {
  let x = transition(clean(), "approve", "主管");
  assert.equal(x.status, "待财务审核");
  x = transition(x, "approve", "财务");
  assert.equal(x.status, "待付款");
  x = transition(x, "approve", "财务", "", {
    method: "银行转账",
    reference: "DEMO001",
    date: "2026-10-22",
    confirmed: true,
  });
  assert.equal(x.status, "已付款");
  assert.equal(x.history.length, 3);
});
test("拒绝越权、无理由退回及风险单财务放行", () => {
  assert.throws(() => transition(clean(), "approve", "员工"));
  assert.throws(() => transition(clean(), "reject", "主管"));
  const x = { ...clean(), status: "待财务审核", flags: ["重复"] };
  assert.throws(() => transition(x, "approve", "财务"));
  assert.equal(
    transition(x, "reject", "财务", "核对重复票据").status,
    "已退回",
  );
});
