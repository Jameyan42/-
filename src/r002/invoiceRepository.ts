import {
  auditInvoiceDuplicate,
  inspectInput,
  isIsoTime,
  normalizeIdentifier,
  validateHistory,
} from "./invoiceDuplicateRule";
import { createMockHistory } from "./invoiceMockData";
import type {
  AuditVersion,
  CurrentClaim,
  HistoryInvoice,
  HistoryStatus,
  HumanReview,
  InvoiceDocument,
  R002AuditResult,
  R002State,
} from "./invoiceTypes";

export const R002_STORAGE_KEY = "qingbao-r002-v1";
export const createR002State = (): R002State => ({
  schema: 1,
  revision: 1,
  library: createMockHistory(),
  documents: [],
});
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const validId = (v: unknown): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= 80;
function validateClaim(c: CurrentClaim): void {
  if (
    !c ||
    !validId(c.documentId) ||
    !validId(c.invoiceRecordId) ||
    !isIsoTime(c.submittedAt) ||
    !c.input ||
    typeof c.input !== "object" ||
    [
      "employeeName",
      "department",
      "invoiceType",
      "invoiceCode",
      "invoiceNumber",
      "issueDate",
      "sellerName",
      "sellerTaxId",
      "buyerName",
      "amountYuan",
      "remark",
    ].some(
      (k) => typeof c.input[k as keyof CurrentClaim["input"]] !== "string",
    ) ||
    Object.values(c.input).some((v) => typeof v !== "string" || v.length > 500)
  )
    throw Error("R002单据原始输入格式无效");
}
export function latestAudit(doc: InvoiceDocument): AuditVersion {
  const last = doc.audits.at(-1);
  if (!last) throw Error("单据审核版本缺失");
  return last;
}
export function boundInvoice(doc: InvoiceDocument) {
  return doc.audits.find(
    (a) => a.automatic.searchPerformed && !a.automatic.unreliableIdentifier,
  )?.automatic.currentInvoice;
}
const identity = (invoice: { type: string; code: string; number: string }) =>
  stable([
    invoice.type,
    normalizeIdentifier(invoice.code),
    normalizeIdentifier(invoice.number),
  ]);
