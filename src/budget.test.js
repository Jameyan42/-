import test from "node:test";
import assert from "node:assert/strict";
import { budgetRows } from "./budget.js";
test("预算按月份统计，退回释放占用，付款由在途转实际", () => {
  const base = { department: "销售部", date: "2026-10-20", amount: 200 };
  const items = [
    { ...base, status: "待主管审批" },
    { ...base, status: "已付款" },
    { ...base, status: "已退回" },
    { ...base, date: "2026-09-20", status: "已付款" },
  ];
  assert.deepEqual(budgetRows(items, { 销售部: 1000 }, "2026-10")[0], {
    department: "销售部",
    limit: 1000,
    paid: 200,
    reserved: 200,
    reimbursementReserved: 200,
    applicationReserved: 0,
    available: 600,
    ratio: 0.4,
  });
  items[0].status = "已付款";
  const row = budgetRows(items, { 销售部: 300 }, "2026-10")[0];
  assert.equal(row.reserved, 0);
  assert.equal(row.paid, 400);
  assert.equal(row.available, -100);
});
