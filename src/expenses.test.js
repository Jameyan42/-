import test from "node:test";
import assert from "node:assert/strict";
import { withdraw, invoiceRows, validatePayment } from "./expenses.js";
import { review, transition } from "./domain.js";
import { budgetRows } from "./budget.js";
import { validateBackup, defaultPolicy } from "./settings.js";
const item = () => ({
  id: "a",
  name: "客户拜访",
  employee: "林晓",
  department: "销售部",
  amount: 200,
  type: "差旅交通",
  date: "2026-10-22",
  invoice: "001",
  receipt: "票据.pdf",
  status: "待主管审批",
  note: "拜访客户",
  history: [],
});
const payment = () => ({
  date: "2026-10-22",
  reference: "DEMO-PAY-001",
  method: "银行转账",
  confirmed: true,
});
test("仅本人主管审批前可撤回，撤回释放预算及重复号码占用", () => {
  const x = item();
  assert.throws(() => withdraw(x, "陈嘉", "金额有误"));
  assert.throws(() =>
    withdraw({ ...x, status: "待财务审核" }, "林晓", "金额有误"),
  );
  assert.throws(() => withdraw(x, "林晓", ""));
  const w = withdraw(x, "林晓", "金额有误");
  assert.equal(w.status, "已撤回");
  assert.equal(w.history.length, 1);
  assert.equal(budgetRows([w], { 销售部: 1000 }, "2026-10")[0].reserved, 0);
  assert.deepEqual(review(w, []), []);
  assert.deepEqual(review(x, [w]), []);
});
test("票据索引正确标记有效重复，草稿隐藏，员工筛选", () => {
  const a = item(),
    b = { ...item(), id: "b", employee: "陈嘉" },
    c = { ...item(), id: "c", status: "草稿" };
  assert.equal(invoiceRows([a, b, c]).length, 2);
  assert.ok(invoiceRows([a, b, c]).every((x) => x.duplicate));
  assert.equal(invoiceRows([a, b, c], "林晓").length, 1);
  assert.ok(
    invoiceRows([a, { ...b, status: "已撤回" }]).every((x) => !x.duplicate),
  );
});
test("付款必须确认并提供有效参考号和日期，保留结构化付款信息", () => {
  const x = { ...item(), status: "待付款" };
  assert.throws(() => transition(x, "approve", "财务"));
  assert.throws(() => validatePayment({ ...payment(), confirmed: false }));
  assert.throws(() => validatePayment({ ...payment(), date: "2026-02-30" }));
  assert.throws(() => validatePayment({ ...payment(), reference: "x" }));
  const result = transition(x, "approve", "财务", "", payment());
  assert.equal(result.status, "已付款");
  assert.equal(result.payment.reference, "DEMO-PAY-001");
  assert.equal(result.history.length, 1);
  assert.throws(() => transition(result, "approve", "财务", "", payment()));
});
test("旧备份保持兼容，新备份恢复撤回和付款记录，非法付款被拒绝", () => {
  const data = {
    format: "qingbao-backup",
    version: 1,
    items: [withdraw(item(), "林晓", "修正金额")],
    budgets: { 销售部: 1000, 产品部: 2000, 运营部: 3000 },
    policy: { ...defaultPolicy },
    audit: [],
  };
  assert.doesNotThrow(() => validateBackup(data));
  data.items = [
    transition(
      { ...item(), status: "待付款" },
      "approve",
      "财务",
      "",
      payment(),
    ),
  ];
  assert.doesNotThrow(() => validateBackup(data));
  data.items[0].payment.reference = "";
  assert.throws(() => validateBackup(data));
});
