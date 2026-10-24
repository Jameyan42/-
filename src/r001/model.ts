import {
  auditLodging,
  centsToYuan,
  isGrade,
  normalizeCity,
  parseYuan,
  validateStandards,
} from "./rule";
import { createExampleStandards } from "./standards";
import type {
  AuditRecord,
  HumanReview,
  LodgingInput,
  R001State,
  StandardSnapshot,
  StandardsCatalog,
} from "./types";

export const R001_STORAGE_KEY = "qingbao-r001-v1";
export const MAX_RECORDS = 200;
function assertTimestamp(at: string): void {
  if (
    typeof at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) ||
    !Number.isFinite(Date.parse(at)) ||
    new Date(at).toISOString() !== at
  )
    throw Error("操作时间无效");
}
export function makeRecord(
  input: LodgingInput,
  standards: StandardsCatalog,
  at: string,
): AuditRecord {
  assertTimestamp(at);
  if (!input.documentId || input.documentId.length > 80)
    throw Error("单据编号无效");
  return {
    id: input.documentId,
    input: { ...input },
    automatic: auditLodging(input, standards),
    auditedAt: at,
    humanReview: null,
  };
}
export function appendRecord(state: R001State, record: AuditRecord): R001State {
  if (state.records.some((r) => r.id === record.id))
    throw Error("原始审核已留存，请复制为新单重新审核");
  if (state.records.length >= MAX_RECORDS)
    throw Error(
      `本地原型最多保存${MAX_RECORDS}笔R001记录，请勿将其作为正式财务系统`,
    );
  return { ...state, records: [record, ...state.records] };
}
export function reviewRecord(
  record: AuditRecord,
  decision: HumanReview["decision"],
  reason: string,
  reviewer: string,
  at: string,
): AuditRecord {
  if (record.automatic.status !== "review_required")
    throw Error("仅需要人工复核的单据可复核；数据错误请补充后新审");
  if (record.humanReview) throw Error("此单已完成复核，原始结果及复核记录保留");
  if (!["approved", "rejected"].includes(decision)) throw Error("复核操作无效");
  if (
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.trim().length > 500
  )
    throw Error("请填写1～500字复核原因，通过与驳回都需说明");
  if (typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 40)
    throw Error("复核人员无效");
  assertTimestamp(at);
  if (at < record.auditedAt)
    throw Error("复核时间不能早于自动审核时间，请检查设备时钟");
  return {
    ...record,
    humanReview: {
      decision,
      reason: reason.trim(),
      reviewer: reviewer.trim(),
      at,
    },
  };
}
export function replaceRecord(
  state: R001State,
  record: AuditRecord,
): R001State {
  const previous = state.records.find((r) => r.id === record.id);
  if (!previous) throw Error("单据不存在，未保存复核");
  if (previous.humanReview || !record.humanReview)
    throw Error("复核必须首次明确提交，已完成的记录不得覆盖");
  if (
    stable(previous.input) !== stable(record.input) ||
    stable(previous.automatic) !== stable(record.automatic) ||
    previous.auditedAt !== record.auditedAt
  )
    throw Error("人工复核不得覆盖原始输入、自动审核结果或审核时间");
  return {
    ...state,
    records: state.records.map((r) => (r.id === record.id ? record : r)),
  };
}
export function upsertStandard(
  state: R001State,
  cityValue: string,
  grade: string,
  nightlyYuan: string,
  id: string,
  at: string,
): R001State {
  const city = normalizeCity(cityValue),
    parsed = parseYuan(nightlyYuan);
  if (!city || city.length > 40 || !isGrade(grade))
    throw Error("请填写40字内城市并选择有效职级");
  if (!parsed.ok) throw Error(parsed.message);
  assertTimestamp(at);
  const existing = state.standards.rows.find(
    (r) => r.city === city && r.grade === grade,
  );
  if (!existing && state.standards.rows.length >= 300)
    throw Error("模拟标准最多300条");
  const row = {
    id: existing?.id || id,
    city,
    grade,
    nightlyRateCents: parsed.cents,
  };
  const standards = {
    version: state.standards.version + 1,
    updatedAt: at,
    rows: existing
      ? state.standards.rows.map((r) => (r.id === existing.id ? row : r))
      : [...state.standards.rows, row],
  };
  validateStandards(standards);
  return { ...state, standards };
}
export function t03Input(id: string): LodgingInput {
  return {
    documentId: id,
    employeeName: "张晓（虚构）",
    grade: "普通员工",
    city: "深圳",
    checkIn: "2026-10-20",
    checkOut: "2026-10-23",
    amountYuan: "1800.00",
  };
}
export function createExampleState(): R001State {
  const standards = createExampleStandards();
  return {
    schema: 1,
    standards,
    records: [
      makeRecord(
        t03Input("R001-DEMO-T03"),
        standards,
        "2026-10-24T00:00:00.000Z",
      ),
      makeRecord(
        { ...t03Input("R001-DEMO-T01"), amountYuan: "1200.00" },
        standards,
        "2026-10-24T00:00:00.000Z",
      ),
    ],
  };
}
function stable(value: unknown): string {
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
function historicalCatalog(snapshot: StandardSnapshot): StandardsCatalog {
  if (
    !snapshot ||
    typeof snapshot.matched !== "boolean" ||
    !isGrade(snapshot.grade) ||
    typeof snapshot.city !== "string" ||
    normalizeCity(snapshot.city) !== snapshot.city ||
    !snapshot.city ||
    snapshot.city.length > 40 ||
    !Number.isSafeInteger(snapshot.catalogVersion) ||
    snapshot.catalogVersion < 1
  )
    throw Error("历史标准快照无效");
  assertTimestamp(snapshot.catalogUpdatedAt);
  if (
    snapshot.matched
      ? typeof snapshot.standardId !== "string" ||
        !snapshot.standardId ||
        !Number.isSafeInteger(snapshot.nightlyRateCents) ||
        snapshot.nightlyRateCents! < 0
      : snapshot.standardId !== null || snapshot.nightlyRateCents !== null
  )
    throw Error("历史标准金额或缺失标志无效");
  const catalog = {
    version: snapshot.catalogVersion,
    updatedAt: snapshot.catalogUpdatedAt,
    rows: snapshot.matched
      ? [
          {
            id: snapshot.standardId!,
            city: snapshot.city,
            grade: snapshot.grade,
            nightlyRateCents: snapshot.nightlyRateCents!,
          },
        ]
      : [],
  };
  validateStandards(catalog);
  return catalog;
}
/** Validate against the saved policy snapshot, never against today's changed rates. */
export function validateState(value: unknown): R001State {
  const s = value as R001State;
  if (
    !s ||
    s.schema !== 1 ||
    !Array.isArray(s.records) ||
    s.records.length > MAX_RECORDS ||
    JSON.stringify(s).length > 1500000
  )
    throw Error("R001本地数据格式或容量无效");
  validateStandards(s.standards);
  const ids = new Set<string>();
  for (const r of s.records) {
    if (
      !r ||
      !r.input ||
      !r.automatic ||
      typeof r.id !== "string" ||
      !r.id ||
      r.id.length > 80 ||
      r.id !== r.input.documentId ||
      ids.has(r.id) ||
      Object.values(r.input).some((v) => typeof v !== "string") ||
      [
        "documentId",
        "employeeName",
        "grade",
        "city",
        "checkIn",
        "checkOut",
        "amountYuan",
      ].some((k) => typeof r.input[k as keyof LodgingInput] !== "string") ||
      Object.values(r.input).some(
        (v) => typeof v !== "string" || v.length > 500,
      )
    )
      throw Error("R001单据数据不完整或编号重复");
    ids.add(r.id);
    assertTimestamp(r.auditedAt);
    const catalog = r.automatic.standardSnapshot
      ? historicalCatalog(r.automatic.standardSnapshot)
      : { version: 1, updatedAt: "2026-10-24T00:00:00.000Z", rows: [] };
    const expected = auditLodging(r.input, catalog);
    if (stable(expected) !== stable(r.automatic))
      throw Error("原始自动审核结果与输入或标准快照不一致");
    if (r.humanReview !== null) {
      const h = r.humanReview;
      if (!h) throw Error("人工复核记录无效");
      const expectedReview = reviewRecord(
        { ...r, humanReview: null },
        h.decision,
        h.reason,
        h.reviewer,
        h.at,
      ).humanReview;
      if (stable(h) !== stable(expectedReview))
        throw Error("人工复核记录格式无效");
    }
  }
  return s;
}
export interface R001Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type LoadedState =
  | { ok: true; state: R001State; raw: string | null }
  | { ok: false; message: string };
export function loadState(storage: R001Storage): LoadedState {
  try {
    const raw = storage.getItem(R001_STORAGE_KEY);
    return {
      ok: true,
      raw,
      state:
        raw === null ? createExampleState() : validateState(JSON.parse(raw)),
    };
  } catch {
    return {
      ok: false,
      message:
        "R001本地数据无法读取，原值已保留。为避免覆盖，审核与修改已暂停；可使用下方按钮恢复本模块模拟数据。",
    };
  }
}
export function saveState(
  storage: R001Storage,
  state: R001State,
  expectedRaw?: string | null,
): void {
  validateState(state);
  if (
    expectedRaw !== undefined &&
    storage.getItem(R001_STORAGE_KEY) !== expectedRaw
  )
    throw Error(
      "R001数据已在其他页面更新，请刷新后重试；当前填写与其他页面记录均未覆盖",
    );
  try {
    storage.setItem(R001_STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw Error(
      "浏览器存储失败或容量不足，原记录未改动，当前填写仍保留，请重试",
    );
  }
}
export { centsToYuan };
