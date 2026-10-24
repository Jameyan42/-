import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRiskReview,
  riskReviewRows,
  validateRiskReviews,
  riskReviewCsv,
} from "./risk-reviews.js";
import { defaultOrg } from "./organization.js";
import { compileApproval, defaultFlows, advanceApproval } from "./approval.js";
import {
  evaluatePrecheck,
  assertPrecheck,
  basePolicy,
  defaultPrecheck,
} from "./precheck.js";
import { persistExpenseItems } from "./attachments.js";
import { businessMessages, emptyMessageRead } from "./messages.js";
import { validateBackup, defaultPolicy } from "./settings.js";
const org = defaultOrg(),
  actor = (id) => org.people.find((p) => p.id === id);
function expense() {
  const d = {
    id: "RISK-DOC",
    name: "虚构风险核对",
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 200,
    date: "2026-10-24",
    invoice: "12345678901234567890",
    receipt: "仅文件名.pdf",
    note: "虚构用途",
    history: [],
  };
  d.approval = compileApproval(d, "expense", org, defaultFlows());
  d.status = "待主管审批";
  return d;
}
const policy = { ...basePolicy, precheck: defaultPrecheck() };
const check = (d, p = policy) =>
  evaluatePrecheck("expense", d, { items: [d] }, p, "2026-10-24T00:00:00Z");
