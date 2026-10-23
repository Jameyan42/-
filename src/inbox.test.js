import test from "node:test";
import assert from "node:assert/strict";
import { defaultOrg } from "./organization.js";
import {
  compileApproval,
  defaultFlows,
  advanceApproval,
  approvalStatus,
} from "./approval.js";
import { inboxRows, canHandleDocument, inboxCsv } from "./inbox.js";
const actor = (id) => defaultOrg().people.find((p) => p.id === id);
function doc(kind, id, amount = 4000, at = "2026-10-23T09:00:00Z") {
  const d = {
    id,
    name: id,
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount,
    history: [],
  };
  d.approval = compileApproval(d, kind, defaultOrg(), defaultFlows());
  d.approval.submittedAt = at;
  d.status = approvalStatus(d.approval);
  return d;
}
test("统一待办汇总两类单据，同号不合并，具体人员和节点均须匹配", () => {
  const expense = doc("expense", "same"),
    request = doc("request", "same");
  assert.equal(
    inboxRows([expense], [request], actor("manager-zhao")).length,
    2,
  );
  assert.equal(inboxRows([expense], [request], actor("head-xu")).length, 0);
  const next = advanceApproval(request, "approve", actor("manager-zhao"));
  assert.equal(inboxRows([expense], [next], actor("manager-zhao")).length, 1);
  assert.equal(
    inboxRows([expense], [next], actor("head-xu"))[0].kind,
    "request",
  );
  assert.equal(
    canHandleDocument(request, "expense", actor("manager-zhao")),
    false,
  );
  assert.equal(inboxRows([expense], [request], actor("lin")).length, 0);
  assert.equal(
    inboxRows([expense], [request], { ...actor("manager-zhao"), active: false })
      .length,
    0,
  );
});
test("财务审核后仍是付款任务，终态移出，其他财务不可代办", () => {
  let d = doc("expense", "finance", 200);
  d = advanceApproval(d, "approve", actor("manager-zhao"));
  assert.equal(inboxRows([d], [], actor("finance-zhou"))[0].stage, "财务审核");
  d = advanceApproval(d, "approve", actor("finance-zhou"));
  assert.equal(inboxRows([d], [], actor("finance-zhou"))[0].stage, "付款登记");
  assert.equal(
    canHandleDocument(d, "expense", { id: "other-finance", role: "财务" }),
    false,
  );
  assert.equal(
    canHandleDocument(d, "expense", { id: "finance-zhou", role: "主管" }),
    false,
  );
  for (const status of ["已付款", "已退回", "已撤回", "草稿"])
    assert.equal(
      inboxRows([{ ...d, status }], [], actor("finance-zhou")).length,
      0,
    );
});
test("旧单据按原角色处理，不伪造提交时间；无时间记录两种排序都在最后", () => {
  const old = { id: "legacy", name: "旧单", status: "待主管审批" },
    early = doc("expense", "early", 200, "2026-10-22T09:00:00Z"),
    late = doc("request", "late");
  assert.deepEqual(
    inboxRows([old, early], [late], actor("manager-zhao")).map((r) => r.doc.id),
    ["early", "late", "legacy"],
  );
  assert.deepEqual(
    inboxRows([old, early], [late], actor("manager-zhao"), {
      order: "newest",
    }).map((r) => r.doc.id),
    ["late", "early", "legacy"],
  );
  const row = inboxRows([old], [], actor("manager-zhao"))[0];
  assert.equal(row.submittedAt, null);
  assert.equal(row.version, "历史固定流程");
  assert.equal(
    canHandleDocument(
      { ...old, status: "待付款" },
      "expense",
      actor("finance-zhou"),
    ),
    true,
  );
  assert.equal(
    canHandleDocument(
      { ...old, status: "待审批" },
      "request",
      actor("manager-zhao"),
    ),
    true,
  );
  assert.equal(
    canHandleDocument(
      { ...old, status: "已批准" },
      "request",
      actor("manager-zhao"),
    ),
    false,
  );
});
test("筛选与搜索仅作用于本人待办；排序不修改原集合", () => {
  const expense = doc("expense", "BX-AbC", 200),
    request = doc("request", "SQ-def");
  const source = [expense];
  const options = { kind: "expense", query: "  bx-abc  " };
  assert.equal(
    inboxRows(source, [request], actor("manager-zhao"), options).length,
    1,
  );
  assert.equal(
    inboxRows(source, [request], actor("manager-zhao"), {
      query: "销售部",
      kind: "request",
    }).length,
    1,
  );
  assert.equal(
    inboxRows(source, [request], actor("head-xu"), { query: "林晓" }).length,
    0,
  );
  assert.equal(source[0], expense);
  assert.equal(expense.approval.cursor, 0);
});
test("待办导出包含类型和当前节点，防止公式注入并保留引号", () => {
  const d = doc("request", "csv", 200);
  d.name = ' =SUM(1,2) "虚构"';
  const csv = inboxCsv(inboxRows([], [d], actor("manager-zhao")));
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes("费用申请"));
  assert.ok(csv.includes("赵航"));
  assert.ok(csv.includes("' =SUM(1,2)"));
  assert.ok(csv.includes('""虚构""'));
});
