import test from "node:test";
import assert from "node:assert/strict";
import {
  auditInvoiceDuplicate,
  normalizeIdentifier,
} from "./invoiceDuplicateRule";
import { createMockHistory, exampleClaim, t02Input } from "./invoiceMockData";
import {
  applyReview,
  auditAndSave,
  createR002State,
  historyForAudit,
  historyFromInput,
  latestAudit,
  loadR002,
  restoreLibraryAndSave,
  restoreMockLibrary,
  R002_STORAGE_KEY,
  saveR002,
  submitAudit,
  upsertHistory,
  validateR002State,
} from "./invoiceRepository";
import type {
  CurrentClaim,
  HistoryInvoice,
  InvoiceInput,
  R002State,
} from "./invoiceTypes";
import { auditLodging } from "../r001/rule";
import { createExampleStandards } from "../r001/standards";
import { t03Input } from "../r001/model";

const at = "2026-10-24T02:00:00.000Z",
  later = "2026-10-24T03:00:00.000Z",
  last = "2026-10-24T04:00:00.000Z";
const claim = (
  changes: Partial<InvoiceInput> = {},
  documentId = "BX-R002-TEST",
): CurrentClaim => ({
  ...exampleClaim(),
  documentId,
  invoiceRecordId: `INV-${documentId}`,
  input: { ...t02Input(), ...changes },
});
const check = (c: CurrentClaim, history = createMockHistory()) =>
  auditInvoiceDuplicate(c, history, { at, dataRevision: 1 });
const audit = (state = createR002State(), c = claim()) =>
  submitAudit(state, c, at, "AUD-R002-001");
