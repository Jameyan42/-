import test from "node:test";
import assert from "node:assert/strict";
import { enterpriseOrg } from "./organization.js";
import {
  financeDivisionFlows,
  defaultFlows,
  compileApproval,
  approvalStatus,
} from "./approval.js";
import {
  emptyEnterprise,
  saveSupplier,
  saveContract,
  reviewContract,
  submitCorporate,
  actCorporate,
  validateEnterprise,
  persistEnterprise,
  visibleCorporate,
} from "./enterprise.js";
import { demoContractText } from "./contract-review.js";
import { inboxRows, inboxCsv, canHandleDocument } from "./inbox.js";
import {
  processedRows,
  processedCsv,
  validateOperation,
} from "./operations.js";
import {
  businessMessages,
  emptyMessageRead,
  markMessagesRead,
  filterMessages,
} from "./messages.js";
const org = enterpriseOrg(),
  who = (id) => org.people.find((p) => p.id === id),
  flows = financeDivisionFlows(defaultFlows(), org);
function setup(name = "统一工作台对公单") {
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "远帆服务有限公司（虚构）",
      accountName: "远帆服务有限公司（虚构）",
      creditCode: "DEMO-WB",
      bankName: "演示银行",
      bankAccount: "DEMO-WB-001",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "工作台测试",
      number: "HT-WB",
      amount: 10000,
      supplierId: s.suppliers[0].id,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      text: demoContractText,
    },
    who("lin"),
    org,
  );
  s = reviewContract(s, s.contracts[0].id, who("finance-zhou"), {
    approve: true,
    confirmed: true,
    note: "虚构合同人工核对",
  });
  return submitCorporate(
    s,
    {
      contractId: s.contracts[0].id,
      name,
      amount: 100,
      date: "2026-10-24",
      note: "虚构付款依据",
    },
    who("lin"),
    org,
    flows,
  );
}
const messages = (s, id, read = emptyMessageRead()) =>
  businessMessages([], [], who(id), org, read, s.payments);
const inbox = (s, id, options = {}) =>
  inboxRows([], [], who(id), { payments: s.payments, ...options });
const processed = (s, id, options = {}) =>
  processedRows([], [], who(id), { payments: s.payments, ...options });