const input = (extra = {}) => ({
  ruleId: "expense-file",
  decision: "已核对",
  note: "已查看当前票据名称，仍需补充原文件",
  ...extra,
});
const file = (text = "aaa") => {
  const raw = Buffer.from("%PDF-1.4\n" + text);
  return {
    id: "FILE",
    name: "证明.pdf",
    kind: "其他材料",
    type: "application/pdf",
    size: raw.length,
    data: "data:application/pdf;base64," + raw.toString("base64"),
  };
};
test("具名核对独立追加，保留规则/材料快照，不改变审批和消息事件", async () => {
  const d = expense();
  d.attachments = [file()];
  const original = JSON.stringify(d),
    before = businessMessages(
      [d],
      [],
      actor("manager-zhao"),
      org,
      emptyMessageRead(),
    );
  const next = await appendRiskReview(
    d,
    "expense",
    actor("manager-zhao"),
    check(d),
    input({ evidenceId: "FILE" }),
  );
  assert.equal(JSON.stringify(d), original);
  assert.equal(next.riskReviews.length, 1);
  assert.equal(next.status, d.status);
  assert.deepEqual(next.history, d.history);
  assert.equal(next.approval.cursor, 0);
  assert.equal(next.riskReviews[0].report.findings.length, 1);
  assert.equal(next.riskReviews[0].evidence[0].name, "证明.pdf");
  assert.equal(
    (await riskReviewRows(next, "expense", check(next)))[0].current,
    true,
  );
  assert.equal(
    businessMessages(
      [next],
      [],
      actor("manager-zhao"),
      org,
      emptyMessageRead(),
    )[0].key,
    before[0].key,
  );
});
test("只允许当前指定节点，未知风险/材料/坏说明及旧检查拒绝", async () => {
  const d = expense();
  for (const who of [
    actor("lin"),
    actor("head-xu"),
    { ...actor("manager-zhao"), active: false },
  ])
    await assert.rejects(
      appendRiskReview(d, "expense", who, check(d), input()),
      /指定/,
    );
  for (const extra of [
    { ruleId: "invoice-buyer" },
    { evidenceId: "missing" },
    { decision: "忽略拦截" },
    { note: "短" },
  ])
    await assert.rejects(
      appendRiskReview(
        d,
        "expense",
        actor("manager-zhao"),
        check(d),
        input(extra),
      ),
    );
  const changed = { ...d, amount: 201 };
  await assert.rejects(
    appendRiskReview(
      changed,
      "expense",
      actor("manager-zhao"),
      check(d),
      input(),
    ),
    /不一致/,
  );
});
test("规则时钟不影响有效性，正常节点推进保留依据，多项核对追加不覆盖", async () => {
  let d = expense();
  d = await appendRiskReview(
    d,
    "expense",
    actor("manager-zhao"),
    check(d),
    input(),
  );
  d = advanceApproval(d, "approve", actor("manager-zhao"), "业务用途核对");
  assert.equal((await riskReviewRows(d, "expense", check(d)))[0].current, true);
  const later = check(d);
  later.at = "2026-10-24T01:00:00Z";
  assert.equal((await riskReviewRows(d, "expense", later))[0].current, true);
  d = await appendRiskReview(
    d,
    "expense",
    actor("finance-zhou"),
    later,
    input({ decision: "待补充", note: "财务仍需申请人补充原件后重新核对" }),
  );
  assert.equal(d.riskReviews.length, 2);
  assert.equal(d.riskReviews[0].decision, "已核对");
  assert.equal(d.riskReviews[1].decision, "待补充");
});
test("金额、原文件内容、规则配置或重提变化后旧核对失效，不按同名原件猜测", async () => {
  let d = expense();
  d.attachments = [file("aaa")];
  d = await appendRiskReview(
    d,
    "expense",
    actor("manager-zhao"),
    check(d),
    input({ evidenceId: "FILE" }),
  );
  const different = { ...d, attachments: [file("bbb")] };
  assert.equal(
    (await riskReviewRows(different, "expense", check(different)))[0].current,
    false,
  );
  const removed = { ...d, attachments: [] };
  assert.equal(
    (await riskReviewRows(removed, "expense", check(removed)))[0].current,
    false,
  );
  const edited = { ...d, amount: 201 };
  assert.equal(
    (await riskReviewRows(edited, "expense", check(edited)))[0].current,
    false,
  );
  const p = structuredClone(policy);
  p.precheck.version++;
  assert.equal(
    (await riskReviewRows(d, "expense", check(d, p)))[0].current,
    false,
  );
  const resubmitted = structuredClone(d);
  resubmitted.approval.submittedAt = "2026-10-24T02:00:00Z";
  assert.equal(
    (await riskReviewRows(resubmitted, "expense", check(resubmitted)))[0]
      .current,
    false,
  );
  const disabled = structuredClone(policy);
  disabled.precheck.rules.find((r) => r.id === "expense-file").enabled = false;
  const row = (await riskReviewRows(d, "expense", check(d, disabled)))[0];
  assert.equal(row.active, false);
  assert.equal(row.current, false);
});
test("已核对或建议退回均不改变原有拦截，不代替审批动作", async () => {
  const p = structuredClone(policy);
  p.precheck.rules.find((r) => r.id === "expense-file").effect = "block";
  let d = expense();
  d = await appendRiskReview(
    d,
    "expense",
    actor("manager-zhao"),
    check(d, p),
    input(),
  );
  d = advanceApproval(d, "approve", actor("manager-zhao"));
  assert.throws(() => assertPrecheck(check(d, p), d.status), /不能通过/);
  d = await appendRiskReview(
    d,
    "expense",
    actor("finance-zhou"),
    check(d, p),
    input({ decision: "建议退回", note: "需退回申请人补充真实用途说明" }),
  );
  assert.equal(d.status, "待财务审核");
  assert.throws(() => assertPrecheck(check(d, p), d.status), /不能通过/);
});
test("核对格式/类型/重复ID和容量校验，存储失败保持原值", async () => {
  const d = await appendRiskReview(
    expense(),
    "expense",
    actor("manager-zhao"),
    check(expense()),
    input(),
  );
  assert.throws(() => validateRiskReviews(d.riskReviews, "corporate", d.id));
  assert.throws(() =>
    validateRiskReviews([d.riskReviews[0], d.riskReviews[0]], "expense", d.id),
  );
  const bad = structuredClone(d.riskReviews);
  bad[0].basis = "bad";
  assert.throws(() => validateRiskReviews(bad, "expense", d.id));
  assert.throws(
    () =>
      validateRiskReviews(
        Array.from({ length: 101 }, (_, i) => ({
          ...d.riskReviews[0],
          id: String(i),
        })),
        "expense",
        d.id,
      ),
    /100/,
  );
  let raw = "old";
  const storage = {
    setItem() {
      throw Error("quota");
    },
    getItem() {
      return raw;
    },
  };
  assert.throws(() => persistExpenseItems(storage, [d]), /原报销未改动/);
  assert.equal(storage.getItem(), "old");
  const forged = structuredClone(d);
  forged.riskReviews[0].ruleId = "other";
  assert.throws(() => persistExpenseItems(storage, [forged]), /快照不一致/);
});
test("新旧备份兼容核对记录，CSV输出包含依据和失效状态且防公式", async () => {
  let d = expense();
  d = await appendRiskReview(
    d,
    "expense",
    actor("manager-zhao"),
    check(d),
    input({ note: "=HYPERLINK(虚构公式不可执行)" }),
  );
  const b = {
    format: "qingbao-backup",
    version: 1,
    items: [structuredClone(d)],
    budgets: { 销售部: 1000, 产品部: 1000, 运营部: 1000 },
    policy: { ...defaultPolicy },
    audit: [],
  };
  assert.doesNotThrow(() => validateBackup(structuredClone(b)));
  delete b.items[0].riskReviews;
  assert.doesNotThrow(() => validateBackup(b));
  const rows = await riskReviewRows(d, "expense", check(d)),
    csv = riskReviewCsv(rows);
  assert.match(csv, /当前依据一致/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /赵航/);
  const p = structuredClone(policy);
  p.precheck.version++;
  assert.match(
    riskReviewCsv(await riskReviewRows(d, "expense", check(d, p))),
    /需重新核对/,
  );
});
