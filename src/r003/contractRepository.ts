import type { State, Application, Version } from "./contractTypes";
import {
  auditContractPayment,
  validateContract,
  validatePayment,
} from "./contractPaymentRule";
import { createState } from "./contractMockData";
export const KEY = "qingbao-r003-v1";
export function validate(s: State): void {
  if (
    !s ||
    s.schema !== 1 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 1 ||
    ![s.contracts, s.payments, s.documents].every(Array.isArray)
  )
    throw Error("R003数据结构错误，原值保留");
  for (const rows of [s.contracts, s.payments, s.documents])
    if (
      rows.length > 200 ||
      new Set(rows.map((x) => x.id)).size !== rows.length
    )
      throw Error("编号重复或超过200笔容量");
  s.contracts.forEach(validateContract);
  s.payments.forEach((p) => validatePayment(p, s.contracts));
  for (const d of s.documents) {
    if (
      !d.id ||
      !Array.isArray(d.audits) ||
      !d.audits.length ||
      d.audits.length > 20
    )
      throw Error("审核版本无效");
    for (const [i, v] of d.audits.entries()) {
      const a = v.automatic;
      if (v.version !== i + 1 || !v.id || a?.snapshot?.application?.id !== d.id)
        throw Error("审核身份错误");
      const replay = auditContractPayment(
        a.snapshot.application,
        a.snapshot.contract ? [a.snapshot.contract] : [],
        a.snapshot.payments,
        a.baselineDate,
        a.at,
      );
      if (JSON.stringify(replay) !== JSON.stringify(a))
        throw Error("审核证据与结果不一致");
      const h = v.humanReview;
      if (
        h !== null &&
        (!h?.reason?.trim() ||
          !h.reviewer?.trim() ||
          !["approved", "rejected"].includes(h.decision) ||
          a.status !== "review_required" ||
          !Number.isFinite(Date.parse(h.at)))
      )
        throw Error("复核记录错误");
    }
    if (
      JSON.stringify(d.input) !==
      JSON.stringify(d.audits.at(-1)!.automatic.snapshot.application)
    )
      throw Error("单据版本不一致");
  }
}
export function append(
  s: State,
  input: Application,
  date: string,
  at: string,
  id: string,
): State {
  const old = s.documents.find((d) => d.id === input.id);
  if ((old?.audits.length || 0) >= 20) throw Error("最多20个版本");
  const automatic = auditContractPayment(
    input,
    s.contracts,
    s.payments,
    date,
    at,
  );
  const audit: Version = {
    id,
    version: (old?.audits.length || 0) + 1,
    automatic,
    humanReview: null,
  };
  return {
    ...s,
    revision: s.revision + 1,
    documents: [
      {
        id: input.id,
        input: structuredClone(input),
        audits: [...(old?.audits || []), audit],
      },
      ...s.documents.filter((d) => d.id !== input.id),
    ],
  };
}
export function review(
  s: State,
  documentId: string,
  versionId: string,
  decision: "approved" | "rejected",
  reason: string,
  reviewer: string,
  at: string,
): State {
  const next = structuredClone(s),
    d = next.documents.find((d) => d.id === documentId),
    v = d?.audits.at(-1);
  if (
    !v ||
    v.id !== versionId ||
    v.humanReview ||
    v.automatic.status !== "review_required"
  )
    throw Error("只能处理最新且尚未复核的风险版本");
  if (
    !reason.trim() ||
    reason.length > 500 ||
    !reviewer.trim() ||
    reviewer.length > 40 ||
    !["approved", "rejected"].includes(decision) ||
    !Number.isFinite(Date.parse(at)) ||
    at < v.automatic.at
  )
    throw Error("请填写复核人员、原因及有效操作时间");
  v.humanReview = {
    decision,
    reason: reason.trim(),
    reviewer: reviewer.trim(),
    at,
  };
  next.revision++;
  return next;
}
export function load(
  storage: Storage,
  date: string,
): { state: State; raw: string | null } {
  const raw = storage.getItem(KEY);
  const state = raw === null ? createState(date) : (JSON.parse(raw) as State);
  validate(state);
  return { state, raw };
}
export function save(storage: Storage, state: State, raw: string | null): void {
  validate(state);
  const text = JSON.stringify(state);
  if (text.length > 2200000) throw Error("R003容量不足，未删除证据");
  if (storage.getItem(KEY) !== raw) throw Error("其他页面已更新，请刷新后重试");
  try {
    storage.setItem(KEY, text);
  } catch {
    throw Error("本地保存失败，原数据及输入保留");
  }
}
export function restore(s: State, date: string): State {
  const seed = createState(date);
  return {
    ...s,
    revision: s.revision + 1,
    contracts: seed.contracts,
    payments: seed.payments,
  };
}
