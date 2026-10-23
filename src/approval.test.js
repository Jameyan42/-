import test from "node:test";
import assert from "node:assert/strict";
import { defaultOrg, validateOrg, assertOrgChange } from "./organization.js";
import {
  defaultFlows,
  validateFlows,
  compileApproval,
  approvalStatus,
  advanceApproval,
  canApprove,
  validateSnapshot,
} from "./approval.js";
import { withdraw } from "./expenses.js";
import { transition } from "./domain.js";
const actor = (id) => defaultOrg().people.find((p) => p.id === id);
const doc = (
  kind = "expense",
  amount = 4000,
  employee = "林晓",
  department = "销售部",
) => {
  const x = {
    employee,
    department,
    amount,
    type: "差旅交通",
    history: [],
    flags: [],
  };
  x.approval = compileApproval(x, kind, defaultOrg(), defaultFlows());
  x.status = approvalStatus(x.approval);
  return x;
};
test("组织拒绝部门循环、汇报循环、缺失上级和失效负责人", () => {
  for (const mutate of [
    (o) => {
      o.departments[1].parentId = "product";
      o.departments[2].parentId = "sales";
    },
    (o) => {
      o.people.find((p) => p.id === "head-xu").managerId = "manager-zhao";
    },
    (o) => {
      o.people[0].managerId = "missing";
    },
    (o) => {
      o.departments[1].headId = "lin";
    },
    (o) => {
      o.people[0].managerId = null;
    },
  ]) {
    const o = defaultOrg();
    mutate(o);
    assert.throws(() => validateOrg(o));
  }
  assert.doesNotThrow(() => validateOrg(defaultOrg()));
});
test("金额边界、类型条件、组织解析与重复人员合并", () => {
  assert.deepEqual(
    doc("expense", 3000).approval.nodes.map((n) => n.actorName),
    ["赵航", "周宁"],
  );
  assert.deepEqual(
    doc().approval.nodes.map((n) => n.actorName),
    ["赵航", "许明", "周宁"],
  );
  assert.deepEqual(
    doc("request", 4000, "唐宁", "运营部").approval.nodes.map(
      (n) => n.actorName,
    ),
    ["吴安"],
  );
  const flows = defaultFlows();
  flows.expense.type = "业务招待";
  assert.equal(
    compileApproval(doc(), "expense", defaultOrg(), flows).branch,
    "low",
  );
  assert.throws(
    () =>
      compileApproval(
        { ...doc(), department: "产品部" },
        "expense",
        defaultOrg(),
        flows,
      ),
    /归属/,
  );
});
test("指定审批人必须有效，所有员工的两条分支发布前均可解析", () => {
  const flows = defaultFlows();
  flows.expense.high = [{ selector: "person", personId: "head-liang" }];
  assert.equal(
    compileApproval(doc(), "expense", defaultOrg(), flows).nodes[0].actorName,
    "梁悦",
  );
  flows.request.low = [];
  assert.throws(() => validateFlows(flows, defaultOrg()), /1～4/);
  flows.request.low = [{ selector: "person", personId: "lin" }];
  assert.throws(() => validateFlows(flows, defaultOrg()), /主管/);
  const org = defaultOrg();
  org.departments[1].headId = null;
  assert.throws(() => validateFlows(defaultFlows(), org), /缺少/);
});
test("同角色不同人员不可越权，顺序审批后才能到财务，风险不能放行", () => {
  let x = doc();
  assert.equal(canApprove(x, actor("head-xu")), false);
  assert.throws(
    () => advanceApproval(x, "approve", actor("head-xu")),
    /指定审批人/,
  );
  x = advanceApproval(x, "approve", actor("manager-zhao"));
  assert.equal(x.status, "待主管审批");
  assert.equal(x.approval.cursor, 1);
  assert.throws(() => withdraw(x, "林晓", "修改"), /仅可撤回/);
  assert.throws(() => advanceApproval(x, "approve", actor("manager-zhao")));
  x = advanceApproval(x, "approve", actor("head-xu"));
  assert.equal(x.status, "待财务审核");
  assert.throws(
    () =>
      advanceApproval(
        { ...x, flags: ["重复"] },
        "approve",
        actor("finance-zhou"),
      ),
    /风险/,
  );
  x = advanceApproval(x, "approve", actor("finance-zhou"));
  assert.equal(x.status, "待付款");
  assert.doesNotThrow(() => validateSnapshot(x.approval, x.status, "expense"));
  assert.throws(
    () =>
      transition(x, "approve", "财务", "", null, { id: "other", role: "财务" }),
    /快照中的财务/,
  );
});
test("申请多级通过后才批准，驳回必填原因，原版本不随配置改变", () => {
  const x = doc("request");
  const flows = defaultFlows();
  flows.version = 2;
  flows.request.threshold = 10000;
  assert.equal(x.approval.version, 1);
  assert.equal(x.approval.nodes.length, 2);
  assert.throws(
    () => advanceApproval(x, "reject", actor("manager-zhao")),
    /原因/,
  );
  assert.equal(
    advanceApproval(x, "reject", actor("manager-zhao"), "计划需完善").status,
    "已驳回",
  );
  const first = advanceApproval(x, "approve", actor("manager-zhao"));
  assert.equal(first.status, "待审批");
  const done = advanceApproval(first, "approve", actor("head-xu"));
  assert.equal(done.status, "已批准");
  assert.equal(x.approval.cursor, 0);
  assert.doesNotThrow(() =>
    validateSnapshot(done.approval, done.status, "request"),
  );
  assert.throws(
    () => validateSnapshot(x.approval, "已批准", "request"),
    /不一致/,
  );
});
test("在途和待付款人员受保护，调整汇报不改写已提交快照", () => {
  const before = defaultOrg(),
    next = defaultOrg(),
    x = doc();
  next.people[0].managerId = "head-xu";
  assert.doesNotThrow(() => assertOrgChange(before, next, [x]));
  assert.equal(x.approval.nodes[0].actorId, "manager-zhao");
  next.people.find((p) => p.id === "manager-zhao").active = false;
  assert.throws(() => assertOrgChange(before, next, [x]), /在途/);
  const paid = doc();
  paid.approval.cursor = paid.approval.nodes.length;
  paid.status = "待付款";
  const financeOff = defaultOrg();
  financeOff.people.find((p) => p.id === "finance-zhou").active = false;
  assert.throws(() => assertOrgChange(before, financeOff, [paid]), /在途/);
  assert.doesNotThrow(() =>
    assertOrgChange(before, next, [{ ...x, status: "已退回" }]),
  );
});
