import test from "node:test";
import assert from "node:assert/strict";
import { defaultOrg, enterpriseOrg } from "./organization.js";
import {
  compileApproval,
  defaultFlows,
  financeDivisionFlows,
} from "./approval.js";
import {
  expenseProgress,
  ownsExpense,
  progressRows,
} from "./expense-progress.js";
const org = enterpriseOrg(),
  lin = org.people.find((p) => p.id === "lin");
const doc = (extra = {}) => ({
  id: "P1",
  name: "进度测试",
  employee: "林晓",
  department: "销售部",
  type: "差旅交通",
  amount: 200,
  status: "待主管审批",
  history: [],
  ...extra,
});
const snap = (d) => ({
  ...d,
  approval: compileApproval(d, "expense", org, defaultFlows()),
});
test("快照归属只按ID，旧记录需唯一姓名和部门，停用/其他角色不可读", () => {
  const d = snap(doc());
  assert(ownsExpense(d, lin, org));
  assert(!ownsExpense(d, { ...lin, id: "other" }, org));
  assert(!ownsExpense(d, { ...lin, active: false }, org));
  assert(!ownsExpense(d, { ...lin, role: "主管" }, org));
  assert(ownsExpense(doc(), lin, org));
  assert(!ownsExpense(doc({ department: "产品部" }), lin, org));
  assert(
    !ownsExpense(doc(), lin, {
      ...org,
      people: [...org.people, { ...lin, id: "duplicate" }],
    }),
  );
  assert(ownsExpense({ ...d, employee: "历史姓名" }, lin, org));
});
test("schema1逐节点与单独付款阶段，旧数据不按组织猜姓名", () => {
  let d = snap(doc());
  let r = expenseProgress(d, org);
  assert.equal(r.actorName, "赵航");
  assert.equal(r.steps.filter((n) => n.state === "当前待处理").length, 1);
  d = {
    ...d,
    status: "待付款",
    approval: { ...d.approval, cursor: d.approval.nodes.length },
  };
  r = expenseProgress(d, org);
  assert.equal(r.actorName, "周宁");
  assert.equal(r.steps.at(-1).state, "当前待处理");
  assert(r.steps.slice(0, -1).every((n) => n.state === "已通过"));
  assert.equal(expenseProgress(doc(), org).actorName, "主管（按原角色处理）");
  assert(!expenseProgress(doc(), org).steps.length);
});
test("财务分工总账及独立付款，组织变化保留快照且提示人员不可用", () => {
  const d = doc({ employee: "叶禾", department: "法报中心" }),
    flows = financeDivisionFlows(defaultFlows(), org);
  let a = compileApproval(d, "expense", org, flows);
  let r = expenseProgress(
    { ...d, status: "待总账复核", approval: { ...a, cursor: 2 } },
    org,
  );
  assert.equal(r.actorName, "高璇");
  r = expenseProgress(
    { ...d, status: "待付款", approval: { ...a, cursor: 3 } },
    {
      ...org,
      people: org.people.filter((p) => p.id !== a.paymentActor.actorId),
    },
  );
  assert.equal(r.actorName, "杜川");
  assert.match(r.hint, /不可处理/);
  assert.equal(r.steps.at(-1).label, "付款登记");
});
test("退回理由优先结构化最新记录，草稿撤回和已付无待审人或未来节点", () => {
  let r = expenseProgress(
    doc({
      status: "已退回",
      history: [
        { text: "旧退回" },
        { text: "退回", operation: { action: "reject", note: "请补附件" } },
      ],
    }),
    org,
  );
  assert.equal(r.reason, "请补附件");
  assert.equal(r.group, "action");
  assert.deepEqual(r.steps, []);
  for (const status of ["草稿", "已撤回"])
    assert.equal(expenseProgress(doc({ status }), org).actorName, "林晓");
  r = expenseProgress(snap(doc({ status: "已付款" })), org);
  assert.equal(r.actorName, "");
  assert.match(r.hint, /不代表银行到账/);
  assert.equal(r.group, "paid");
  assert.match(
    expenseProgress(doc({ status: "已退回" }), org).reason,
    /未提供/,
  );
});
test("联合搜索、状态分组、稳定时间排序且无数据修改", () => {
  const a = snap(doc()),
    b = snap(doc({ id: "P2", name: "另一个" }));
  a.approval.submittedAt = "2026-10-21T00:00:00Z";
  b.approval.submittedAt = "2026-10-22T00:00:00Z";
  const items = [
      doc({ id: "D", status: "草稿" }),
      a,
      b,
      doc({ id: "OTHER", employee: "陈嘉", department: "产品部" }),
    ],
    before = JSON.stringify(items);
  assert.deepEqual(
    progressRows(items, lin, org).map((r) => r.doc.id),
    ["P2", "P1", "D"],
  );
  assert.equal(
    progressRows(items, lin, org, { query: "赵航", group: "active" }).length,
    2,
  );
  assert.equal(progressRows(items, lin, org, { group: "action" }).length, 1);
  assert.equal(JSON.stringify(items), before);
  assert.equal(
    progressRows(
      items,
      org.people.find((p) => p.id === "manager-zhao"),
      org,
    ).length,
    0,
  );
});
test("状态与快照矛盾、未知旧状态不猜测责任人", () => {
  const r = expenseProgress(snap(doc({ status: "待总账复核" })), org);
  assert.equal(r.stage, "无法确定节点");
  assert.equal(r.actorName, "请核对单据记录");
  assert.deepEqual(r.steps, []);
  assert.equal(
    expenseProgress(doc({ status: "未知状态" }), defaultOrg()).actorName,
    "未提供处理人",
  );
});
