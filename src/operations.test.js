import test from "node:test";
import assert from "node:assert/strict";
import { enterpriseOrg, defaultOrg } from "./organization.js";
import {
  defaultFlows,
  financeDivisionFlows,
  compileApproval,
  approvalStatus,
  advanceApproval,
} from "./approval.js";
import {
  processedRows,
  processedCsv,
  validateOperation,
  validateOperationHistory,
} from "./operations.js";
import { transition } from "./domain.js";
import { requestAction } from "./requests.js";
import { validateBackup, defaultPolicy } from "./settings.js";
const org = enterpriseOrg(),
  actor = (id) => org.people.find((p) => p.id === id);
function create(kind = "expense", extended = false) {
  const doc = {
    id: "event-doc",
    name: "原始事项",
    employee: "林晓",
    department: "销售部",
    amount: 200,
    type: "差旅交通",
    date: "2026-10-23",
    month: "2026-10",
    invoice: "EVENT-001",
    receipt: "虚构.pdf",
    note: "虚构用途",
    history: [],
    flags: [],
  };
  doc.approval = compileApproval(
    doc,
    kind,
    org,
    extended ? financeDivisionFlows(defaultFlows(), org) : defaultFlows(),
  );
  doc.status = approvalStatus(doc.approval);
  return doc;
}
test("只按人员标识归属处理记录，同角色和仅具名旧文本不能冒充本人处理", () => {
  const d = advanceApproval(create(), "approve", actor("manager-zhao"));
  d.history.unshift({ text: "赵航（主管）通过", time: "2026/10/22" });
  assert.equal(processedRows([d], [], actor("manager-zhao")).length, 1);
  assert.equal(processedRows([d], [], actor("head-xu")).length, 0);
  assert.equal(
    processedRows([d], [], { ...actor("manager-zhao"), role: "管理员" }).length,
    1,
  );
  assert.equal(
    processedRows([d], [], { ...actor("manager-zhao"), active: false }).length,
    0,
  );
});
test("退回重提保留每次操作、原事项金额与轮次，不用当前字段覆盖历史", () => {
  let d = advanceApproval(
    create(),
    "reject",
    actor("manager-zhao"),
    "用途需补充",
  );
  const oldRun = d.approval.submittedAt;
  d = { ...d, name: "修改后事项", amount: 600 };
  d.approval = compileApproval(d, "expense", org, defaultFlows());
  d.approval.submittedAt = "2026-10-23T23:00:00Z";
  d.status = approvalStatus(d.approval);
  d = advanceApproval(d, "approve", actor("manager-zhao"), "确认业务用途");
  const rows = processedRows([d], [], actor("manager-zhao"));
  assert.equal(rows.length, 2);
  const reject = rows.find((r) => r.operation.action === "reject").operation;
  assert.equal(reject.summary.name, "原始事项");
  assert.equal(reject.summary.amount, 200);
  assert.equal(reject.runId, oldRun);
  assert.equal(
    rows.find((r) => r.operation.action === "approve").operation.summary.amount,
    600,
  );
  assert.equal(
    processedRows([d], [], actor("manager-zhao"), {
      result: "reject",
      query: "用途需补充",
    }).length,
    1,
  );
  assert.equal(rows[0].doc.status, "待财务审核");
  assert.equal(reject.toStatus, "已退回");
});
test("总账和付款独立留存摘要，财务审核及付款两次操作不会覆盖", () => {
  let d = create("expense", true);
  d = advanceApproval(d, "approve", actor("head-xu"));
  d = advanceApproval(d, "approve", actor("finance-zhou"));
  d = advanceApproval(d, "approve", actor("ledger-gao"), "", {
    account: "6602",
    costCenter: "销售部",
  });
  d = transition(
    d,
    "approve",
    "付款",
    "已核对",
    {
      reference: "DEMO-OP-001",
      date: "2026-10-23",
      method: "银行转账",
      confirmed: true,
    },
    actor("payer-du"),
  );
  assert.equal(
    processedRows([d], [], actor("ledger-gao"))[0].operation.accounting.account,
    "6602",
  );
  assert.equal(
    processedRows([d], [], actor("payer-du"))[0].operation.action,
    "pay",
  );
  assert.equal(
    processedRows([d], [], actor("payer-du"))[0].operation.payment.reference,
    "DEMO-OP-001",
  );
  assert.equal(processedRows([d], [], actor("finance-zhou")).length, 1);
  let old = create();
  old = advanceApproval(old, "approve", actor("manager-zhao"));
  old = advanceApproval(old, "approve", actor("finance-zhou"));
  old = transition(
    old,
    "approve",
    "财务",
    "",
    {
      reference: "DEMO-OLD-001",
      date: "2026-10-23",
      method: "银行转账",
      confirmed: true,
    },
    actor("finance-zhou"),
  );
  assert.equal(processedRows([old], [], actor("finance-zhou")).length, 2);
});
test("新旧申请处理均可记名，旧日志无操作标识不迁移，越权或失败不记成功记录", () => {
  const r = create("request");
  const original = structuredClone(r);
  assert.throws(() => advanceApproval(r, "approve", actor("head-xu")));
  assert.deepEqual(r, original);
  const done = advanceApproval(r, "approve", actor("manager-zhao"));
  assert.equal(
    processedRows([], [done], actor("manager-zhao"))[0].operation.kind,
    "request",
  );
  const legacy = { ...r };
  delete legacy.approval;
  legacy.history = [{ text: "主管通过", time: "旧记录" }];
  const processed = requestAction(
    legacy,
    "approve",
    "主管",
    "赵航",
    [],
    "",
    actor("manager-zhao"),
  );
  assert.equal(processedRows([], [processed], actor("manager-zhao")).length, 1);
  assert.equal(processed.history.at(-1).operation.flowVersion, null);
  const ledger = create("expense", true);
  const first = advanceApproval(ledger, "approve", actor("head-xu")),
    second = advanceApproval(first, "approve", actor("finance-zhou"));
  assert.throws(() => advanceApproval(second, "approve", actor("ledger-gao")));
  assert.equal(processedRows([second], [], actor("ledger-gao")).length, 0);
});
test("具名处理记录可往返备份；畸形角色、状态、时间、轮次或摘要被拒", () => {
  const d = advanceApproval(create(), "approve", actor("manager-zhao"));
  const backup = {
    format: "qingbao-backup",
    version: 1,
    items: [d],
    requests: [],
    budgets: { 销售部: 20000 },
    policy: defaultPolicy,
    audit: [],
    configuration: { org, flows: defaultFlows() },
  };
  assert.doesNotThrow(() => validateBackup(JSON.parse(JSON.stringify(backup))));
  for (const change of [
    (o) => (o.actorId = ""),
    (o) => (o.role = "财务"),
    (o) => (o.toStatus = "已付款"),
    (o) => (o.at = "昨天"),
    (o) => (o.runId = null),
    (o) => (o.summary.amount = -1),
    (o) => (o.kind = "request"),
  ]) {
    const b = structuredClone(backup);
    change(b.items[0].history[0].operation);
    assert.throws(() => validateBackup(b));
  }
  const old = { ...d, history: [{ text: "原角色处理", time: "2026/10/22" }] };
  assert.doesNotThrow(() => validateOperationHistory(old.history, "expense"));
  assert.equal(processedRows([old], [], actor("manager-zhao")).length, 0);
});
test("处理时间排序、范围筛选和导出保留原摘要并防公式注入", () => {
  let a = create("request"),
    b = { ...create("request"), id: "second" };
  a = advanceApproval(a, "approve", actor("manager-zhao"));
  b = advanceApproval(b, "reject", actor("manager-zhao"), ' =SUM(1,2) "原因"');
  a.history[0].operation.at = "2026-10-23T01:00:00Z";
  b.history[0].operation.at = "2026-10-23T02:00:00Z";
  const rows = processedRows([], [a, b], actor("manager-zhao"));
  assert.equal(rows[0].doc.id, "second");
  assert.equal(
    processedRows([], [a, b], actor("manager-zhao"), { order: "oldest" })[0].doc
      .id,
    "event-doc",
  );
  assert.equal(
    processedRows([], [a, b], actor("manager-zhao"), { kind: "expense" })
      .length,
    0,
  );
  const csv = processedCsv(rows);
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes("处理后状态"));
  assert.ok(csv.includes("'=SUM(1,2)"));
  assert.ok(csv.includes('""原因""'));
});
