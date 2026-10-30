import { defaultEntities, validateEntities } from "./entity-rule";
import type { State, Input, Claim, Batch, Context } from "./types";
import { auditAll, historyRow, registry } from "./rules";
export const KEY = "qingbao-s001-v1";
export const empty = (): State => ({
  schema: 1,
  revision: 1,
  claims: [],
  entityConfig: defaultEntities(),
});
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
  if (
    d.companyId !== undefined &&
    (typeof d.companyId !== "string" || d.companyId.length > 80)
  )
    throw Error("法人编号无效");
  for (const i of d.invoices) {
    if (
      (i.recognitionStatus !== undefined &&
        !["已人工核对", "待核对", "识别失败"].includes(i.recognitionStatus)) ||
      (i.buyerTaxStatus !== undefined &&
        !["未确认", "已确认", "票面确为空"].includes(i.buyerTaxStatus)) ||
      (i.recognitionConfidence !== undefined &&
        i.recognitionConfidence !== null &&
        (!Number.isFinite(i.recognitionConfidence) ||
          i.recognitionConfidence < 0 ||
          i.recognitionConfidence > 100))
    )
      throw Error("识别核对状态或置信度无效");
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
  if (s.entityConfig) validateEntities(s.entityConfig);
  if (s.entityConfigChanges !== undefined) {
    if (
      !Array.isArray(s.entityConfigChanges) ||
      s.entityConfigChanges.length > 100
    )
      throw Error("法人配置记录容量或格式无效");
    for (const log of s.entityConfigChanges) {
      if (
        !validTime(log.at) ||
        !log.actor?.trim() ||
        log.role !== "财务" ||
        !log.reason?.trim() ||
        log.reason.length > 500
      )
        throw Error("法人配置修改记录无效");
      validateEntities(log.before);
      validateEntities(log.after);
    }
  }
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
    if (d.changes !== undefined) {
      if (!Array.isArray(d.changes) || d.changes.length > 100)
        throw Error("修改记录容量或格式无效");
      for (const log of d.changes) {
        if (
          !validTime(log.at) ||
          !log.actor?.trim() ||
          !log.role?.trim() ||
          !log.reason?.trim() ||
          log.reason.length > 500
        )
          throw Error("资料修改记录无效");
        checkInput(log.before);
        checkInput(log.after);
      }
    }
    if (d.reviewNotes !== undefined) {
      if (!Array.isArray(d.reviewNotes) || d.reviewNotes.length > 100)
        throw Error("核查意见容量或格式无效");
      for (const log of d.reviewNotes) {
        if (
          !validTime(log.at) ||
          log.role !== "财务" ||
          !log.actor?.trim() ||
          !log.reason?.trim() ||
          log.reason.length > 500 ||
          !["需补充材料", "已核实信息"].includes(log.action) ||
          !d.batches.some((b) => b.id === log.batchId)
        )
          throw Error("核查记录无效");
        checkInput(log.input);
      }
    }
    const b = current(d);
    if ((d.currentBatchId && !b) || d.status !== (b ? business(b) : "草稿"))
      throw Error("当前审核状态无效");
  }
}
export function saveDraft(
  s: State,
  input: Input,
  at: string,
  change?: { actor: string; role: string; reason: string },
): State {
  checkInput(input);
  if (!validTime(at)) throw Error("时间无效");
  const old = s.claims.find((d) => d.id === input.id);
  if (!input.id || input.invoices.length > 5) throw Error("单号或发票数量无效");
  const changed = !old || JSON.stringify(old.input) !== JSON.stringify(input);
  if (
    changed &&
    old?.batches.length &&
    (!change?.reason.trim() || !change.actor.trim() || !change.role.trim())
  )
    throw Error("已审核资料变更必须填写修改原因并记录身份");
  const changes = [...(old?.changes || [])];
  if (changed && old)
    changes.push({
      at,
      actor: change?.actor || "模拟录入人",
      role: change?.role || "员工",
      reason: change?.reason || "草稿编辑",
      before: structuredClone(old.input),
      after: structuredClone(input),
    });
  const d: Claim = {
    id: input.id,
    createdAt: old?.createdAt || at,
    submittedAt: old?.submittedAt || null,
    revision: (old?.revision || 0) + (changed ? 1 : 0),
    input: structuredClone(input),
    changes,
    reviewNotes: old?.reviewNotes || [],
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
    entityConfig: structuredClone(
      c.entityConfig || s.entityConfig || defaultEntities(),
    ),
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

export function noteReview(
  s: State,
  id: string,
  action: "需补充材料" | "已核实信息",
  reason: string,
  actor: string,
  role: string,
  at: string,
): State {
  if (
    role !== "财务" ||
    !reason.trim() ||
    reason.length > 500 ||
    !actor.trim() ||
    !validTime(at)
  )
    throw Error("财务身份、意见及时间必填");
  const n = structuredClone(s),
    d = n.claims.find((d) => d.id === id),
    b = d && current(d);
  if (!d || !b || at < b.at) throw Error("只能记录当前有效批次的核查意见");
  d.reviewNotes = [
    ...(d.reviewNotes || []),
    {
      at,
      actor,
      role,
      action,
      reason,
      batchId: b.id,
      input: structuredClone(d.input),
    },
  ];
  n.revision++;
  return n;
}
export function configureEntities(
  s: State,
  config: import("./entity-rule").EntityConfig,
  actor: string,
  role: string,
  reason: string,
  at: string,
): State {
  if (role !== "财务" || !actor.trim() || !reason.trim() || !validTime(at))
    throw Error("仅财务可维护模拟法人制度，原因必填");
  validateEntities(config);
  const next = structuredClone(s);
  next.entityConfig = {
    ...structuredClone(config),
    version: (s.entityConfig?.version || 1) + 1,
  };
  next.entityConfigChanges = [
    ...(s.entityConfigChanges || []),
    {
      at,
      actor,
      role,
      reason,
      before: structuredClone(s.entityConfig || defaultEntities()),
      after: structuredClone(next.entityConfig!),
    },
  ];
  next.revision++;
  return next;
}
