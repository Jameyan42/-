import test from "node:test";
import assert from "node:assert/strict";
import {
  enterpriseOrg,
  defaultOrg,
  addFinanceOrganization,
  assertOrgChange,
} from "./organization.js";
import {
  defaultFlows,
  financeDivisionFlows,
  compileApproval,
  approvalStatus,
  advanceApproval,
  validateSnapshot,
  validateFlows,
} from "./approval.js";
import { transition } from "./domain.js";
import { canHandleDocument } from "./inbox.js";
import { chartTree, chartLayout } from "./org-chart.js";
import { paymentRows } from "./payment-ui.js";
const org = () => enterpriseOrg();
const actor = (id) => org().people.find((p) => p.id === id);
function create() {
  const d = {
    id: "new-expense",
    name: "虚构新流程",
    employee: "叶禾",
    department: "法报中心",
    type: "差旅交通",
    amount: 200,
    history: [],
    flags: [],
  };
  d.approval = compileApproval(
    d,
    "expense",
    org(),
    financeDivisionFlows(defaultFlows(), org()),
  );
  d.status = approvalStatus(d.approval);
  return d;
}
test("CFO 示例组织不覆盖已有关系，新安装可提供单根 CFO 汇报树", () => {
  const before = defaultOrg(),
    added = addFinanceOrganization(before);
  assert.equal(before.people.length, 10);
  for (const p of before.people)
    assert.deepEqual(
      added.people.find((x) => x.id === p.id),
      p,
    );
  assert.equal(org().people.filter((p) => p.managerId === null).length, 1);
  assert.equal(org().people.find((p) => p.managerId === null).title, "CFO");
  assert.throws(() => addFinanceOrganization(added), /存在|冲突/);
});
test("图形树布局含 CFO 和四部门总，折叠不修改源组织", () => {
  const o = org(),
    trees = chartTree(o, "reports"),
    layout = chartLayout(trees);
  assert.equal(trees[0].id, "cfo-lu");
  assert.ok(layout.edges.length > 10);
  assert.equal(layout.nodes.filter((n) => n.subtitle === "部门总").length, 4);
  assert.equal(chartLayout(trees, new Set(["person:cfo-lu"])).nodes.length, 1);
  for (const n of layout.nodes) {
    assert.ok(n.x >= 0);
    assert.ok(n.x + 208 <= layout.width);
  }
  assert.equal(o.people.length, 21);
});
test("新快照依次为部门总、财务、总账，付款独立分工，旧默认仍为 schema1", () => {
  const d = create();
  assert.equal(d.approval.schema, 2);
  assert.deepEqual(
    d.approval.nodes.map((n) => n.stage),
    ["business", "finance", "ledger"],
  );
  assert.equal(d.approval.nodes[0].actorId, "head-reporting");
  assert.equal(d.approval.paymentActor.actorId, "payer-du");
  assert.doesNotThrow(() => validateSnapshot(d.approval, d.status, "expense"));
  const old = compileApproval(
    { ...d, employee: "林晓", department: "销售部" },
    "expense",
    defaultOrg(),
    defaultFlows(),
  );
  assert.equal(old.schema, 1);
  assert.equal(old.paymentActor, undefined);
  const invalid = financeDivisionFlows(defaultFlows(), org());
  invalid.payerId = "finance-zhou";
  assert.throws(() => validateFlows(invalid, org()), /付款/);
});
test("总账必填科目与归属，财务不能越权付款，付款后责任人列表保留已付款", () => {
  let d = create();
  d = advanceApproval(d, "approve", actor("head-reporting"));
  d = advanceApproval(d, "approve", actor("finance-zhou"));
  assert.equal(d.status, "待总账复核");
  assert.equal(canHandleDocument(d, "expense", actor("finance-zhou")), false);
  assert.equal(paymentRows([d], actor("payer-du")).length, 0);
  assert.throws(
    () => advanceApproval(d, "approve", actor("ledger-gao")),
    /科目/,
  );
  assert.throws(
    () =>
      advanceApproval(
        { ...d, flags: ["重复"] },
        "approve",
        actor("ledger-gao"),
        "",
        { account: "6602", costCenter: "法报中心" },
      ),
    /风险/,
  );
  d = advanceApproval(d, "approve", actor("ledger-gao"), "", {
    account: "6602",
    costCenter: "法报中心",
  });
  assert.equal(d.status, "待付款");
  assert.equal(d.ledgerReview.reviewedBy, "ledger-gao");
  assert.equal(canHandleDocument(d, "expense", actor("finance-zhou")), false);
  assert.equal(canHandleDocument(d, "expense", actor("payer-du")), true);
  assert.throws(
    () => transition(d, "approve", "财务", "", null, actor("finance-zhou")),
    /快照/,
  );
  d = transition(
    d,
    "approve",
    "付款",
    "",
    {
      reference: "DEMO-PAY",
      method: "银行转账",
      date: "2026-10-23",
      confirmed: true,
    },
    actor("payer-du"),
  );
  assert.equal(d.status, "已付款");
  assert.equal(paymentRows([d], actor("payer-du"), "已付款").length, 1);
  assert.equal(paymentRows([d], actor("finance-zhou"), "全部").length, 0);
  assert.doesNotThrow(() => validateSnapshot(d.approval, d.status, "expense"));
});
test("保护未来付款人，拒绝非法或缺失财务尾节点和自付快照", () => {
  const d = create(),
    next = org();
  next.people.find((p) => p.id === "payer-du").active = false;
  assert.throws(() => assertOrgChange(org(), next, [d]), /在途/);
  for (const change of [
    (a) => delete a.paymentActor,
    (a) => (a.paymentActor.actorId = a.applicantId),
    (a) => a.nodes.pop(),
    (a) => a.nodes.reverse(),
  ]) {
    const a = structuredClone(d.approval);
    change(a);
    assert.throws(() => validateSnapshot(a, d.status, "expense"));
  }
  const returned = advanceApproval(
    d,
    "reject",
    actor("head-reporting"),
    "用途需补充",
  );
  assert.equal(returned.status, "已退回");
});
test("新快照与会计信息备份校验一致，不能缺失或冒用总账复核信息", async () => {
  const { validateBackup, defaultPolicy } = await import("./settings.js");
  let d = create();
  d = {
    ...d,
    date: "2026-10-23",
    note: "虚构事项",
    invoice: "BACKUP-FIN-001",
    receipt: "虚构票据.pdf",
  };
  d = advanceApproval(d, "approve", actor("head-reporting"));
  d = advanceApproval(d, "approve", actor("finance-zhou"));
  d = advanceApproval(d, "approve", actor("ledger-gao"), "", {
    account: "6602",
    costCenter: "法报中心",
  });
  const backup = {
    format: "qingbao-backup",
    version: 1,
    items: [d],
    requests: [],
    budgets: { 法报中心: 0 },
    audit: [],
    policy: defaultPolicy,
    configuration: {
      org: org(),
      flows: financeDivisionFlows(defaultFlows(), org()),
    },
  };
  assert.doesNotThrow(() => validateBackup(backup));
  const invalid = structuredClone(backup);
  delete invalid.items[0].ledgerReview;
  assert.throws(() => validateBackup(invalid), /总账复核记录缺失/);
  invalid.items[0].ledgerReview = {
    ...d.ledgerReview,
    reviewedBy: "finance-zhou",
  };
  assert.throws(() => validateBackup(invalid), /总账记录/);
});
