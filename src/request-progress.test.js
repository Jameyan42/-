import test from "node:test";
import assert from "node:assert/strict";
import { defaultOrg } from "./organization.js";
import { compileApproval, defaultFlows } from "./approval.js";
import {
  requestProgress,
  requestProgressRows,
  requestProgressCsv,
} from "./request-progress.js";
import { requestBalance } from "./requests.js";
const org = defaultOrg(),
  actor = org.people.find((p) => p.id === "lin");
const req = (extra = {}) => ({
  id: "R",
  name: "申请",
  employee: "林晓",
  department: "销售部",
  type: "差旅交通",
  amount: 1000,
  month: "2026-10",
  status: "已批准",
  history: [],
  ...extra,
});
const expense = (status, amount = 100) => ({
  id: status,
  requestId: "R",
  name: status,
  employee: "林晓",
  department: "销售部",
  type: "差旅交通",
  status,
  amount,
});
test("申请本人归属优先ID，旧姓名部门及身份歧义保护", () => {
  const r = req();
  r.approval = compileApproval(r, "request", org, defaultFlows());
  assert.equal(requestProgressRows([r], [], actor, org).length, 1);
  assert.equal(
    requestProgressRows([r], [], { ...actor, id: "x" }, org).length,
    0,
  );
  assert.equal(
    requestProgressRows([req({ department: "产品部" })], [], actor, org).length,
    0,
  );
  assert.equal(
    requestProgressRows([req()], [], { ...actor, role: "主管" }, org).length,
    0,
  );
  assert.equal(
    requestProgressRows([req()], [], { ...actor, active: false }, org).length,
    0,
  );
  assert.equal(
    requestProgressRows([req()], [], actor, {
      ...org,
      people: [...org.people, { ...actor, id: "duplicate" }],
    }).length,
    0,
  );
});
test("分币额度、在途/已付分开，草稿退回撤回不占用且原预算口径一致", () => {
  const items = [
    expense("待主管审批", 0.1),
    expense("已付款", 0.2),
    expense("草稿", 100),
    expense("已退回", 100),
    expense("已撤回", 100),
  ];
  const r = requestProgress(req(), items, actor, org);
  assert.equal(r.used, 0.3);
  assert.equal(r.paid, 0.2);
  assert.equal(r.inFlight, 0.1);
  assert.equal(r.remaining, 999.7);
  assert.equal(r.available, 999.7);
  assert.equal(r.reserved, 999.7);
  assert.equal(r.linked.length, 5);
  assert.equal(requestBalance(req(), items).used, r.used);
  assert.match(r.hint, /不能结束/);
});
test("待审批/驳回/关闭不能关联且不预留，关闭未使用不等于可用", () => {
  for (const status of ["待审批", "已驳回", "已关闭"]) {
    const r = requestProgress(req({ status }), [], actor, org);
    assert.equal(r.remaining, 1000);
    assert.equal(r.available, 0);
    assert.equal(r.reserved, 0);
  }
  const r = requestProgress(
    req({ status: "已关闭" }),
    [expense("已付款", 600)],
    actor,
    org,
  );
  assert.equal(r.remaining, 400);
  assert.equal(r.available, 0);
  assert.match(r.hint, /不能再关联/);
});
test("路径随提交快照，旧角色与停用及异常节点不猜人", () => {
  const d = req({ status: "待审批" });
  d.approval = compileApproval(d, "request", org, defaultFlows());
  const r = requestProgress(d, [], actor, org);
  assert.equal(r.actorName, "赵航");
  assert.equal(r.steps[0].state, "当前待处理");
  const changed = {
    ...org,
    people: org.people.map((p) =>
      p.id === "manager-zhao" ? { ...p, active: false, name: "新名字" } : p,
    ),
  };
  assert.equal(requestProgress(d, [], actor, changed).actorName, "赵航");
  assert.match(requestProgress(d, [], actor, changed).hint, /不可处理/);
  assert.match(
    requestProgress(req({ status: "待审批" }), [], actor, org).actorName,
    /按原角色/,
  );
  const bad = { ...d, approval: { ...d.approval, cursor: 1 } };
  assert.equal(requestProgress(bad, [], actor, org).actorName, "");
  assert.equal(requestProgress(bad, [], actor, org).stage, "无法确定节点");
});
test("关联仅显示本人，驳回说明优先结构化新记录", () => {
  const r = requestProgress(
    req({
      status: "已驳回",
      history: [
        { text: "旧驳回" },
        { text: "驳回", operation: { action: "reject", note: "请明确用途" } },
      ],
    }),
    [
      expense("草稿"),
      {
        ...expense("待付款"),
        id: "other",
        employee: "陈嘉",
        department: "产品部",
      },
    ],
    actor,
    org,
  );
  assert.equal(r.reason, "请明确用途");
  assert.equal(r.linked.length, 1);
  assert.equal(r.used, 0);
  assert.match(
    requestProgress(req({ status: "已驳回" }), [], actor, org).hint,
    /另行申请/,
  );
});
test("联合状态月份目的地审批人搜索、稳定排序与只读不变", () => {
  const a = req({ id: "A", status: "待审批" });
  a.approval = compileApproval(a, "request", org, defaultFlows());
  a.approval.submittedAt = "2026-10-20T00:00:00Z";
  const b = req({
    id: "B",
    status: "待审批",
    trip: { origin: "杭州", destination: "上海" },
  });
  b.approval = {
    ...structuredClone(a.approval),
    submittedAt: "2026-10-21T00:00:00Z",
  };
  const rs = [a, b, req({ id: "OLD" }), req({ id: "NOV", month: "2026-11" })],
    before = JSON.stringify(rs);
  assert.deepEqual(
    requestProgressRows(rs, [], actor, org).map((r) => r.request.id),
    ["B", "A", "NOV", "OLD"],
  );
  assert.equal(
    requestProgressRows(rs, [], actor, org, {
      status: "待审批",
      month: "2026-10",
      query: "上海",
    }).length,
    1,
  );
  assert.equal(
    requestProgressRows(rs, [], actor, org, { query: "赵航" }).length,
    2,
  );
  assert.equal(JSON.stringify(rs), before);
});
test("CSV全量筛选附口径且防公式，数字不把原额度重复当预留", () => {
  const rs = requestProgressRows(
    [req({ name: " =HYPERLINK(1)", status: "已关闭" })],
    [expense("已付款", 600)],
    actor,
    org,
  );
  const csv = requestProgressCsv(rs, {
    status: "已关闭",
    month: "2026-10",
    query: "HYPERLINK",
  });
  assert.match(csv, /已占用额度/);
  assert.match(csv, /' =HYPERLINK/);
  assert.match(csv, /当前预留预算/);
  assert.match(csv, /'已关闭'|"已关闭"/);
  assert.equal(rs[0].available, 0);
  assert.equal(rs[0].paid, 600);
  assert(csv.includes("HYPERLINK"));
});
