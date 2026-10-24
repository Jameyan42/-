import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBudgetControl,
  setMonthlyBudget,
  effectiveBudget,
  monthlyBudgetRows,
  budgetLedger,
  assertBudgetIncrease,
  validateBudgetControl,
  persistBudgetControl,
  budgetCsv,
} from "./budget-control.js";
import { validateBackup, defaultPolicy } from "./settings.js";
const limits = { 销售部: 1000, 产品部: 2000, 运营部: 1000 },
  actor = { id: "fin", name: "周宁", role: "财务", active: true };
const expense = (extra = {}) => ({
  id: "X",
  name: "虚构报销",
  department: "销售部",
  employee: "林晓",
  date: "2026-10-24",
  amount: 200,
  status: "待主管审批",
  ...extra,
});
const request = (extra = {}) => ({
  id: "R",
  name: "虚构计划",
  department: "销售部",
  employee: "林晓",
  month: "2026-10",
  amount: 500,
  status: "已批准",
  ...extra,
});
const configured = (limit = 500, mode = "block") =>
  setMonthlyBudget(
    emptyBudgetControl(),
    limits,
    {
      department: "销售部",
      month: "2026-10",
      limit,
      mode,
      reason: "演示本月预算管控",
    },
    actor,
  );
test("独立月度预算不改默认或其他月份，财务调整保存具名前后值和版本", () => {
  const old = emptyBudgetControl(),
    c = configured(300);
  assert.equal(old.periods.length, 0);
  assert.equal(limits.销售部, 1000);
  assert.equal(effectiveBudget(limits, c, "销售部", "2026-10").limit, 300);
  assert.equal(effectiveBudget(limits, c, "销售部", "2026-11").limit, 1000);
  assert.equal(effectiveBudget(limits, c, "产品部", "2026-10").mode, "warn");
  assert.equal(c.history[0].before.limit, 1000);
  assert.equal(c.history[0].after.mode, "block");
  assert.equal(c.history[0].actorId, "fin");
  assert.throws(
    () =>
      setMonthlyBudget(
        old,
        limits,
        {
          department: "销售部",
          month: "2026-10",
          limit: 300,
          mode: "warn",
          reason: "虚构配置调整",
        },
        { ...actor, role: "员工" },
      ),
    /财务/,
  );
});
test("新增报销占用超预算拦截，等额/预警/草稿/释放不会误拦", () => {
  const c = configured(300),
    before = [expense()];
  assert.throws(
    () =>
      assertBudgetIncrease(
        before,
        [...before, expense({ id: "Y", amount: 101 })],
        [],
        [],
        limits,
        c,
      ),
    /新增占用超预算/,
  );
  assert.doesNotThrow(() =>
    assertBudgetIncrease(
      before,
      [...before, expense({ id: "Y", amount: 100 })],
      [],
      [],
      limits,
      c,
    ),
  );
  assert.doesNotThrow(() =>
    assertBudgetIncrease(
      before,
      [...before, expense({ id: "Y", amount: 999, status: "草稿" })],
      [],
      [],
      limits,
      c,
    ),
  );
  assert.doesNotThrow(() =>
    assertBudgetIncrease(
      before,
      [{ ...before[0], status: "已退回" }],
      [],
      [],
      limits,
      c,
    ),
  );
  assert.doesNotThrow(() =>
    assertBudgetIncrease(
      before,
      [...before, expense({ id: "Y", amount: 999 })],
      [],
      [],
      limits,
      configured(300, "warn"),
    ),
  );
});
test("申请仅最终批准增加预留，提交和中间批准无占用", () => {
  const c = configured(300),
    r = request({ status: "待审批" });
  assert.doesNotThrow(() => assertBudgetIncrease([], [], [], [r], limits, c));
  assert.doesNotThrow(() =>
    assertBudgetIncrease([], [], [r], [{ ...r }], limits, c),
  );
  assert.throws(
    () =>
      assertBudgetIncrease(
        [],
        [],
        [r],
        [{ ...r, status: "已批准" }],
        limits,
        c,
      ),
    /新增占用超预算/,
  );
  assert.doesNotThrow(() =>
    assertBudgetIncrease(
      [],
      [],
      [{ ...r, status: "已批准" }],
      [{ ...r, status: "已关闭" }],
      limits,
      c,
    ),
  );
});
test("已预留申请转报销/付款不重复占用，降额不阻断既有预留的核销", () => {
  const c = configured(100),
    r = request(),
    claim = expense({ amount: 200, requestId: "R" });
  assert.doesNotThrow(() =>
    assertBudgetIncrease([], [claim], [r], [r], limits, c),
  );
  assert.doesNotThrow(() =>
    assertBudgetIncrease(
      [claim],
      [{ ...claim, status: "已付款" }],
      [r],
      [r],
      limits,
      c,
    ),
  );
  const row = monthlyBudgetRows([claim], limits, "2026-10", [r], c)[0];
  assert.equal(row.reimbursementReserved, 200);
  assert.equal(row.applicationReserved, 300);
  assert.equal(row.reserved, 500);
  const withdrawn = { ...claim, status: "已撤回" };
  assert.equal(
    monthlyBudgetRows([withdrawn], limits, "2026-10", [r], c)[0]
      .applicationReserved,
    500,
  );
  assert.throws(
    () =>
      assertBudgetIncrease(
        [claim],
        [claim, expense({ id: "new", amount: 1 })],
        [r],
        [r],
        limits,
        c,
      ),
    /新增占用超预算/,
  );
});
test("预算与明细分币精确，贡献明细之和等于已付款加预留，关闭释放余额", () => {
  const c = configured(0.3),
    items = [
      expense({ id: "a", amount: 0.1, status: "已付款" }),
      expense({ id: "b", amount: 0.2 }),
    ];
  assert.doesNotThrow(() => assertBudgetIncrease([], items, [], [], limits, c));
  const r = monthlyBudgetRows(items, limits, "2026-10", [], c)[0];
  assert.equal(r.available, 0);
  assert.equal(Math.round((r.paid + r.reserved) * 100), 30);
  const plan = request({ amount: 500 }),
    claim = expense({ amount: 265, status: "已付款", requestId: "R" });
  const detail = budgetLedger([claim], [plan], "销售部", "2026-10");
  assert.equal(
    detail.reduce((s, d) => s + Math.round(d.amount * 100), 0),
    50000,
  );
  assert.equal(detail[1].amount, 235);
  assert.equal(
    budgetLedger([claim], [{ ...plan, status: "已关闭" }], "销售部", "2026-10")
      .length,
    1,
  );
  const csv = budgetCsv([{ ...detail[0], name: "=TEST()" }], true);
  assert.match(csv, /'=TEST/);
});
test("配置格式、重复期间、数量和分币校验，配额失败保留原配置", () => {
  const c = configured();
  assert.throws(() =>
    validateBudgetControl(
      { ...c, periods: [...c.periods, c.periods[0]] },
      limits,
    ),
  );
  assert.throws(() => configured(1.001));
  assert.throws(() =>
    setMonthlyBudget(
      c,
      limits,
      {
        department: "销售部",
        month: "2026-13",
        limit: 1,
        mode: "warn",
        reason: "虚构无效月份",
      },
      actor,
    ),
  );
  assert.throws(() =>
    validateBudgetControl(
      { ...c, periods: Array.from({ length: 241 }, () => c.periods[0]) },
      limits,
    ),
  );
  const before = JSON.stringify(c);
  assert.throws(
    () =>
      persistBudgetControl(
        {
          setItem() {
            throw Error("quota");
          },
        },
        c,
        limits,
      ),
    /原预算未改动/,
  );
  assert.equal(JSON.stringify(c), before);
});
test("旧预算备份兼容，完整备份包含新配置，坏部门拒绝不补造", () => {
  const backup = {
    format: "qingbao-backup",
    version: 1,
    items: [],
    budgets: limits,
    policy: { ...defaultPolicy },
    audit: [],
    budgetControl: configured(),
  };
  assert.doesNotThrow(() => validateBackup(structuredClone(backup)));
  const bad = structuredClone(backup);
  bad.budgetControl.periods[0].department = "不存在";
  assert.throws(() => validateBackup(bad));
  delete backup.budgetControl;
  assert.doesNotThrow(() => validateBackup(backup));
});
