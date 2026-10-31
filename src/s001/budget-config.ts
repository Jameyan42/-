// R007 simulated monthly policy. Every amount is integer CNY cents.
export type Budget = {
  budgetId: string;
  companyId: string;
  departmentId: string;
  expenseType: string;
  budgetPeriod: string;
  periodType: "MONTH";
  budgetAmount: number;
  currency: string;
  controlMode: "HARD" | "SOFT" | "WARNING";
  warningThresholds: number[];
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "DISABLED";
  version: number;
  description: string;
  reserveOnSoftExceeded: boolean;
  extraApproverId: string;
};
export type Allocation = {
  reserved: number;
  used: number;
  revision: number;
  budgetId: string;
  budgetVersion: number;
};
export type BudgetTransaction = {
  transactionId: string;
  budgetId: string;
  reimbursementId: string;
  reimbursementVersion: number;
  transactionType: "RESERVE" | "RELEASE" | "CONSUME" | "ADJUST";
  scope: "CLAIM" | "CONFIG";
  amount: number;
  beforeAmount: number;
  afterAmount: number;
  before: Allocation;
  after: Allocation;
  transactionTime: string;
  businessEventId: string;
  description: string;
  actor: string;
  budgetVersion: number;
};
export type BudgetBook = {
  schema: 1;
  version: number;
  budgets: Budget[];
  transactions: BudgetTransaction[];
  events: { id: string; fingerprint: string; at: string }[];
  changes: {
    at: string;
    actor: string;
    role: string;
    reason: string;
    before: Budget[];
    after: Budget[];
  }[];
};
export type BudgetEscalation = {
  ruleVersionId?: string;
  budgetId: string;
  budgetVersion: number;
  amountCents: number;
  excessCents: number;
  ownerId: string;
  ownerName: string;
  ownerRole: string;
  at: string;
};
export function defaultBudgetBook(): BudgetBook {
  const budgets: Budget[] = [];
  for (const companyId of ["SZ", "DG", "SH"])
    for (const departmentId of ["sales", "product", "ops"])
      for (const budgetPeriod of ["2026-10", "2026-11"])
        for (const expenseType of [
          "住宿费",
          "差旅交通费",
          "业务招待费",
          "办公费",
          "培训费",
        ])
          budgets.push({
            budgetId: `B-${companyId}-${departmentId}-${expenseType}-${budgetPeriod}`,
            companyId,
            departmentId,
            expenseType,
            budgetPeriod,
            periodType: "MONTH",
            budgetAmount: 1000000,
            currency: "CNY",
            controlMode: "HARD",
            warningThresholds: [80, 90, 100],
            effectiveFrom: budgetPeriod + "-01",
            effectiveTo: null,
            status: "ACTIVE",
            version: 1,
            description:
              "模拟月度预算；已使用指最终财务批准，不是已付款或总账费用",
            reserveOnSoftExceeded: true,
            extraApproverId: "admin-gu",
          });
  return {
    schema: 1,
    version: 1,
    budgets,
    transactions: [],
    events: [],
    changes: [],
  };
}
