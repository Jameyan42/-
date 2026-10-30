import type { HumanReview, StandardsCatalog } from "../r001/types";
import type { HistoryInvoice } from "../r002/invoiceTypes";
export type Status =
  | "PASS"
  | "REVIEW"
  | "BLOCK"
  | "INSUFFICIENT_DATA"
  | "NOT_APPLICABLE"
  | "ERROR";
export type RuleResult = {
  ruleId: string;
  ruleKey: string;
  ruleName: string;
  status: Status;
  severity: "none" | "low" | "medium" | "high";
  message: string;
  evidence: unknown;
  suggestedAction: string;
};
export type Invoice = {
  id: string;
  type: string;
  code: string;
  number: string;
  amountYuan: string;
  currency: string;
  date: string;
  sellerName: string;
  buyerName: string;
  sellerTaxId: string;
  buyerTaxId: string;
  source: "manual" | "ocr-assisted";
  attachment?: unknown;
};
export type Input = {
  id: string;
  employee: string;
  grade: string;
  department: string;
  expenseType: "住宿费" | "其他费用";
  amountYuan: string;
  currency: string;
  city: string;
  checkIn: string;
  checkOut: string;
  hotel: string;
  hotelAmountYuan: string;
  partialReason: string;
  invoices: Invoice[];
};
export type Batch = {
  id: string;
  version: number;
  revision: number;
  at: string;
  input: Input;
  ruleKeys: string[];
  results: RuleResult[];
  review: HumanReview | null;
  context: {
    standards: StandardsCatalog | null;
    invoiceHistory: HistoryInvoice[] | null;
  };
};
export type Claim = {
  id: string;
  createdAt: string;
  submittedAt: string | null;
  revision: number;
  input: Input;
  batches: Batch[];
  currentBatchId: string | null;
  status: string;
};
export type State = { schema: 1; revision: number; claims: Claim[] };
export type Context = {
  at: string;
  standards: StandardsCatalog | null;
  invoiceHistory: HistoryInvoice[] | null;
};
