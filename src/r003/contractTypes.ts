import type { HumanReview, AuditStatus } from "../r001/types";
export type Evidence = {
  id: string;
  name: string;
  status: "已提供" | "缺失" | "无效";
};
export type Stage = {
  id: string;
  name: string;
  basisPoints: number;
  requirements: string[];
};
export type Contract = {
  id: string;
  name: string;
  supplier: string;
  totalCents: number;
  effectiveDate: string;
  expiryDate: string;
  status: "草稿" | "已生效" | "已终止" | "已到期";
  mode: "一次性付款" | "分阶段付款" | "按结算付款";
  stages: Stage[];
  settlementCents: number | null;
  requirements: string[];
  evidence: Evidence[];
};
export type Payment = {
  id: string;
  contractId: string;
  applicationId: string;
  stageId: string;
  amountCents: number;
  date: string;
  status: "已支付" | "待支付" | "已取消" | "支付失败";
};
export type Application = {
  id: string;
  applicant: string;
  department: string;
  contractId: string;
  stageId: string;
  amountYuan: string;
  date: string;
  remark: string;
};
export type Risk = { rule: string; message: string; excessCents?: number };
export type Calculation = {
  totalCents: number;
  paidCents: number;
  pendingCents: number;
  remainingCents: number;
  potentialCents: number;
  contractExcessCents: number;
  stageLimitCents: number | null;
  stagePaidCents: number | null;
  stageRemainingCents: number | null;
  stagePendingCents: number | null;
  stageExcessCents: number | null;
  settlementCents: number | null;
  settlementRemainingCents: number | null;
  settlementExcessCents: number | null;
  amountCents: number;
};
export type Result = {
  ruleId: "R003";
  ruleVersion: "v1";
  at: string;
  baselineDate: string;
  status: AuditStatus;
  errors: string[];
  risks: Risk[];
  calculation: Calculation | null;
  snapshot: {
    application: Application;
    contract: Contract | null;
    payments: Payment[];
    requirements: Evidence[];
    stageLimits: number[];
  };
};
export type Version = {
  id: string;
  version: number;
  automatic: Result;
  humanReview: HumanReview | null;
};
export type Document = { id: string; input: Application; audits: Version[] };
export type State = {
  schema: 1;
  revision: number;
  contracts: Contract[];
  payments: Payment[];
  documents: Document[];
};
