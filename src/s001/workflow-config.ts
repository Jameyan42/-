import type { BudgetEscalation } from "./budget-config";
export type Org = {
  departments: {
    id: string;
    name: string;
    parentId: string | null;
    headId: string | null;
  }[];
  people: {
    id: string;
    name: string;
    departmentId: string;
    managerId: string | null;
    role: string;
    active: boolean;
  }[];
};
export type NodeRole = "直属主管" | "部门负责人" | "预算负责人";
export type ApprovalPolicy = {
  policyId: string;
  companyId: string;
  expenseType: string;
  grade: string | null;
  minAmount: number;
  maxAmount: number | null;
  requiredApprovalRoles: NodeRole[];
  approvalSequence: NodeRole[];
  strictSequence: boolean;
  sequenceSeverity: "BLOCK" | "REVIEW";
  allowSamePerson: boolean;
  allowSelf: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "DISABLED";
  description: string;
};
export const materialTypes = [
  "INVOICE",
  "TRAVEL_APPROVAL",
  "ITINERARY",
  "HOTEL_DETAIL",
  "OTHER",
] as const;
export type MaterialType = (typeof materialTypes)[number];
export type AttachmentPolicy = {
  policyId: string;
  companyId: string;
  expenseType: string;
  minAmount: number;
  maxAmount: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "DISABLED";
  description: string;
  requirements: {
    type: MaterialType;
    required: boolean;
    perInvoice: boolean;
    allowApprovedTravel: boolean;
  }[];
  requireBusinessDescription: boolean;
};
export type WorkflowConfig = {
  version: number;
  approvalPolicies: ApprovalPolicy[];
  attachmentPolicies: AttachmentPolicy[];
};
export type StoredFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: string;
  data: string;
  materialType: MaterialType;
  storageStatus: "SAVED" | "FAILED" | "METADATA_ONLY";
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  uploadTime: string;
  uploadedBy: string;
  verifiedBy?: string;
  verifiedAt?: string;
  linkedInvoiceIds: string[];
};
export type ApprovalRecord = {
  approvalId: string;
  reimbursementId: string;
  approverId: string;
  approverName: string;
  approverRole: NodeRole;
  approvalLevel: number;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | "RETURNED";
  approvalTime: string;
  approvalComment: string;
  reimbursementVersion: number;
  policyVersion: number;
};
export type Workflow = {
  budgetEscalation?: BudgetEscalation;
  cancelledAt?: string;
  id: string;
  claimId: string;
  reimbursementVersion: number;
  submittedAt: string;
  applicantId: string;
  config: WorkflowConfig;
  org: Org;
  records: ApprovalRecord[];
  travelRequest?: unknown;
};
export type AuditOperation = {
  id: string;
  claimId: string;
  type: string;
  at: string;
  actor: string;
  role: string;
  reason: string;
  before: unknown;
  after: unknown;
};
export const materialLabels: Record<MaterialType, string> = {
  INVOICE: "发票",
  TRAVEL_APPROVAL: "出差审批材料",
  ITINERARY: "行程材料",
  HOTEL_DETAIL: "酒店账单/住宿明细",
  OTHER: "其他/验收材料",
};
export function defaultWorkflowConfig(): WorkflowConfig {
  const periods = {
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    status: "ACTIVE" as const,
  };
  const approvalPolicies: ApprovalPolicy[] = [];
  for (const [companyId, threshold] of [
    ["*", 100000],
    ["SZ", 100000],
    ["DG", 200000],
  ] as const)
    for (const high of [false, true])
      approvalPolicies.push({
        ...periods,
        policyId: `AP-${companyId}-${high ? "HIGH" : "LOW"}`,
        companyId,
        expenseType: "住宿费",
        grade: "普通员工",
        minAmount: high ? threshold + 1 : 0,
        maxAmount: high ? null : threshold,
        requiredApprovalRoles: high ? ["直属主管", "部门负责人"] : ["直属主管"],
        approvalSequence: high ? ["直属主管", "部门负责人"] : ["直属主管"],
        strictSequence: true,
        sequenceSeverity: "BLOCK",
        allowSamePerson: false,
        allowSelf: false,
        description: `模拟住宿制度；金额以整数分配置，${threshold / 100}元以上增加部门负责人；财务最终确认不属于前置节点`,
      });
  const attachmentPolicies: AttachmentPolicy[] = [
    "住宿费",
    "差旅交通费",
    "业务招待费",
    "办公费",
    "培训费",
  ].map((expenseType, i) => ({
    ...periods,
    policyId: `MAT-${i + 1}`,
    companyId: "*",
    expenseType,
    minAmount: 0,
    maxAmount: null,
    description: "模拟企业附件制度；存在文件不等于内容有效",
    requirements: [
      {
        type: "INVOICE",
        required: true,
        perInvoice: true,
        allowApprovedTravel: false,
      },
      ...(expenseType === "住宿费"
        ? [
            {
              type: "TRAVEL_APPROVAL" as const,
              required: true,
              perInvoice: false,
              allowApprovedTravel: true,
            },
            {
              type: "HOTEL_DETAIL" as const,
              required: false,
              perInvoice: false,
              allowApprovedTravel: false,
            },
          ]
        : expenseType === "差旅交通费"
          ? [
              {
                type: "ITINERARY" as const,
                required: true,
                perInvoice: false,
                allowApprovedTravel: false,
              },
            ]
          : []),
    ],
    requireBusinessDescription: expenseType === "业务招待费",
  }));
  return { version: 1, approvalPolicies, attachmentPolicies };
}
