import test from "node:test";
import assert from "node:assert/strict";
import {
  businessMessages,
  emptyMessageRead,
  markMessagesRead,
  validateMessageRead,
  filterMessages,
} from "./messages.js";
import { defaultOrg } from "./organization.js";
import { compileApproval, defaultFlows } from "./approval.js";
import { validateBackup, defaultPolicy } from "./settings.js";
const org = defaultOrg(),
  employee = org.people.find((p) => p.id === "lin"),
  manager = org.people.find((p) => p.id === "manager-zhao");
const doc = (extra = {}) => ({
  id: "X",
  name: "消息报销",
  employee: "林晓",
  department: "销售部",
  type: "差旅交通",
  amount: 200,
  date: "2026-10-23",
  status: "待主管审批",
  receipt: "虚构.pdf",
  invoice: "M",
  note: "用途",
  history: [],
  ...extra,
});
function submitted(extra = {}) {
  const d = doc(extra);
  return { ...d, approval: compileApproval(d, "expense", org, defaultFlows()) };
}
test("具名待办仅当前处理人，旧记录按原角色，员工只看本人结果", () => {
  const d = submitted();
  assert.equal(businessMessages([d], [], manager, org).length, 1);
  assert.equal(
    businessMessages(
      [d],
      [],
      org.people.find((p) => p.id === "head-xu"),
      org,
    ).length,
    0,
  );
  assert.equal(businessMessages([d], [], employee, org).length, 0);
  assert.equal(
    businessMessages(
      [doc()],
      [],
      org.people.find((p) => p.id === "head-xu"),
      org,
    ).length,
    1,
  );
  assert.equal(
    businessMessages(
      [doc({ status: "已付款", employee: "陈嘉", department: "产品部" })],
      [],
      employee,
      org,
    ).length,
    0,
  );
  assert.equal(
    businessMessages([d], [], { ...manager, active: false }, org).length,
    0,
  );
});
test("员工退回/付款与申请结果，未知时间不猜，原因取结构化元数据", () => {
  const rows = businessMessages(
    [
      doc({
        status: "已退回",
        history: [
          {
            text: "退回",
            time: "本地时间",
            operation: {
              action: "reject",
              note: "补充酒店水单",
              at: "2026-10-23T00:00:00Z",
            },
          },
        ],
      }),
      doc({ id: "P", status: "已付款" }),
    ],
    [doc({ id: "R", status: "已驳回" })],
    employee,
    org,
  );
  const pending = submitted({ status: "待付款" });
  pending.approval.cursor = pending.approval.nodes.length;
  assert.equal(
    businessMessages(
      [pending],
      [],
      org.people.find((p) => p.id === "finance-zhou"),
      org,
    )[0].stage,
    "付款登记",
  );
  assert.equal(rows.length, 3);
  assert(rows.some((r) => r.reason === "补充酒店水单"));
  assert.equal(rows.find((r) => r.doc.id === "P").time, null);
  assert.match(rows.find((r) => r.doc.id === "P").hint, /不代表银行到账/);
});
test("已读仅作用指定人且不改业务数据，稳定渲染不重复生成", () => {
  const d = submitted(),
    before = JSON.stringify(d),
    r = businessMessages([d], [], manager, org)[0];
  const state = markMessagesRead(emptyMessageRead(), manager.id, [r.key]);
  assert.equal(businessMessages([d], [], manager, org, state)[0].unread, false);
  assert.equal(businessMessages([d], [], manager, org, state)[0].key, r.key);
  assert.equal(JSON.stringify(d), before);
  const legacy = doc();
  const key = businessMessages([legacy], [], manager, org)[0].key;
  const s = markMessagesRead(state, manager.id, [key]);
  assert(
    businessMessages(
      [legacy],
      [],
      org.people.find((p) => p.id === "head-xu"),
      org,
      s,
    )[0].unread,
  );
});
test("节点完成旧待办消失，退回重提和付款新状态产生新未读", () => {
  const d = submitted(),
    r = businessMessages([d], [], manager, org)[0],
    state = markMessagesRead(emptyMessageRead(), manager.id, [r.key]);
  const advanced = {
    ...d,
    status: "待财务审核",
    approval: { ...d.approval, cursor: 1 },
  };
  assert.equal(businessMessages([advanced], [], manager, org, state).length, 0);
  const again = {
    ...d,
    approval: { ...d.approval, submittedAt: "2026-10-24T00:00:00Z" },
  };
  assert(businessMessages([again], [], manager, org, state)[0].unread);
  const waiting = doc({ status: "待付款" }),
    e = businessMessages([waiting], [], employee, org)[0],
    s = markMessagesRead(emptyMessageRead(), employee.id, [e.key]);
  assert(
    businessMessages(
      [{ ...waiting, status: "已付款" }],
      [],
      employee,
      org,
      s,
    )[0].unread,
  );
});
test("已读结构大小及重复校验、危险键为自有属性不污染原型", () => {
  for (const s of [
    {},
    null,
    { schema: 1, byActor: [] },
    { schema: 1, byActor: { lin: ["X", "X"] } },
    { schema: 1, byActor: { lin: ["x".repeat(1001)] } },
  ])
    assert.throws(() => validateMessageRead(s));
  assert.throws(() => markMessagesRead(emptyMessageRead(), "lin", "X"));
  const s = markMessagesRead(emptyMessageRead(), "__proto__", ["X"]);
  assert(Object.hasOwn(s.byActor, "__proto__"));
  assert.equal({}.X, undefined);
  assert.deepEqual(emptyMessageRead().byActor, {});
});
test("联合类别未读搜索和批量标记可覆盖全部匹配结果", () => {
  const docs = Array.from({ length: 25 }, (_, i) =>
      doc({ id: "X" + i, status: "已退回" }),
    ),
    all = businessMessages(docs, [], employee, org);
  assert.equal(
    filterMessages(all, { type: "update", unread: "unread", query: "消息" })
      .length,
    25,
  );
  const s = markMessagesRead(
    emptyMessageRead(),
    employee.id,
    all.map((r) => r.key),
  );
  assert.equal(
    filterMessages(businessMessages(docs, [], employee, org, s), {
      unread: "unread",
    }).length,
    0,
  );
  assert.equal(filterMessages(all, { type: "todo" }).length, 0);
});
test("消息已读随新备份往返，旧备份可导入，坏状态拒绝", () => {
  const b = {
    format: "qingbao-backup",
    version: 1,
    items: [doc()],
    budgets: { 销售部: 1000, 产品部: 1000, 运营部: 1000 },
    policy: { ...defaultPolicy },
    audit: [],
    messageRead: markMessagesRead(emptyMessageRead(), "lin", ["X"]),
  };
  assert.deepEqual(validateBackup(structuredClone(b)), b);
  const bad = structuredClone(b);
  bad.messageRead.schema = 2;
  assert.throws(() => validateBackup(bad));
  delete b.messageRead;
  assert.doesNotThrow(() => validateBackup(b));
});
