import test from "node:test";
import assert from "node:assert/strict";
import {
  requestBalance,
  requestAction,
  assertClaimLink,
  validateRequest,
  validateRequestSet,
} from "./requests.js";
import { budgetRows } from "./budget.js";
import { validateBackup, defaultPolicy } from "./settings.js";
const req = () => ({
  id: "SQ1",
  name: "客户拜访",
  employee: "林晓",
  department: "销售部",
  month: "2026-10",
  type: "差旅交通",
  amount: 1000,
  note: "虚构出差计划",
  status: "待审批",
  history: [],
});
const claim = () => ({
  id: "BX1",
  name: "交通报销",
  employee: "林晓",
  department: "销售部",
  date: "2026-10-23",
  type: "差旅交通",
  amount: 600,
  note: "虚构用途",
  status: "待主管审批",
  requestId: "SQ1",
  invoice: "12345678",
  receipt: "demo.pdf",
  history: [],
});
test("审批与结束校验角色、阶段、原因及在途报销", () => {
  assert.throws(() => requestAction(req(), "approve", "财务", "林晓", []));
  assert.throws(() => requestAction(req(), "reject", "主管", "林晓", [], ""));
  const r = requestAction(req(), "approve", "主管", "林晓", []);
  assert.equal(r.status, "已批准");
  assert.throws(() => requestAction(r, "close", "员工", "其他人", [], "结束"));
  assert.throws(() =>
    requestAction(r, "close", "员工", "林晓", [claim()], "结束"),
  );
  assert.equal(
    requestAction(r, "close", "员工", "林晓", [], "计划取消").status,
    "已关闭",
  );
});
test("批准预留、报销核销、付款转换和结束释放均不重复占用", () => {
  const r = { ...req(), status: "已批准" },
    limits = { 销售部: 2000 };
  const check = (items, requests) =>
    budgetRows(items, limits, "2026-10", requests)[0];
  assert.equal(check([], [req()]).reserved, 0);
  assert.equal(check([], [r]).applicationReserved, 1000);
  const x = claim();
  let b = check([x], [r]);
  assert.equal(b.reimbursementReserved, 600);
  assert.equal(b.applicationReserved, 400);
  assert.equal(b.reserved, 1000);
  x.status = "已付款";
  b = check([x], [r]);
  assert.equal(b.paid, 600);
  assert.equal(b.reserved, 400);
  r.status = "已关闭";
  b = check([x], [r]);
  assert.equal(b.paid, 600);
  assert.equal(b.reserved, 0);
  assert.equal(b.available, 1400);
});
test("撤回恢复申请余额，结束才释放余额，拒绝超额、跨人、跨月和类型", () => {
  const r = { ...req(), status: "已批准" },
    x = claim();
  assertClaimLink(x, [r], []);
  assert.throws(() => assertClaimLink({ ...x, id: "BX2" }, [r], [x]));
  assert.throws(() => assertClaimLink({ ...x, employee: "陈嘉" }, [r], []));
  assert.throws(() => assertClaimLink({ ...x, date: "2026-11-01" }, [r], []));
  assert.throws(() => assertClaimLink({ ...x, type: "办公采购" }, [r], []));
  x.status = "已撤回";
  assert.equal(requestBalance(r, [x]).remaining, 1000);
  assert.equal(
    budgetRows([x], { 销售部: 2000 }, "2026-10", [r])[0].reserved,
    1000,
  );
  assert.doesNotThrow(() =>
    assertClaimLink({ ...x, status: "草稿", amount: 1500 }, [r], []),
  );
  assert.throws(() =>
    assertClaimLink({ ...x, status: "待主管审批", amount: 1500 }, [r], []),
  );
});
test("申请货币精度和多笔零点金额按分判断", () => {
  assert.throws(() => validateRequest({ ...req(), amount: 0.001 }));
  const r = { ...req(), status: "已批准", amount: 0.3 };
  const x = { ...claim(), amount: 0.1 };
  assert.doesNotThrow(() =>
    assertClaimLink({ ...x, id: "BX2", amount: 0.2 }, [r], [x]),
  );
  assert.throws(() =>
    assertClaimLink({ ...x, id: "BX2", amount: 0.21 }, [r], [x]),
  );
});
test("备份支持申请和关联，旧备份保持兼容，非法与悬空关联被拒绝", () => {
  const r = { ...req(), status: "已批准" },
    x = claim();
  const backup = {
    format: "qingbao-backup",
    version: 1,
    items: [x],
    requests: [r],
    budgets: { 销售部: 2000, 产品部: 3000, 运营部: 4000 },
    policy: defaultPolicy,
    audit: [],
  };
  assert.doesNotThrow(() => validateBackup(backup));
  assert.throws(() => validateBackup({ ...backup, requests: null }));
  assert.throws(() => validateBackup({ ...backup, requests: [] }));
  assert.throws(() => validateRequestSet([r, r], [x]));
  assert.throws(() =>
    validateBackup({ ...backup, requests: [{ ...r, status: "已关闭" }] }),
  );
  delete x.requestId;
  delete backup.requests;
  assert.doesNotThrow(() => validateBackup(backup));
});
