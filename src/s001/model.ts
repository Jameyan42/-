import type { State, Input, Claim, Batch, Context } from "./types";
import { auditAll, historyRow, registry } from "./rules";
export const KEY = "qingbao-s001-v1";
export const empty = (): State => ({ schema: 1, revision: 1, claims: [] });
export function current(d: Claim) {
  return d.batches.find(
    (b) => b.id === d.currentBatchId && b.revision === d.revision,
  );
}
export function business(batch: Batch): string {
  if (batch.review)
    return batch.review.decision === "approved" ? "已通过" : "已驳回";
  if (batch.results.some((r) => r.status === "ERROR")) return "审核失败";
  if (
    batch.results.some((r) =>
      ["REVIEW", "BLOCK", "INSUFFICIENT_DATA"].includes(r.status),
    )
  )
    return "待人工复核";
  return "规则检查通过（待财务确认）";
}
function validTime(at: string) {
  return (
    typeof at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) &&
    Number.isFinite(Date.parse(at)) &&
    new Date(at).toISOString() === at
  );
}
function checkInput(d: Input) {
  const fields = [
    "id",
    "employee",
    "grade",
    "department",
    "expenseType",
    "amountYuan",
    "currency",
    "city",
    "checkIn",
    "checkOut",
    "hotel",
    "hotelAmountYuan",
    "partialReason",
  ] as const;
  if (
    !d ||
    fields.some((k) => typeof d[k] !== "string" || d[k].length > 500) ||
    !d.id.trim() ||
    d.id.length > 80 ||
    !["住宿费", "其他费用"].includes(d.expenseType) ||
    !Array.isArray(d.invoices) ||
    d.invoices.length > 5 ||
    new Set(d.invoices.map((i) => i.id)).size !== d.invoices.length
  )
    throw Error("报销输入数据无效");
  for (const i of d.invoices) {
    if (
      [
        "id",
        "type",
        "code",
        "number",
        "amountYuan",
        "currency",
        "date",
        "sellerName",
        "buyerName",
        "sellerTaxId",
        "buyerTaxId",
      ].some(
        (k) =>
          typeof i[k as keyof typeof i] !== "string" ||
          String(i[k as keyof typeof i]).length > 500,
      ) ||
      !i.id ||
      !["manual", "ocr-assisted"].includes(i.source)
    )
      throw Error("票面字段或录入来源无效");
  }
}
export function validate(s: State) {
  if (
    !s ||
    s.schema !== 1 ||
    !Number.isSafeInteger(s.revision) ||
    !Array.isArray(s.claims) ||
    s.claims.length > 200 ||
    new Set(s.claims.map((d) => d.id)).size !== s.claims.length
  )
    throw Error("统一报销数据损坏，原值保留");
  const batchIds = new Set<string>();
  for (const d of s.claims) {
    checkInput(d.input);
    if (!validTime(d.createdAt)) throw Error("创建时间无效");
    if (
      d.id !== d.input?.id ||
      !Number.isInteger(d.revision) ||
      !Array.isArray(d.input.invoices) ||
      d.input.invoices.length > 5 ||
      new Set(d.input.invoices.map((i) => i.id)).size !==
        d.input.invoices.length ||
      !Array.isArray(d.batches) ||
      d.batches.length > 30
    )
      throw Error("单据数据不完整");
    for (const [i, b] of d.batches.entries()) {
      if (
        !Array.isArray(b.ruleKeys) ||
        new Set(b.ruleKeys).size !== b.ruleKeys.length ||
        ["lodging.limit", "invoice.duplicate", "invoice.amount-support"].some(
          (k) => !b.ruleKeys.includes(k),
        ) ||
        b.ruleKeys.some((k) => !registry.some((r) => r.ruleKey === k))
      )
        throw Error("历史规则集合无效或需要兼容版本");
      checkInput(b.input);
      if (!validTime(b.at)) throw Error("审核时间无效");
      if (
        batchIds.has(b.id) ||
        b.version !== i + 1 ||
        b.input.id !== d.id ||
        b.revision > d.revision ||
        JSON.stringify(
          auditAll(
            b.input,
            { at: b.at, ...b.context },
            registry.filter((r) => b.ruleKeys.includes(r.ruleKey)),
          ),
        ) !== JSON.stringify(b.results)
      )
        throw Error("审核快照或批次无效");
      batchIds.add(b.id);
      if (
        b.review &&
        (!b.review.reason.trim() ||
          !b.review.reviewer.trim() ||
          b.review.at < b.at ||
          !["approved", "rejected"].includes(b.review.decision) ||
          (b.review.decision === "approved" &&
            b.results.some((r) =>
              ["BLOCK", "ERROR", "INSUFFICIENT_DATA"].includes(r.status),
            )))
      )
        throw Error("复核无效");
    }
    const b = current(d);
    if ((d.currentBatchId && !b) || d.status !== (b ? business(b) : "草稿"))
      throw Error("当前审核状态无效");
  }
}
export function saveDraft(s: State, input: Input, at: string): State {
  checkInput(input);
  if (!validTime(at)) throw Error("时间无效");
  const old = s.claims.find((d) => d.id === input.id);
  if (!input.id || input.invoices.length > 5) throw Error("单号或发票数量无效");
  const changed = !old || JSON.stringify(old.input) !== JSON.stringify(input);
  const d: Claim = {
    id: input.id,
    createdAt: old?.createdAt || at,
    submittedAt: old?.submittedAt || null,
    revision: (old?.revision || 0) + (changed ? 1 : 0),
    input: structuredClone(input),
    batches: old?.batches || [],
    currentBatchId: changed ? null : old!.currentBatchId,
    status: changed ? "草稿" : old!.status,
  };
  return {
    ...s,
    revision: s.revision + 1,
    claims: [d, ...s.claims.filter((d) => d.id !== input.id)],
  };
}
export function execute(
  s: State,
  id: string,
  c: Context,
  batchId: string,
): State {
  const d = s.claims.find((d) => d.id === id);
  if (!d) throw Error("单据不存在");
  if (!d.input.employee.trim() || !d.input.department.trim())
    throw Error("请填写报销人和部门");
  if (!validTime(c.at)) throw Error("审核时间无效");
  if (d.batches.length >= 30) throw Error("每单最多30次审核，保留历史");
  const history = [
    ...(c.invoiceHistory || []),
    ...s.claims
      .filter((x) => x.id !== id)
      .flatMap((x) => {
        const valid = [...x.batches]
          .reverse()
          .find((b) =>
            b.results.some(
              (r) =>
                r.ruleId === "R002" &&
                !["ERROR", "INSUFFICIENT_DATA"].includes(r.status),
            ),
          );
        return valid
          ? valid.input.invoices.flatMap(
              (i) =>
                historyRow(
                  valid.input,
                  i,
                  valid.at,
                  valid.review?.decision === "approved"
                    ? "已通过"
                    : valid.review?.decision === "rejected"
                      ? "已驳回"
                      : "审核中",
                ) || [],
            )
          : [];
      }),
  ];
  const context = {
    standards: structuredClone(c.standards),
    invoiceHistory: c.invoiceHistory === null ? null : history,
  };
  const b: Batch = {
    id: batchId,
    version: d.batches.length + 1,
    revision: d.revision,
    at: c.at,
    input: structuredClone(d.input),
    ruleKeys: registry.map((r) => r.ruleKey),
    results: auditAll(d.input, { at: c.at, ...context }),
    context,
    review: null,
  };
  return {
    ...s,
    revision: s.revision + 1,
    claims: s.claims.map((x) =>
      x.id !== id
        ? x
        : {
            ...d,
            submittedAt: d.submittedAt || c.at,
            batches: [...d.batches, b],
            currentBatchId: b.id,
            status: business(b),
          },
    ),
  };
}
export function review(
  s: State,
  id: string,
  batchId: string,
  decision: "approved" | "rejected",
  reason: string,
  reviewer: string,
  at: string,
): State {
  const n = structuredClone(s),
    d = n.claims.find((d) => d.id === id),
    b = d && current(d);
  if (!d || !b || b.id !== batchId || b.review)
    throw Error("仅当前有效、未处理批次可复核");
  if (
    !validTime(at) ||
    !["approved", "rejected"].includes(decision) ||
    !reason.trim() ||
    reason.length > 500 ||
    !reviewer.trim() ||
    reviewer.length > 40 ||
    at < b.at
  )
    throw Error("人员、意见和有效时间必填");
  if (
    decision === "approved" &&
    b.results.some((r) =>
      ["BLOCK", "ERROR", "INSUFFICIENT_DATA"].includes(r.status),
    )
  )
    throw Error("拦截/信息不足/执行失败不能普通放行，请修改后重审");
  b.review = { decision, reason: reason.trim(), reviewer: reviewer.trim(), at };
  d.status = business(b);
  n.revision++;
  return n;
}
export function load(storage: Pick<Storage, "getItem">) {
  const raw = storage.getItem(KEY);
  const state = raw === null ? empty() : (JSON.parse(raw) as State);
  validate(state);
  return { state, raw };
}
export function save(
  storage: Pick<Storage, "getItem" | "setItem">,
  s: State,
  raw: string | null,
) {
  validate(s);
  const json = JSON.stringify(s);
  if (json.length > 2200000) throw Error("本地容量上限，未删除历史");
  if (storage.getItem(KEY) !== raw)
    throw Error("数据已被其他页面更新，请刷新重试");
  try {
    storage.setItem(KEY, json);
  } catch {
    throw Error("保存失败或配额不足；原记录及表单保留");
  }
}
