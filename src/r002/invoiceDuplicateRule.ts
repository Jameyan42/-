import { calendarOrdinal, parseYuan } from "../r001/rule";
import { HISTORY_STATUSES, INVOICE_TYPES } from "./invoiceTypes";
import type {
  CurrentClaim,
  DuplicateMatch,
  HistoryInvoice,
  InvoiceInput,
  InvoiceIssue,
  InvoiceSnapshot,
  R002AuditResult,
  RuleContext,
} from "./invoiceTypes";

export const normalizeIdentifier = (value: string): string =>
  value.normalize("NFKC").trim();
export const isTraditional = (type: string): boolean =>
  ["增值税电子普通发票", "增值税电子专用发票", "纸质发票"].includes(type);
export function isIsoTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
const fieldLabels: Record<keyof InvoiceInput, string> = {
  employeeName: "员工姓名",
  department: "部门",
  invoiceType: "发票类型",
  invoiceCode: "发票代码",
  invoiceNumber: "发票号码",
  issueDate: "开票日期",
  sellerName: "销售方名称",
  sellerTaxId: "销售方税号",
  buyerName: "购买方名称",
  amountYuan: "含税金额",
  remark: "备注",
};
const required = new Set<keyof InvoiceInput>([
  "employeeName",
  "invoiceType",
  "invoiceNumber",
  "issueDate",
  "sellerName",
  "amountYuan",
]);
export function inspectInput(raw: InvoiceInput): {
  issues: InvoiceIssue[];
  invoice: InvoiceSnapshot;
} {
  const source = (raw && typeof raw === "object"
      ? raw
      : {}) as unknown as Record<string, unknown>,
    values = {} as Record<keyof InvoiceInput, string>,
    issues: InvoiceIssue[] = [];
  for (const field of Object.keys(fieldLabels) as (keyof InvoiceInput)[]) {
    const value = source[field];
    values[field] = typeof value === "string" ? value : "";
    if (value != null && typeof value !== "string")
      issues.push({
        field,
        kind: "invalid",
        message: `${fieldLabels[field]}必须为文本，不能用数字保存发票标识`,
      });
    else if (required.has(field) && !values[field].trim())
      issues.push({
        field,
        kind: "missing",
        message: `请填写${fieldLabels[field]}`,
      });
    if (
      values[field].length >
      (field === "remark"
        ? 500
        : ["sellerName", "buyerName"].includes(field)
          ? 120
          : field === "department"
            ? 80
            : 40)
    )
      issues.push({
        field,
        kind: "invalid",
        message: `${fieldLabels[field]}长度超限`,
      });
  }
  const type = values.invoiceType.trim(),
    code = normalizeIdentifier(values.invoiceCode),
    number = normalizeIdentifier(values.invoiceNumber),
    parsed = parseYuan(values.amountYuan);
  if (type && !(INVOICE_TYPES as readonly string[]).includes(type))
    issues.push({
      field: "invoiceType",
      kind: "invalid",
      message: "请选择有效发票类型",
    });
  if (number && !/^\d+$/.test(number))
    issues.push({
      field: "invoiceNumber",
      kind: "invalid",
      message: "发票号码只能包含数字，保留前导零；不支持内部空格或科学计数法",
    });
  if (code && !/^\d+$/.test(code))
    issues.push({
      field: "invoiceCode",
      kind: "invalid",
      message: "发票代码只能包含数字，保留前导零",
    });
  if (isTraditional(type) && !code)
    issues.push({
      field: "invoiceCode",
      kind: "missing",
      message: "传统电子/纸质发票需补充发票代码，不能只凭号码查重",
    });
  if (
    values.issueDate.trim() &&
    calendarOrdinal(values.issueDate.trim()) === null
  )
    issues.push({
      field: "issueDate",
      kind: "invalid",
      message: "开票日期无效，请填写真实日历日期",
    });
  if (values.amountYuan.trim() && !parsed.ok)
    issues.push({
      field: "amountYuan",
      kind: "invalid",
      message: parsed.message,
    });
  return {
    issues,
    invoice: {
      id: "",
      type,
      code,
      number,
      issueDate: values.issueDate.trim(),
      sellerName: values.sellerName.trim(),
      sellerTaxId: values.sellerTaxId.trim(),
      buyerName: values.buyerName.trim(),
      amountCents: parsed.ok ? parsed.cents : null,
      remark: values.remark.trim(),
    },
  };
}
export function validateHistory(record: HistoryInvoice): void {
  const text = (v: unknown, max: number, needed = false) =>
    typeof v === "string" && v.length <= max && (!needed || !!v.trim());
  if (
    !record ||
    !text(record.id, 80, true) ||
    !text(record.documentId, 80, true) ||
    !text(record.employeeName, 40, true) ||
    !text(record.department, 80) ||
    !isIsoTime(record.submittedAt) ||
    !isIsoTime(record.updatedAt) ||
    (record.sourceAuditVersion !== undefined &&
      (!Number.isInteger(record.sourceAuditVersion) ||
        record.sourceAuditVersion < 1 ||
        record.sourceAuditVersion > 20)) ||
    !(HISTORY_STATUSES as readonly string[]).includes(record.businessStatus)
  )
    throw Error("历史报销单字段无效");
  const invoice = record.invoice;
  if (
    !invoice ||
    !text(invoice.id, 80, true) ||
    !text(invoice.number, 40, true) ||
    !text(invoice.code, 40) ||
    !text(invoice.sellerName, 120, true) ||
    !text(invoice.sellerTaxId, 40) ||
    !text(invoice.buyerName, 120) ||
    !text(invoice.remark, 500) ||
    !(INVOICE_TYPES as readonly string[]).includes(invoice.type) ||
    calendarOrdinal(invoice.issueDate) === null ||
    !Number.isSafeInteger(invoice.amountCents) ||
    invoice.amountCents < 0
  )
    throw Error("历史发票字段或金额无效");
  if (
    !/^\d+$/.test(normalizeIdentifier(invoice.number)) ||
    (normalizeIdentifier(invoice.code) &&
      !/^\d+$/.test(normalizeIdentifier(invoice.code))) ||
    (isTraditional(invoice.type) && !normalizeIdentifier(invoice.code))
  )
    throw Error("历史发票标识不完整或无效");
}
const statusExplanation: Record<HistoryInvoice["businessStatus"], string> = {
  已通过: "存在已通过的历史报销记录，需核对是否重复报销",
  审核中: "存在待处理的重复提交，需核对在途单据",
  已驳回: "历史单据已驳回，需确认是否允许重新提交",
  已撤回: "历史单据已撤回，需确认是否允许重新提交",
};

