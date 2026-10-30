import { buyerRule } from "./entity-rule";
import { auditLodging, parseYuan } from "../r001/rule";
import {
  auditInvoiceDuplicate,
  inspectInput,
} from "../r002/invoiceDuplicateRule";
import type { HistoryInvoice, CurrentClaim } from "../r002/invoiceTypes";
import type { Input, Context, RuleResult, Status, Invoice } from "./types";
export const descriptors = [
  { ruleId: "R001", ruleKey: "lodging.limit", ruleName: "住宿费超标" },
  { ruleId: "R002", ruleKey: "invoice.duplicate", ruleName: "发票重复报销" },
  {
    ruleId: "R003",
    ruleKey: "invoice.amount-support",
    ruleName: "发票金额一致性",
  },
];
export function result(
  index: number,
  status: Status,
  message: string,
  evidence: unknown,
): RuleResult {
  return {
    ...descriptors[index]!,
    status,
    severity:
      status === "PASS" || status === "NOT_APPLICABLE"
        ? "none"
        : status === "REVIEW"
          ? "medium"
          : "high",
    message,
    evidence,
    suggestedAction:
      status === "PASS"
        ? "等待财务最终确认"
        : status === "BLOCK"
          ? "补充票据或修正金额后重新审核；本期禁止例外放行"
          : status === "INSUFFICIENT_DATA" || status === "ERROR"
            ? "补充或修正资料后重新审核"
            : "财务核查依据并记录意见",
  };
}
export function amountRule(d: Input): RuleResult {
  const amount = parseYuan(d.amountYuan);
  if (!amount.ok || d.currency !== "CNY" || !d.invoices.length)
    return result(
      2,
      "INSUFFICIENT_DATA",
      "缺少有效报销金额、人民币币种或发票",
      null,
    );
  let sum = 0n;
  for (const i of d.invoices) {
    const n = parseYuan(i.amountYuan);
    if (!n.ok || i.currency !== "CNY")
      return result(
        2,
        "INSUFFICIENT_DATA",
        "发票金额缺失/无效，或币种不能直接比较；未计算合计",
        { invoiceId: i.id, currency: i.currency },
      );
    sum += BigInt(n.cents);
  }
  if (sum > BigInt(Number.MAX_SAFE_INTEGER))
    return result(2, "INSUFFICIENT_DATA", "发票合计超过安全范围", null);
  const total = Number(sum),
    difference = amount.cents - total,
    evidence = {
      amountCents: amount.cents,
      invoiceTotalCents: total,
      differenceCents: difference,
      invoices: structuredClone(d.invoices),
      partialReason: d.partialReason,
    };
  if (d.expenseType !== "住宿费")
    return result(
      2,
      "NOT_APPLICABLE",
      "本期仅确认住宿费票额支持政策，其他费用不套用",
      evidence,
    );
  if (amount.cents === 0 || total === 0)
    return result(2, "REVIEW", "0元报销或0元票额需要人工核实", evidence);
  return result(
    2,
    difference > 0 ? "BLOCK" : difference < 0 ? "REVIEW" : "PASS",
    difference > 0
      ? `申请金额超过发票合计${(difference / 100).toFixed(2)}元，请核实漏票或金额错误`
      : difference < 0
        ? `申请金额低于发票合计${(-difference / 100).toFixed(2)}元，可能属于部分报销，请核实原因`
        : "发票金额合计与申请金额一致",
    evidence,
  );
}
export function invoiceClaim(d: Input, i: Invoice, at: string): CurrentClaim {
  return {
    documentId: `${d.id}::${i.id.replaceAll("-", "")}`,
    invoiceRecordId: i.id,
    submittedAt: at,
    input: {
      employeeName: d.employee,
      department: d.department,
      invoiceType: i.type,
      invoiceCode: i.code,
      invoiceNumber: i.number,
      issueDate: i.date,
      sellerName: i.sellerName,
      sellerTaxId: i.sellerTaxId,
      buyerName: i.buyerName,
      amountYuan: i.amountYuan,
      remark: "统一报销单 " + d.id,
    },
  };
}
export function historyRow(
  d: Input,
  i: Invoice,
  at: string,
  businessStatus: HistoryInvoice["businessStatus"],
): HistoryInvoice | null {
  const claim = invoiceClaim(d, i, at),
    check = inspectInput(claim.input);
  if (check.issues.length || i.currency !== "CNY") return null;
  return {
    id: "S001-" + i.id,
    documentId: claim.documentId,
    employeeName: d.employee,
    department: d.department,
    submittedAt: at,
    businessStatus,
    invoice: {
      ...check.invoice,
      id: i.id,
      amountCents: check.invoice.amountCents!,
    },
    updatedAt: at,
  };
}
export type Registration = {
  ruleId: string;
  ruleKey: string;
  ruleName: string;
  execute: (d: Input, c: Context) => RuleResult;
};
export const registry: Registration[] = [
  {
    ...descriptors[0]!,
    execute: (d, c) => {
      if (d.expenseType !== "住宿费")
        return result(0, "NOT_APPLICABLE", "非住宿费用", null);
      if (!c.standards) throw Error("R001标准库无法读取");
      if (d.currency !== "CNY")
        return result(0, "INSUFFICIENT_DATA", "仅支持人民币", null);
      const r = auditLodging(
        {
          documentId: d.id,
          employeeName: d.employee,
          grade: d.grade,
          city: d.city,
          checkIn: d.checkIn,
          checkOut: d.checkOut,
          amountYuan: d.hotelAmountYuan,
        },
        c.standards,
      );
      const total = parseYuan(d.amountYuan),
        hotel = parseYuan(d.hotelAmountYuan);
      if (!total.ok || !hotel.ok || total.cents !== hotel.cents)
        return result(
          0,
          "INSUFFICIENT_DATA",
          "单住宿明细金额必须与申请金额一致",
          r,
        );
      return result(
        0,
        r.status === "passed"
          ? "PASS"
          : r.status === "review_required"
            ? "REVIEW"
            : "INSUFFICIENT_DATA",
        r.status === "passed"
          ? "住宿金额符合标准"
          : r.status === "review_required"
            ? "住宿超标、0元或缺少标准，需核查"
            : "住宿资料不足或错误",
        r,
      );
    },
  },
  {
    ...descriptors[1]!,
    execute: (d, c) => {
      if (!c.invoiceHistory) throw Error("R002历史库无法读取");
      if (!d.invoices.length)
        return result(1, "INSUFFICIENT_DATA", "请添加发票", null);
      const checks = d.invoices.map((i) => {
        if (i.currency !== "CNY")
          return {
            invoiceId: i.id,
            status: "incomplete",
            issues: ["币种不支持"],
          };
        const siblings = d.invoices
          .filter((x) => x.id !== i.id)
          .flatMap((x) => historyRow(d, x, c.at, "审核中") || []);
        return auditInvoiceDuplicate(
          invoiceClaim(d, i, c.at),
          [...c.invoiceHistory!, ...siblings],
          { at: c.at, dataRevision: 1 },
        );
      });
      const missing = checks.some((r) =>
          ["invalid", "incomplete"].includes(r.status),
        ),
        risk = checks.some((r) => r.status === "review_required");
      return result(
        1,
        missing ? "INSUFFICIENT_DATA" : risk ? "REVIEW" : "PASS",
        missing
          ? "部分发票资料不足，不能判定为查重通过"
          : risk
            ? "发现重复票面、潜在冲突或异常金额，请核查全部证据"
            : "当前可访问历史中未发现重复风险",
        checks,
      );
    },
  },
  { ...descriptors[2]!, execute: amountRule },
  {
    ruleId: "R004",
    ruleKey: "invoice.buyer-entity",
    ruleName: "发票抬头与税号审核",
    execute: buyerRule,
  },
];
export function auditAll(d: Input, c: Context, rules = registry): RuleResult[] {
  return rules
    .map((rule) => {
      try {
        return rule.execute(d, c);
      } catch (err) {
        return {
          ...rule,
          status: "ERROR" as const,
          severity: "high" as const,
          message: String(err),
          evidence: { error: String(err) },
          suggestedAction: "规则执行失败，请修复数据或服务后重审",
          execute: undefined,
        };
      }
    })
    .map(({ ...r }) => {
      delete (r as Partial<Registration>).execute;
      return r;
    });
}