const mapStorage = (raw: string | null = null) => {
  const values = new Map<string, string>();
  if (raw !== null) values.set(R002_STORAGE_KEY, raw);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

test("T01 新发票无历史匹配，通过", () => {
  const r = check(claim({ invoiceNumber: "90000001", amountYuan: "500.00" }));
  assert.equal(r.status, "passed");
  assert.equal(r.matchCount, 0);
  assert.equal(r.searchPerformed, true);
});
test("T02 已通过的代码号码一致，人工复核并展示BX-H001", () => {
  const r = check(claim());
  assert.equal(r.status, "review_required");
  assert.equal(r.exactCount, 1);
  assert.equal(r.matches[0]!.historical.documentId, "BX-H001");
  assert.match(r.matches[0]!.statusExplanation, /已通过/);
  assert.equal(r.matches[0]!.strategy, "R002-01");
});
test("T03 审核中历史一致，人工复核", () => {
  const r = check(
    claim({
      invoiceNumber: "55667788",
      invoiceCode: "044001900555",
      amountYuan: "650.00",
      issueDate: "2026-10-05",
      sellerName: "模拟销售方5",
    }),
  );
  assert.equal(r.status, "review_required");
  assert.match(r.matches[0]!.statusExplanation, /待处理/);
});
test("T04 已驳回不能自动通过，需确认是否允许重提", () => {
  const r = check(
    claim({
      invoiceType: "纸质发票",
      invoiceNumber: "11223344",
      invoiceCode: "044001900333",
      amountYuan: "300.00",
      issueDate: "2026-10-03",
      sellerName: "模拟销售方3",
    }),
  );
  assert.equal(r.status, "review_required");
  assert.match(r.matches[0]!.statusExplanation, /已驳回.*重新提交/);
});
test("T05 同号不同代码且同为完整传统发票，不精确判重", () => {
  const r = check(claim({ invoiceCode: "044001900999" }));
  assert.equal(r.status, "passed");
  assert.equal(r.exactCount, 0);
  assert.equal(r.matchCount, 0);
});
test("T06 代码相同号码不同，无其他匹配则通过", () => {
  assert.equal(check(claim({ invoiceNumber: "90000002" })).status, "passed");
});
test("T07 仅金额相同但票面标识不同不判重", () => {
  assert.equal(
    check(
      claim({
        invoiceCode: "044001999999",
        invoiceNumber: "90000003",
        amountYuan: "500.00",
      }),
    ).status,
    "passed",
  );
});
test("T08 无代码数电号码相同，人工复核R002-02", () => {
  const r = check(
    claim({
      invoiceType: "数电发票",
      invoiceCode: "",
      invoiceNumber: "23456789012345678901",
      amountYuan: "1200.00",
      issueDate: "2026-10-04",
      sellerName: "模拟销售方4",
    }),
  );
  assert.equal(r.status, "review_required");
  assert.equal(r.matches[0]!.strategy, "R002-02");
  assert.equal(r.currentInvoice.number, "23456789012345678901");
});
test("T09 无代码数电号码不同，通过", () => {
  assert.equal(
    check(
      claim({
        invoiceType: "数电发票",
        invoiceCode: "",
        invoiceNumber: "00000000000000000009",
      }),
    ).status,
    "passed",
  );
});
test("T10 发票号码为空，待补充且不执行查重", () => {
  const r = check(claim({ invoiceNumber: "" }));
  assert.equal(r.status, "incomplete");
  assert.equal(r.searchPerformed, false);
  assert.ok(r.issues.some((i) => i.field === "invoiceNumber"));
});
test("T11 负金额是数据错误，不执行查重", () => {
  const r = check(claim({ amountYuan: "-1" }));
  assert.equal(r.status, "invalid");
  assert.equal(r.currentInvoice.amountCents, null);
  assert.equal(r.searchPerformed, false);
});
test("T12 金额0即使无匹配也转人工，不能当作重复或正常通过", () => {
  const r = check(claim({ invoiceNumber: "90000012", amountYuan: "0" }));
  assert.equal(r.status, "review_required");
  assert.equal(r.zeroAmount, true);
  assert.equal(r.matchCount, 0);
  assert.match(r.explanation, /金额为0/);
});
test("T13 同单重审排除自身，但其他单据引用相同发票记录仍能命中", () => {
  const c = claim(),
    own = {
      ...createMockHistory()[0]!,
      documentId: c.documentId,
      id: "OWN",
      invoice: { ...createMockHistory()[0]!.invoice, id: c.invoiceRecordId },
    };
  const r = check(c, [own]);
  assert.equal(r.status, "passed");
  assert.equal(r.evidence.excludedSelfCount, 1);
  const other = { ...own, id: "OTHER", documentId: "BX-OTHER" };
  assert.equal(check(c, [own, other]).matchCount, 1);
});
test("T14 返回所有状态的全部匹配历史，不只第一笔；撤回也需复核", () => {
  const histories = (["已通过", "审核中", "已驳回", "已撤回"] as const).map(
    (businessStatus, i) => ({
      ...createMockHistory()[0]!,
      id: `MATCH-${i}`,
      documentId: `BX-MATCH-${i}`,
      businessStatus,
    }),
  );
  const r = check(claim(), histories);
  assert.equal(r.matchCount, 4);
  assert.equal(r.matches.length, 4);
  assert.match(r.matches[3]!.statusExplanation, /已撤回.*重新提交/);
});
test("T15 20位号码及代码前导零保留，全半角和首尾空格规范后匹配", () => {
  const number = "00123456789012345678",
    wide = number.replace(/\d/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) + 65248),
    );
  assert.equal(number.length, 20);
  const h = {
    ...createMockHistory()[3]!,
    id: "LEADING",
    documentId: "BX-LEADING",
    invoice: { ...createMockHistory()[3]!.invoice, number },
  };
  const r = check(
    claim({
      invoiceType: "数电发票",
      invoiceCode: "",
      invoiceNumber: `  ${wide}  `,
    }),
    [h],
  );
  assert.equal(r.exactCount, 1);
  assert.equal(r.currentInvoice.number, number);
  assert.equal(r.matches[0]!.historical.invoice.number, number);
  assert.equal(
    normalizeIdentifier(" ０４４００１９００１１１ "),
    "044001900111",
  );
});
test("T16 100.01元精确存成10001分", () => {
  const s = audit(createR002State(), claim({ amountYuan: "100.01" }));
  assert.equal(s.documents[0]!.invoice.amountCents, 10001);
  validateR002State(s);
});
test("T17 100.001元报错，不静默舍入", () => {
  const r = check(claim({ amountYuan: "100.001" }));
  assert.equal(r.status, "invalid");
  assert.equal(r.currentInvoice.amountCents, null);
});
test("T18 自动后人工通过，保留原结论和证据，业务状态独立更新", () => {
  const initial = audit(),
    before = JSON.stringify(initial.documents[0]!.audits[0]!.automatic);
  const next = applyReview(
    initial,
    claim().documentId,
    "AUD-R002-001",
    "approved",
    "虚构例外经核对批准",
    "周宁",
    later,
  );
  assert.equal(JSON.stringify(next.documents[0]!.audits[0]!.automatic), before);
  assert.equal(next.documents[0]!.businessStatus, "已通过");
  assert.equal(
    next.documents[0]!.audits[0]!.automatic.status,
    "review_required",
  );
  validateR002State(next);
});
test("T19 自动后人工驳回，保留原结论和原输入", () => {
  const initial = audit(),
    before = JSON.stringify(initial.documents[0]!.audits[0]!.inputSnapshot);
  const next = applyReview(
    initial,
    claim().documentId,
    "AUD-R002-001",
    "rejected",
    "确认属于重复提交，退回处理",
    "周宁",
    later,
  );
  assert.equal(
    JSON.stringify(next.documents[0]!.audits[0]!.inputSnapshot),
    before,
  );
  assert.equal(
    next.documents[0]!.audits[0]!.automatic.status,
    "review_required",
  );
  assert.equal(next.documents[0]!.businessStatus, "已驳回");
  validateR002State(next);
});
test("T20 修改模拟历史后新审用新数据，旧证据仍是原代码和原状态", () => {
  let s = audit();
  const old = JSON.stringify(s.documents[0]!.audits[0]);
  const row = s.library[0]!;
  s = upsertHistory(
    s,
    {
      ...row,
      invoice: { ...row.invoice, code: "044001999999" },
      businessStatus: "已撤回",
      updatedAt: later,
    },
    row.id,
  );
  s = submitAudit(s, claim(), last, "AUD-R002-002", 1);
  assert.equal(latestAudit(s.documents[0]!).automatic.status, "passed");
  assert.equal(JSON.stringify(s.documents[0]!.audits[0]), old);
  assert.equal(
    s.documents[0]!.audits[0]!.automatic.matches[0]!.historical.businessStatus,
    "已通过",
  );
  validateR002State(s);
});
test("T21 重新读取保留单据及复核，种子不覆盖用户修改", () => {
  const storage = mapStorage();
  let s = audit();
  s = applyReview(
    s,
    claim().documentId,
    "AUD-R002-001",
    "rejected",
    "核对后驳回",
    "周宁",
    later,
  );
  s = upsertHistory(
    s,
    { ...s.library[0]!, employeeName: "已修改模拟姓名", updatedAt: last },
    s.library[0]!.id,
  );
  saveR002(storage, s, null);
  const loaded = loadR002(storage);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.state.library[0]!.employeeName, "已修改模拟姓名");
    assert.equal(
      loaded.state.documents[0]!.audits[0]!.humanReview?.decision,
      "rejected",
    );
  }
});
test("T22 无代码传统发票待补充，不按号码冒充查重通过", () => {
  for (const invoiceType of [
    "纸质发票",
    "增值税电子普通发票",
    "增值税电子专用发票",
  ]) {
    const r = check(claim({ invoiceType, invoiceCode: "" }));
    assert.equal(r.status, "incomplete");
    assert.equal(r.searchPerformed, false);
    assert.ok(r.issues.some((i) => i.field === "invoiceCode"));
  }
});
test("T23 同号类型不同且代码缺失，提示潜在冲突而非精确重复", () => {
  const r = check(claim({ invoiceType: "数电发票", invoiceCode: "" }));
  assert.equal(r.status, "review_required");
  assert.equal(r.exactCount, 0);
  assert.equal(r.potentialCount, 1);
  assert.equal(r.matches[0]!.strategy, "R002-03");
});
test("T24 复核原因为空或人员为空均禁止", () => {
  assert.throws(
    () =>
      applyReview(
        audit(),
        claim().documentId,
        "AUD-R002-001",
        "approved",
        "  ",
        "周宁",
        later,
      ),
    /复核原因/,
  );
  assert.throws(
    () =>
      applyReview(
        audit(),
        claim().documentId,
        "AUD-R002-001",
        "rejected",
        "说明",
        "",
        later,
      ),
    /人员姓名/,
  );
});
test("T25 已完成的同一审核版本禁止重复复核", () => {
  const s = applyReview(
    audit(),
    claim().documentId,
    "AUD-R002-001",
    "approved",
    "经核对批准",
    "周宁",
    later,
  );
  assert.throws(
    () =>
      applyReview(
        s,
        claim().documentId,
        "AUD-R002-001",
        "rejected",
        "想改原结论",
        "周宁",
        last,
      ),
    /不得重复/,
  );
});
test("T26 无效开票日期数据错误", () => {
  for (const issueDate of ["2026-02-30", "1900-02-29", "2026-13-01"]) {
    const r = check(claim({ issueDate }));
    assert.equal(r.status, "invalid");
    assert.equal(r.searchPerformed, false);
  }
});
test("T27 0.01元保存为1分", () => {
  const s = audit(createR002State(), claim({ amountYuan: "0.01" }));
  assert.equal(s.documents[0]!.invoice.amountCents, 1);
  validateR002State(s);
});
test("T28 恢复只替换模拟库，不删R001、R002单据及既有证据", () => {
  const s = applyReview(
      audit(),
      claim().documentId,
      "AUD-R002-001",
      "rejected",
      "驳回重复",
      "周宁",
      later,
    ),
    storage = mapStorage(JSON.stringify(s));
  storage.values.set("qingbao-r001-v1", "R001-EXISTING");
  const before = JSON.stringify(s.documents);
  const restored = restoreLibraryAndSave(storage);
  assert.equal(JSON.stringify(restored.documents), before);
  assert.equal(storage.values.get("qingbao-r001-v1"), "R001-EXISTING");
  assert.equal(restored.library.length, 5);
});
test("T29 R001原住宿3晚1800限额1500超300回归不变", () => {
  const r = auditLodging(t03Input("R001-REGRESSION"), createExampleStandards());
  assert.equal(r.status, "review_required");
  assert.equal(r.limitCents, 150000);
  assert.equal(r.excessCents, 30000);
});
test("T30 重审新版本保留旧自动与人工结论，旧版本只读", () => {
  const first = applyReview(
      audit(),
      claim().documentId,
      "AUD-R002-001",
      "rejected",
      "重复发票驳回",
      "周宁",
      later,
    ),
    old = JSON.stringify(first.documents[0]!.audits[0]);
  const second = submitAudit(first, claim(), last, "AUD-R002-002", 1);
  assert.equal(second.documents[0]!.audits.length, 2);
  assert.equal(JSON.stringify(second.documents[0]!.audits[0]), old);
  assert.throws(
    () =>
      applyReview(
        second,
        claim().documentId,
        "AUD-R002-001",
        "approved",
        "修改旧版本",
        "周宁",
        last,
      ),
    /旧版本只读/,
  );
  validateR002State(second);
});

