export const GRADES = ["普通员工", "部门经理", "高级管理人员"] as const;
export type EmployeeGrade = (typeof GRADES)[number];
export type AuditStatus =
  "passed" | "review_required" | "incomplete" | "invalid";

/** All monetary values in persisted business objects are integer CNY cents. */
export interface LodgingStandard {
  readonly id: string;
  readonly city: string;
  readonly grade: EmployeeGrade;
  readonly nightlyRateCents: number;
}
export interface StandardsCatalog {
  readonly version: number;
  readonly updatedAt: string;
  readonly rows: readonly LodgingStandard[];
}
/** Raw text is retained for error explanations; never used as a calculated amount. */
export interface LodgingInput {
  readonly documentId: string;
  readonly employeeName: string;
  readonly grade: string;
  readonly city: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly amountYuan: string;
}
export interface FieldIssue {
  readonly field: keyof LodgingInput | "standards";
  readonly kind: "missing" | "invalid";
  readonly message: string;
}
export interface StandardSnapshot {
  readonly catalogVersion: number;
  readonly catalogUpdatedAt: string;
  readonly city: string;
  readonly grade: EmployeeGrade;
  readonly matched: boolean;
  readonly standardId: string | null;
  readonly nightlyRateCents: number | null;
}
export interface AutoAuditResult {
  readonly ruleId: "R001";
  readonly ruleVersion: "v1";
  readonly status: AuditStatus;
  readonly issues: readonly FieldIssue[];
  readonly reasons: readonly (
    "over_limit" | "missing_standard" | "zero_amount"
  )[];
  readonly nights: number | null;
  readonly amountCents: number | null;
  readonly limitCents: number | null;
  readonly excessCents: number | null;
  readonly standardSnapshot: StandardSnapshot | null;
}
export interface HumanReview {
  readonly decision: "approved" | "rejected";
  readonly reason: string;
  readonly reviewer: string;
  readonly at: string;
}
export interface AuditRecord {
  readonly id: string;
  readonly input: LodgingInput;
  readonly automatic: AutoAuditResult;
  readonly auditedAt: string;
  readonly humanReview: HumanReview | null;
}
export interface R001State {
  readonly schema: 1;
  readonly standards: StandardsCatalog;
  readonly records: readonly AuditRecord[];
}