export function historyForAudit(state: R002State): HistoryInvoice[] {
  const own: HistoryInvoice[] = state.documents.flatMap((d) => {
    const valid = [...d.audits]
      .reverse()
      .find((a) => a.automatic.searchPerformed);
    if (!valid) return [];
    return [
      {
        id: `LOCAL-${d.id}`,
        documentId: d.id,
        employeeName: valid.inputSnapshot.input.employeeName.trim(),
        department: valid.inputSnapshot.input.department.trim(),
        submittedAt: d.submittedAt,
        businessStatus: businessAfter(valid) as HistoryStatus,
        invoice: {
          ...valid.automatic.currentInvoice,
          amountCents: valid.automatic.currentInvoice.amountCents!,
        },
        updatedAt: valid.humanReview?.at || valid.automatic.at,
        sourceAuditVersion: valid.version,
      },
    ];
  });
  return [...state.library.map((r) => structuredClone(r)), ...own];
}
function businessAfter(a: AuditVersion): InvoiceDocument["businessStatus"] {
  return a.humanReview
    ? a.humanReview.decision === "approved"
      ? "已通过"
      : "已驳回"
    : ["incomplete", "invalid"].includes(a.automatic.status)
      ? "待补充"
      : "审核中";
}
export function submitAudit(
  state: R002State,
  claim: CurrentClaim,
  at: string,
  auditId: string,
  expectedVersion = 0,
): R002State {
  validateClaim(claim);
  if (!isIsoTime(at) || !validId(auditId) || at < claim.submittedAt)
    throw Error("审核编号或操作时间无效，请检查设备时钟");
  const existing = state.documents.find((d) => d.id === claim.documentId);
  const bound = existing ? boundInvoice(existing) : undefined,
    incoming = inspectInput(claim.input);
  if (
    bound &&
    !incoming.issues.length &&
    identity(bound) !== identity(incoming.invoice)
  )
    throw Error(
      "同单已绑定有效票面标识，更换类型/代码/号码请新建报销单；旧版本及原身份保留",
    );
  if ((existing?.audits.length || 0) !== expectedVersion)
    throw Error("单据版本已变化或重复提交，请重新打开当前单据，未覆盖旧版本");
  if (
    existing &&
    (existing.invoiceRecordId !== claim.invoiceRecordId ||
      existing.submittedAt !== claim.submittedAt)
  )
    throw Error("重新审核不能改变单据编号、发票记录编号或原提交时间");
  if (state.library.some((r) => r.documentId === claim.documentId))
    throw Error("报销单编号与模拟历史库冲突，请新建编号");
  if (!existing && state.documents.length >= 200)
    throw Error("本地原型最多200笔R002单据");
  if (
    existing &&
    (existing.audits.length >= 20 ||
      at < latestAudit(existing).automatic.at ||
      at < (latestAudit(existing).humanReview?.at || ""))
  )
    throw Error("审核版本最多20次，且新审核时间不能早于已有审核或复核");
  if (state.documents.some((d) => d.audits.some((a) => a.id === auditId)))
    throw Error("审核记录编号重复");
  const automatic = auditInvoiceDuplicate(claim, historyForAudit(state), {
    at,
    dataRevision: state.revision,
  });
  if (
    automatic.issues.some((i) =>
      ["history", "time", "identity"].includes(i.field),
    )
  )
    throw Error(automatic.explanation + "；请核对本地数据或设备时间");
  const audit: AuditVersion = {
    id: auditId,
    version: expectedVersion + 1,
    inputSnapshot: structuredClone(claim),
    automatic,
    humanReview: null,
  };
  const document: InvoiceDocument = {
    id: claim.documentId,
    invoiceRecordId: claim.invoiceRecordId,
    submittedAt: claim.submittedAt,
    input: structuredClone(claim.input),
    invoice: structuredClone(automatic.currentInvoice),
    businessStatus: businessAfter(audit),
    audits: [...(existing?.audits || []), audit],
  };
  return {
    ...state,
    revision: state.revision + 1,
    documents: existing
      ? state.documents.map((d) => (d.id === document.id ? document : d))
      : [document, ...state.documents],
  };
}
export function applyReview(
  state: R002State,
  documentId: string,
  auditId: string,
  decision: HumanReview["decision"],
  reason: string,
  reviewer: string,
  at: string,
): R002State {
  const doc = state.documents.find((d) => d.id === documentId);
  if (!doc) throw Error("单据不存在");
  const audit = latestAudit(doc);
  if (audit.id !== auditId)
    throw Error("只能复核最新审核版本，旧版本只读且结果保留");
  if (audit.automatic.status !== "review_required")
    throw Error("仅需要人工复核的结果可提交复核");
  if (audit.humanReview)
    throw Error("此审核版本已完成复核，不得重复提交或覆盖");
  if (!["approved", "rejected"].includes(decision)) throw Error("复核操作无效");
  if (
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.trim().length > 500
  )
    throw Error("请填写1～500字复核原因，通过与驳回均必填");
  if (
    typeof reviewer !== "string" ||
    !reviewer.trim() ||
    reviewer.trim().length > 40
  )
    throw Error("请填写40字内复核人员姓名");
  if (!isIsoTime(at) || at < audit.automatic.at)
    throw Error("复核时间无效或早于审核，请检查设备时钟");
  const nextAudit = {
    ...audit,
    humanReview: {
      decision,
      reason: reason.trim(),
      reviewer: reviewer.trim(),
      at,
    },
  };
  const nextDoc = {
    ...doc,
    businessStatus: businessAfter(nextAudit),
    audits: doc.audits.map((a) => (a.id === auditId ? nextAudit : a)),
  };
  return {
    ...state,
    revision: state.revision + 1,
    documents: state.documents.map((d) => (d.id === documentId ? nextDoc : d)),
  };
}
export function upsertHistory(
  state: R002State,
  row: HistoryInvoice,
  editingId = "",
): R002State {
  validateHistory(row);
  const old = state.library.find((r) => r.id === editingId);
  if (editingId && !old) throw Error("原模拟记录不存在，请重新载入");
  if (
    old &&
    (old.id !== row.id ||
      old.invoice.id !== row.invoice.id ||
      old.documentId !== row.documentId)
  )
    throw Error("编辑不能更改内部记录编号");
  if (!old && state.library.length >= 200) throw Error("模拟历史库最多200笔");
  if (
    state.library.some(
      (r) =>
        r.id !== editingId &&
        (r.id === row.id || r.documentId === row.documentId),
    ) ||
    state.documents.some((d) => d.id === row.documentId)
  )
    throw Error("历史记录或报销单编号重复");
  return {
    ...state,
    revision: state.revision + 1,
    library: old
      ? state.library.map((r) =>
          r.id === editingId ? structuredClone(row) : r,
        )
      : [structuredClone(row), ...state.library],
  };
}
export function restoreMockLibrary(state: R002State): R002State {
  const next = {
    ...state,
    revision: state.revision + 1,
    library: createMockHistory(),
  };
  validateR002State(next);
  return next;
}
function validateAutomatic(
  result: R002AuditResult,
  input: CurrentClaim,
  stateRevision: number,
): void {
  if (
    !result ||
    result.ruleId !== "R002" ||
    result.ruleVersion !== "v1" ||
    !isIsoTime(result.at) ||
    result.at < input.submittedAt ||
    !result.evidence ||
    !Array.isArray(result.evidence.candidates)
  )
    throw Error("审核结果或证据快照格式无效");
  const e = result.evidence;
  if (
    !Number.isSafeInteger(e.dataRevision) ||
    e.dataRevision < 1 ||
    e.dataRevision > stateRevision ||
    ![e.sourceCount, e.checkedCount, e.excludedSelfCount].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 400,
    ) ||
    e.excludedSelfCount > 1 ||
    e.candidates.length > e.checkedCount ||
    e.candidates.some(
      (r) =>
        r.documentId === input.documentId ||
        normalizeIdentifier(r.invoice.number) !==
          normalizeIdentifier(input.input.invoiceNumber),
    )
  )
    throw Error("查重证据范围、排除自身或数量无效");
  if (
    result.searchPerformed
      ? e.sourceCount !== e.checkedCount + e.excludedSelfCount
      : e.checkedCount !== 0 ||
        e.excludedSelfCount !== 0 ||
        e.candidates.length !== 0
  )
    throw Error("查重范围数量与是否执行不一致");
  const replay = auditInvoiceDuplicate(input, e.candidates, {
    at: result.at,
    dataRevision: e.dataRevision,
  });
  const expected = {
    ...replay,
    evidence: {
      ...replay.evidence,
      sourceCount: e.sourceCount,
      checkedCount: e.checkedCount,
      excludedSelfCount: e.excludedSelfCount,
    },
  };
  if (stable(expected) !== stable(result))
    throw Error("原始查重结论与输入、匹配证据或规则不一致");
}
export function validateR002State(value: unknown): R002State {
  const s = value as R002State;
  if (
    !s ||
    s.schema !== 1 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 1 ||
    !Array.isArray(s.library) ||
    s.library.length > 200 ||
    !Array.isArray(s.documents) ||
    s.documents.length > 200 ||
    JSON.stringify(s).length > 2200000
  )
    throw Error("R002本地数据格式、版本或容量无效");
  const docs = new Set<string>(),
    historyIds = new Set<string>(),
    invoiceIds = new Set<string>(),
    auditIds = new Set<string>();
  for (const row of s.library) {
    validateHistory(row);
    if (docs.has(row.documentId) || historyIds.has(row.id))
      throw Error("模拟库记录或单据编号重复");
    docs.add(row.documentId);
    historyIds.add(row.id);
  }
  for (const doc of s.documents) {
    if (
      !doc ||
      !validId(doc.id) ||
      docs.has(doc.id) ||
      !validId(doc.invoiceRecordId) ||
      invoiceIds.has(doc.invoiceRecordId) ||
      !isIsoTime(doc.submittedAt) ||
      !Array.isArray(doc.audits) ||
      doc.audits.length < 1 ||
      doc.audits.length > 20
    )
      throw Error("R002单据身份或审核版本无效");
    docs.add(doc.id);
    invoiceIds.add(doc.invoiceRecordId);
    let previousTime = doc.submittedAt;
    let boundIdentity: string | undefined;
    for (let i = 0; i < doc.audits.length; i++) {
      const a = doc.audits[i]!;
      if (!a || !validId(a.id) || auditIds.has(a.id) || a.version !== i + 1)
        throw Error("审核编号重复或版本不连续");
      auditIds.add(a.id);
      validateClaim(a.inputSnapshot);
      if (
        a.inputSnapshot.documentId !== doc.id ||
        a.inputSnapshot.invoiceRecordId !== doc.invoiceRecordId ||
        a.inputSnapshot.submittedAt !== doc.submittedAt ||
        a.automatic.at < previousTime
      )
        throw Error("审核身份或版本时间不一致");
      validateAutomatic(a.automatic, a.inputSnapshot, s.revision);
      if (a.automatic.searchPerformed) {
        if (
          boundIdentity &&
          boundIdentity !== identity(a.automatic.currentInvoice)
        )
          throw Error("同单有效票面标识被更换，旧身份不可覆盖");
        if (!boundIdentity && !a.automatic.unreliableIdentifier)
          boundIdentity = identity(a.automatic.currentInvoice);
      }
      previousTime = a.automatic.at;
      if (a.humanReview !== null) {
        const h = a.humanReview;
        if (
          !h ||
          a.automatic.status !== "review_required" ||
          !["approved", "rejected"].includes(h.decision) ||
          !h.reason ||
          h.reason.trim() !== h.reason ||
          h.reason.length > 500 ||
          !h.reviewer ||
          h.reviewer.trim() !== h.reviewer ||
          h.reviewer.length > 40 ||
          !isIsoTime(h.at) ||
          h.at < a.automatic.at
        )
          throw Error("复核记录格式、原因或时间无效");
        previousTime = h.at;
      }
    }
    const last = latestAudit(doc);
    if (
      stable(doc.input) !== stable(last.inputSnapshot.input) ||
      stable(doc.invoice) !== stable(last.automatic.currentInvoice) ||
      doc.businessStatus !== businessAfter(last)
    )
      throw Error("当前单据与最新审核版本或业务状态不一致");
  }
  return s;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type LoadedR002 =
  | { ok: true; state: R002State; raw: string | null }
  | { ok: false; message: string };
export function loadR002(storage: StorageLike): LoadedR002 {
  try {
    const raw = storage.getItem(R002_STORAGE_KEY);
    return {
      ok: true,
      state:
        raw === null ? createR002State() : validateR002State(JSON.parse(raw)),
      raw,
    };
  } catch {
    return {
      ok: false,
      message:
        "R002本地数据无法读取，原值已保留，审核/复核/修改已暂停。只有能完整保留现有单据及证据时才可恢复模拟历史库。",
    };
  }
}
export function saveR002(
  storage: StorageLike,
  state: R002State,
  expectedRaw: string | null,
): void {
  validateR002State(state);
  if (storage.getItem(R002_STORAGE_KEY) !== expectedRaw)
    throw Error("本地数据刚被其他页面更新，请重试查重或刷新；未覆盖其他记录");
  try {
    storage.setItem(R002_STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw Error("R002保存失败或容量不足，原数据未改动，填写内容保留");
  }
}
/** Re-read before local matching, then guard against intervening writes before committing. */
export function auditAndSave(
  storage: StorageLike,
  claim: CurrentClaim,
  at: string,
  auditId: string,
  expectedVersion = 0,
): R002State {
  const loaded = loadR002(storage);
  if (!loaded.ok) throw Error(loaded.message);
  const next = submitAudit(loaded.state, claim, at, auditId, expectedVersion);
  saveR002(storage, next, loaded.raw);
  return next;
}
export function reviewAndSave(
  storage: StorageLike,
  documentId: string,
  auditId: string,
  decision: HumanReview["decision"],
  reason: string,
  reviewer: string,
  at: string,
): R002State {
  const loaded = loadR002(storage);
  if (!loaded.ok) throw Error(loaded.message);
  const next = applyReview(
    loaded.state,
    documentId,
    auditId,
    decision,
    reason,
    reviewer,
    at,
  );
  saveR002(storage, next, loaded.raw);
  return next;
}
export function restoreLibraryAndSave(storage: StorageLike): R002State {
  const raw = storage.getItem(R002_STORAGE_KEY);
  let candidate: R002State;
  try {
    const existing =
      raw === null ? createR002State() : (JSON.parse(raw) as R002State);
    if (
      !Array.isArray(existing.documents) ||
      !Number.isSafeInteger(existing.revision)
    )
      throw Error();
    candidate = {
      ...existing,
      revision: existing.revision + 1,
      library: createMockHistory(),
    };
    validateR002State(candidate);
  } catch {
    throw Error(
      "无法完整保留R002单据及审核证据，未执行恢复；原值保留，请先人工处理损坏数据",
    );
  }
  saveR002(storage, candidate, raw);
  return candidate;
}
export function historyFromInput(
  claim: CurrentClaim,
  businessStatus: HistoryStatus,
  id: string,
  at: string,
): HistoryInvoice {
  validateClaim(claim);
  const check = inspectInput(claim.input);
  if (check.issues.length)
    throw Error(check.issues.map((i) => i.message).join("；"));
  const row: HistoryInvoice = {
    id,
    documentId: claim.documentId,
    employeeName: claim.input.employeeName.trim(),
    department: claim.input.department.trim(),
    submittedAt: claim.submittedAt,
    businessStatus,
    invoice: {
      ...check.invoice,
      id: claim.invoiceRecordId,
      amountCents: check.invoice.amountCents!,
    },
    updatedAt: at,
  };
  validateHistory(row);
  return row;
}
