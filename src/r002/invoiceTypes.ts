import type { AuditStatus, HumanReview } from "../r001/types";
export type { HumanReview, AuditStatus };
export const INVOICE_TYPES = [
  "数电发票",
  "增值税电子普通发票",
  "增值税电子专用发票",
  "纸质发票",
  "其他",
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
export const HISTORY_STATUSES = [
  "已通过",
  "审核中",
  "已驳回",
  "已撤回",
] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];
export type BusinessStatus = HistoryStatus | "待补充";
export interface InvoiceInput {
  readonly employeeName: string;
  readonly department: string;
  readonly invoiceType: string;
  readonly invoiceCode: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly sellerName: string;
  readonly sellerTaxId: string;
  readonly buyerName: string;
  readonly amountYuan: string;
  readonly remark: string;
}
export interface CurrentClaim {
  readonly documentId: string;
  readonly invoiceRecordId: string;
  readonly submittedAt: string;
  readonly input: InvoiceInput;
}
export interface InvoiceSnapshot {
  readonly id: string;
  readonly type: string;
  readonly code: string;
  readonly number: string;
  readonly issueDate: string;
  readonly sellerName: string;
  readonly sellerTaxId: string;
  readonly buyerName: string;
  readonly amountCents: number | null;
  readonly remark: string;
}
export interface HistoryInvoice {
  readonly id: string;
  readonly documentId: string;
  readonly employeeName: string;
  readonly department: string;
  readonly submittedAt: string;
  readonly businessStatus: HistoryStatus;
  readonly invoice: InvoiceSnapshot & { readonly amountCents: number };
  readonly updatedAt: string;
  readonly sourceAuditVersion?: number;
}
export interface InvoiceIssue {
  readonly field: keyof InvoiceInput | "identity" | "history" | "time";
  readonly kind: "missing" | "invalid";
  readonly message: string;
}
export interface DuplicateMatch {
  readonly kind: "exact" | "potential";
  readonly strategy: "R002-01" | "R002-02" | "R002-03";
  readonly reason: string;
  readonly statusExplanation: string;
  readonly historical: HistoryInvoice;
}
export interface R002AuditResult {
  readonly ruleId: "R002";
  readonly ruleVersion: "v1";
  readonly at: string;
  readonly documentId: string;
  readonly status: AuditStatus;
  readonly explanation: string;
  readonly strategy: string;
  readonly searchPerformed: boolean;
  readonly issues: readonly InvoiceIssue[];
  readonly currentInvoice: InvoiceSnapshot;
  readonly exactCount: number;
  readonly potentialCount: number;
  readonly matchCount: number;
  readonly zeroAmount: boolean;
  readonly unreliableIdentifier: boolean;
  readonly matches: readonly DuplicateMatch[];
  readonly evidence: {
    readonly dataRevision: number;
    readonly sourceCount: number;
    readonly checkedCount: number;
    readonly excludedSelfCount: number;
    /** All same-number candidates, including different-code nonmatches. Other amounts are not lookup keys. */
    readonly candidates: readonly HistoryInvoice[];
  };
}
export interface AuditVersion {
  readonly id: string;
  readonly version: number;
  readonly inputSnapshot: CurrentClaim;
  readonly automatic: R002AuditResult;
  readonly humanReview: HumanReview | null;
}
export interface InvoiceDocument {
  readonly id: string;
  readonly invoiceRecordId: string;
  readonly submittedAt: string;
  readonly input: InvoiceInput;
  readonly invoice: InvoiceSnapshot;
  readonly businessStatus: BusinessStatus;
  readonly audits: readonly AuditVersion[];
}
export interface R002State {
  readonly schema: 1;
  readonly revision: number;
  readonly library: readonly HistoryInvoice[];
  readonly documents: readonly InvoiceDocument[];
}
export interface RuleContext {
  readonly at: string;
  readonly dataRevision: number;
}