test("保存前读取最新本地历史再查重，而非用页面打开时的旧历史", () => {
  const storage = mapStorage(),
    first = loadR002(storage);
  assert.ok(first.ok);
  const extra = historyFromInput(
    claim({ invoiceNumber: "90009999" }, "BX-ADDED"),
    "审核中",
    "H-ADDED",
    at,
  );
  const changed = upsertHistory(createR002State(), extra);
  saveR002(storage, changed, null);
  const saved = auditAndSave(
    storage,
    claim({ invoiceNumber: "90009999" }, "BX-NEW"),
    later,
    "AUD-FRESH",
  );
  assert.equal(saved.documents[0]!.audits[0]!.automatic.matchCount, 1);
  assert.equal(
    saved.documents[0]!.audits[0]!.automatic.matches[0]!.historical.documentId,
    "BX-ADDED",
  );
});
test("纯函数不改输入历史，代码全角数字保留前导零，金额不是匹配条件", () => {
  const c = claim({
      invoiceCode: " ０４４００１９００１１１ ",
      invoiceNumber: " １２３４５６７８ ",
      amountYuan: "100.01",
    }),
    hist = createMockHistory(),
    before = JSON.stringify([c, hist]);
  Object.freeze(c);
  Object.freeze(hist);
  const r = check(c, hist);
  assert.equal(r.exactCount, 1);
  assert.equal(r.currentInvoice.code, "044001900111");
  assert.equal(r.currentInvoice.amountCents, 10001);
  assert.equal(JSON.stringify([c, hist]), before);
});
test("其他无代码标识不可靠须人工，即使没有命中；科学计数法和金额越界报错", () => {
  const r = check(
    claim({ invoiceType: "其他", invoiceCode: "", invoiceNumber: "99909999" }),
  );
  assert.equal(r.status, "review_required");
  assert.equal(r.unreliableIdentifier, true);
  assert.equal(r.matchCount, 0);
  for (const amountYuan of ["1e3", "90071992547409.92", "500,00"]) {
    assert.equal(check(claim({ amountYuan })).status, "invalid");
  }
});
test("旧页面写入冲突、配额失败和坏JSON不覆盖原数据，损坏库恢复保留证据", () => {
  const s = audit(),
    raw = JSON.stringify(s),
    storage = mapStorage(raw);
  const next = applyReview(
    s,
    claim().documentId,
    "AUD-R002-001",
    "approved",
    "通过说明",
    "周宁",
    later,
  );
  storage.values.set(R002_STORAGE_KEY, JSON.stringify(next));
  assert.throws(() => saveR002(storage, s, raw), /其他页面更新/);
  assert.equal(storage.getItem(R002_STORAGE_KEY), JSON.stringify(next));
  const quota = {
    getItem: () => raw,
    setItem: () => {
      throw Error("quota");
    },
  };
  assert.throws(() => saveR002(quota, next, raw), /填写内容保留/);
  const bad = mapStorage("{bad");
  assert.equal(loadR002(bad).ok, false);
  assert.throws(() => restoreLibraryAndSave(bad), /未执行恢复/);
  assert.equal(bad.getItem(R002_STORAGE_KEY), "{bad");
  const broken = structuredClone(s) as unknown as { library: unknown };
  broken.library = "broken";
  const recover = mapStorage(JSON.stringify(broken));
  assert.equal(
    JSON.stringify(restoreLibraryAndSave(recover).documents),
    JSON.stringify(s.documents),
  );
});

