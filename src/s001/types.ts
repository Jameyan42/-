import type {
  WorkflowConfig,
  Workflow,
  StoredFile,
  AuditOperation,
} from "./workflow-config";
import type { AccountConfig } from "./account-config";
import type { EntityConfig } from "./entity-rule";
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
  recognitionStatus?: "已人工核对" | "待核对" | "识别失败";
  recognitionConfidence?: number | null;
  buyerTaxStatus?: "未确认" | "已确认" | "票面确为空";
  attachment?: unknown;
};
export type Input = {
  applicantId?: string;
  travelRequestId?: string;
  attachments?: StoredFile[];
  businessDate?: string;
  businessDescription?: string;
  businessScenario?: string;
  costCenter?: string;
  accountCode?: string;
  accountStage?: "员工提交" | "财务确认";
  companyId?: string;
  id: string;
  employee: string;
  grade: string;
  department: string;
  expenseType: string;
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
    workflowConfig?: WorkflowConfig;
    workflow?: Workflow | null;
    claimRevision?: number;
    authorizationHealthy?: boolean;
    accountConfig?: AccountConfig;
    entityConfig?: EntityConfig;
    standards: StandardsCatalog | null;
    invoiceHistory: HistoryInvoice[] | null;
  };
};
export type Claim = {
  workflows?: Workflow[];
  operations?: AuditOperation[];
  id: string;
  createdAt: string;
  submittedAt: string | null;
  revision: number;
  input: Input;
  changes?: Change[];
  reviewNotes?: ReviewNote[];
  batches: Batch[];
  currentBatchId: string | null;
  status: string;
};
export type Change = {
  at: string;
  actor: string;
  role: string;
  reason: string;
  before: Input;
  after: Input;
};
export type ReviewNote = {
  at: string;
  actor: string;
  role: string;
  action: "需补充材料" | "已核实信息";
  reason: string;
  batchId: string;
  input: Input;
};
export type State = {
  workflowConfig?: WorkflowConfig;
  workflowConfigChanges?: AuditOperation[];
  schema: 1;
  revision: number;
  claims: Claim[];
  accountConfig?: AccountConfig;
  entityConfig?: EntityConfig;
  accountConfigChanges?: {
    at: string;
    actor: string;
    role: string;
    reason: string;
    before: AccountConfig;
    after: AccountConfig;
  }[];
  entityConfigChanges?: {
    at: string;
    actor: string;
    role: string;
    reason: string;
    before: EntityConfig;
    after: EntityConfig;
  }[];
};
export type Context = {
  workflowConfig?: WorkflowConfig;
  workflow?: Workflow | null;
  claimRevision?: number;
  authorizationHealthy?: boolean;
  accountConfig?: AccountConfig;
  entityConfig?: EntityConfig;
  at: string;
  standards: StandardsCatalog | null;
  invoiceHistory: HistoryInvoice[] | null;
};