function act(s, role, action = "approve", extra = {}) {
  return actCorporate(s, s.payments[0].id, who(role), action, {
    note: "核对虚构单据",
    ...extra,
  });
}
test("统一待办三类同号不混淆，对公只按具名节点与岗位授权", () => {
  const s = setup(),
    c = s.payments[0],
    d = { ...c, history: [] };
  const rf = structuredClone(flows);
  rf.request.low = [{ selector: "departmentHead" }];
  const r = { ...d, approval: compileApproval(d, "request", org, rf) };
  r.status = approvalStatus(r.approval);
  const rows = inboxRows([d], [r], who("head-xu"), { payments: [c] });
  assert.deepEqual(
    new Set(rows.map((r) => r.kind)),
    new Set(["expense", "request", "corporate"]),
  );
  assert.equal(inbox(s, "manager-zhao").length, 0);
  assert.equal(
    canHandleDocument(c, "corporate", { ...who("head-xu"), role: "财务" }),
    false,
  );
  assert.equal(
    canHandleDocument(c, "corporate", { ...who("head-xu"), active: false }),
    false,
  );
  assert.equal(
    canHandleDocument(
      { ...c, approval: undefined },
      "corporate",
      who("head-xu"),
    ),
    false,
  );
  for (const status of ["已付款", "已退回", "已撤回"])
    assert.equal(
      canHandleDocument({ ...c, status }, "corporate", who("head-xu")),
      false,
    );
  assert.match(inboxCsv(rows), /对公支付/);
  assert.equal(inbox(s, "head-xu", { kind: "expense" }).length, 0);
});
test("对公逐节点待办与处理记录包含独立总账/付款快照，付款后无待办", () => {
  let s = setup();
  for (const id of ["head-xu", "finance-zhou", "ledger-gao", "payer-du"]) {
    assert.equal(inbox(s, id).length, 1);
    s = act(s, id, "approve", {
      ledgerReview: { account: "6602服务费", costCenter: "销售部" },
      payment: {
        reference: "DEMO-WB-PAY",
        method: "银行转账",
        date: "2026-10-24",
        confirmed: true,
      },
    });
    assert.equal(inbox(s, id).length, 0);
    assert.equal(processed(s, id).length, 1);
    assert.equal(processed(s, id)[0].operation.kind, "corporate");
  }
  assert.equal(
    processed(s, "ledger-gao")[0].operation.accounting.account,
    "6602服务费",
  );
  assert.equal(processed(s, "ledger-gao")[0].operation.payment, undefined);
  assert.equal(processed(s, "payer-du")[0].operation.action, "pay");
  assert.equal(
    processed(s, "payer-du")[0].operation.payment.reference,
    "DEMO-WB-PAY",
  );
  assert.match(processedCsv(processed(s, "payer-du")), /对公支付/);
  assert.equal(processed(s, "manager-zhao").length, 0);
  assert.equal(messages(s, "lin")[0].title, "对公支付单已完成模拟付款登记");
});
test("对公退回重提保留长事项和原金额，旧具名文本不补造成处理快照", () => {
  let s = setup("原".repeat(100));
  s = act(s, "head-xu", "reject", { note: "补验收材料" });
  const before = structuredClone(processed(s, "head-xu")[0].operation);
  s = submitCorporate(
    s,
    {
      contractId: s.contracts[0].id,
      name: "修改后",
      amount: 200,
      date: "2026-10-24",
      note: "补资料",
    },
    who("lin"),
    org,
    flows,
    s.payments[0].id,
  );
  s = act(s, "head-xu");
  const rows = processed(s, "head-xu");
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.find((r) => r.operation.action === "reject").operation,
    before,
  );
  assert.equal(
    rows.find((r) => r.operation.action === "approve").operation.summary.amount,
    200,
  );
  assert.equal(
    processed(s, "head-xu", { result: "reject", query: "补验收" }).length,
    1,
  );
  for (const h of s.payments[0].history) delete h.operation;
  assert.doesNotThrow(() => validateEnterprise(s));
  assert.equal(processed(s, "head-xu").length, 0);
});
test("对公消息按创建人ID及人员归属，三类同号的已读标识互相独立", () => {
  let s = setup(),
    d = { ...s.payments[0], history: [] };
  const all = businessMessages(
    [d],
    [],
    who("head-xu"),
    org,
    emptyMessageRead(),
    s.payments,
  );
  assert.equal(all.length, 2);
  const read = markMessagesRead(emptyMessageRead(), "head-xu", [
    all.find((r) => r.kind === "corporate").key,
  ]);
  const after = businessMessages(
    [d],
    [],
    who("head-xu"),
    org,
    read,
    s.payments,
  );
  assert.equal(after.find((r) => r.kind === "expense").unread, true);
  assert.equal(after.find((r) => r.kind === "corporate").unread, false);
  assert.equal(
    filterMessages(after, { kind: "corporate", unread: "unread" }).length,
    0,
  );
  assert.equal(inbox(s, "head-xu").length, 1); // Read state never advances business.
  s = act(s, "head-xu", "reject", { note: "补验收材料" });
  const own = messages(s, "lin")[0];
  assert.equal(own.reason, "补验收材料");
  assert.equal(own.time, s.payments[0].history.at(-1).at);
  const other = { ...s.payments[0], createdBy: "other", employee: "林晓" };
  assert.equal(
    businessMessages([], [], who("lin"), org, emptyMessageRead(), [other])
      .length,
    0,
  );
  assert.equal(messages(s, "manager-zhao").length, 0);
  const old = structuredClone(s);
  delete old.payments[0].history.at(-1).operation;
  assert.equal(messages(old, "lin")[0].reason, "补验收材料");
});
test("已读后对公退回重提和新节点产生新提示，撤回提示不冒充审批记录", () => {
  let s = setup();
  const initial = messages(s, "head-xu")[0];
  const read = markMessagesRead(emptyMessageRead(), "head-xu", [initial.key]);
  assert.equal(messages(s, "head-xu", read)[0].unread, false);
  s = act(s, "head-xu", "reject", { note: "补材料" });
  s = submitCorporate(
    s,
    {
      contractId: s.contracts[0].id,
      name: "重提",
      amount: 100,
      date: "2026-10-24",
      note: "虚构",
    },
    who("lin"),
    org,
    flows,
    s.payments[0].id,
  );
  assert.equal(messages(s, "head-xu", read)[0].unread, true);
  assert.notEqual(messages(s, "head-xu", read)[0].key, initial.key);
  s = act(s, "lin", "withdraw", { note: "主动修正" });
  assert.equal(messages(s, "lin")[0].doc.status, "已撤回");
  assert.equal(processed(s, "lin").length, 0);
});
test("对公操作类型/流转外壳篡改拒绝，处理生成和保存失败不改原值", () => {
  const s = setup(),
    original = JSON.stringify(s),
    next = act(s, "head-xu");
  assert.equal(JSON.stringify(s), original);
  const bad = structuredClone(next);
  bad.payments[0].history.at(-1).operation.kind = "expense";
  assert.throws(() => validateEnterprise(bad), /具名/);
  const envelope = structuredClone(next);
  envelope.payments[0].history.at(-1).actorId = "other";
  assert.throws(() => validateEnterprise(envelope), /不一致/);
  const operation = structuredClone(next.payments[0].history.at(-1).operation);
  operation.toStatus = "已付款";
  assert.throws(() => validateOperation(operation, "corporate"), /流转/);
  let stored = original;
  assert.throws(
    () =>
      persistEnterprise(
        {
          setItem() {
            throw Error("quota");
          },
        },
        next,
      ),
    /原数据未改动/,
  );
  assert.equal(stored, original);
  assert.equal(JSON.stringify(s), original);
});

test("重提更换审批路径后，原具名处理人可只读回看当前单据，不能再处理", () => {
  let s = act(setup(), "head-xu", "reject", { note: "补充材料" });
  const nextFlows = structuredClone(flows);
  nextFlows.version++;
  nextFlows.expense.low = [{ selector: "person", personId: "manager-zhao" }];
  s = submitCorporate(
    s,
    {
      name: "改路径后重提",
      amount: 100,
      contractId: s.contracts[0].id,
      date: "2026-10-24",
      note: "虚构变更",
    },
    who("lin"),
    org,
    nextFlows,
    s.payments[0].id,
  );
  assert.equal(visibleCorporate(s.payments[0], who("head-xu")), true);
  assert.equal(processed(s, "head-xu").length, 1);
  assert.equal(inbox(s, "head-xu").length, 0);
  assert.equal(inbox(s, "manager-zhao").length, 1);
  assert.equal(visibleCorporate(s.payments[0], who("head-shen")), false);
});