test("重审数据错误不能让此前有效发票从历史消失，同单更换已绑定标识必须新建", () => {
  const c = claim({ invoiceNumber: "90000017" }),
    base = historyFromInput(
      claim({ invoiceNumber: "90000017" }, "BX-BASE"),
      "已通过",
      "BASE",
      at,
    );
  let s = submitAudit(
    { ...createR002State(), library: [base] },
    c,
    at,
    "AUD-KEEP-1",
  );
  s = applyReview(
    s,
    c.documentId,
    "AUD-KEEP-1",
    "approved",
    "历史重复例外经核对批准",
    "周宁",
    later,
  );
  s = restoreMockLibrary(s);
  s = submitAudit(
    s,
    { ...c, input: { ...c.input, amountYuan: "-1" } },
    last,
    "AUD-KEEP-2",
    1,
  );
  assert.equal(s.documents[0]!.businessStatus, "待补充");
  const validHistory = historyForAudit(s).find(
    (h) => h.documentId === c.documentId,
  )!;
  assert.equal(validHistory.businessStatus, "已通过");
  assert.equal(validHistory.sourceAuditVersion, 1);
  const other = claim({ invoiceNumber: "90000017" }, "BX-NEW-REPEAT");
  const checked = check(other, historyForAudit(s));
  assert.equal(checked.matchCount, 1);
  assert.equal(checked.matches[0]!.historical.documentId, c.documentId);
  assert.throws(
    () =>
      submitAudit(
        s,
        { ...c, input: { ...c.input, invoiceNumber: "90000999" } },
        last,
        "AUD-REPLACE",
        2,
      ),
    /更换.*请新建/,
  );
  validateR002State(s);
});