/** R002 pure function: supplied time, explicit history, no localStorage, clocks or mutations. */
export function auditInvoiceDuplicate(
  current: CurrentClaim,
  historical: readonly HistoryInvoice[],
  context: RuleContext,
): R002AuditResult {
  const inspected = inspectInput(current.input),
    issues = [...inspected.issues],
    invoice = { ...inspected.invoice, id: current.invoiceRecordId };
  if (
    !current.documentId ||
    typeof current.documentId !== "string" ||
    current.documentId.length > 80 ||
    !current.invoiceRecordId ||
    typeof current.invoiceRecordId !== "string" ||
    current.invoiceRecordId.length > 80 ||
    !isIsoTime(current.submittedAt)
  )
    issues.push({
      field: "identity",
      kind: "invalid",
      message: "单据编号、发票记录编号或提交时间无效",
    });
  if (
    !isIsoTime(context.at) ||
    !Number.isSafeInteger(context.dataRevision) ||
    context.dataRevision < 1
  )
    issues.push({
      field: "time",
      kind: "invalid",
      message: "审核时间或数据版本无效",
    });
  try {
    if (!Array.isArray(historical) || historical.length > 400) throw Error();
    const ids = new Set<string>(),
      docs = new Set<string>();
    for (const row of historical) {
      validateHistory(row);
      if (ids.has(row.id) || docs.has(row.documentId)) throw Error();
      ids.add(row.id);
      docs.add(row.documentId);
    }
  } catch {
    issues.push({
      field: "history",
      kind: "invalid",
      message: "本地历史数据不完整或重复，无法执行可靠查重，请核对数据",
    });
  }
  const base = {
    ruleId: "R002" as const,
    ruleVersion: "v1" as const,
    at: context.at,
    documentId: current.documentId,
    currentInvoice: invoice,
    zeroAmount: invoice.amountCents === 0,
    unreliableIdentifier: invoice.type === "其他" && !invoice.code,
  };
  if (issues.length)
    return {
      ...base,
      status: issues.some((i) => i.kind === "invalid")
        ? "invalid"
        : "incomplete",
      explanation: "数据不足或格式错误，未执行可靠查重",
      strategy: "未执行：先补充或修正数据",
      searchPerformed: false,
      issues,
      exactCount: 0,
      potentialCount: 0,
      matchCount: 0,
      matches: [],
      evidence: {
        dataRevision: context.dataRevision,
        sourceCount: Array.isArray(historical) ? historical.length : 0,
        checkedCount: 0,
        excludedSelfCount: 0,
        candidates: [],
      },
    };
  const excluded = historical.filter(
    (row) => row.documentId === current.documentId,
  ).length;
  const candidates = historical
    .filter(
      (row) =>
        row.documentId !== current.documentId &&
        normalizeIdentifier(row.invoice.number) === invoice.number,
    )
    .map((row) => structuredClone(row));
  const matches: DuplicateMatch[] = [];
  for (const row of candidates) {
    const other = row.invoice,
      otherCode = normalizeIdentifier(other.code);
    let kind: DuplicateMatch["kind"] | null = null,
      strategy: DuplicateMatch["strategy"] = "R002-03",
      reason = "";
    if (invoice.type !== other.type) {
      kind = "potential";
      reason =
        "号码相同但发票类型不同，存在潜在标识冲突，不能直接认定同一张发票";
    } else if (invoice.code && otherCode) {
      if (invoice.code === otherCode) {
        kind = "exact";
        strategy = "R002-01";
        reason = "发票类型、代码和号码一致，票面标识重复";
      }
    } else if (invoice.type === "数电发票" && !invoice.code && !otherCode) {
      kind = "exact";
      strategy = "R002-02";
      reason = "双方为无代码数电发票，号码一致，票面标识重复";
    } else {
      kind = "potential";
      reason = "号码相同但代码有无不一致或缺乏可靠标识，需人工核查";
    }
    if (kind)
      matches.push({
        kind,
        strategy,
        reason,
        statusExplanation: statusExplanation[row.businessStatus],
        historical: row,
      });
  }
  const exactCount = matches.filter((m) => m.kind === "exact").length,
    potentialCount = matches.length - exactCount;
  const review =
    matches.length > 0 || base.zeroAmount || base.unreliableIdentifier;
  let explanation = exactCount
    ? `发现${exactCount}笔票面标识重复记录，需要人工复核，不直接认定违规`
    : potentialCount
      ? `发现${potentialCount}笔潜在标识冲突，需要人工核查`
      : "未发现当前模拟历史记录中的重复发票";
  if (base.zeroAmount)
    explanation += "；金额为0，请人工确认，不能当作正常通过或仅凭金额判重";
  if (base.unreliableIdentifier)
    explanation += "；其他发票类型缺少可靠唯一标识，请人工复核";
  const strategy = invoice.code
    ? "R002-01：同类型、代码＋号码精确匹配；跨类型同号按R002-03提示潜在冲突"
    : invoice.type === "数电发票"
      ? "R002-02：双方无代码数电发票按号码匹配；跨类型或代码不对称按R002-03提示冲突"
      : "R002-03：标识可靠性不足，人工核查";
  return {
    ...base,
    status: review ? "review_required" : "passed",
    explanation,
    strategy,
    searchPerformed: true,
    issues: [],
    exactCount,
    potentialCount,
    matchCount: matches.length,
    matches,
    evidence: {
      dataRevision: context.dataRevision,
      sourceCount: historical.length,
      checkedCount: historical.length - excluded,
      excludedSelfCount: excluded,
      candidates,
    },
  };
}
