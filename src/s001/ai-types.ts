import type { Status } from './types';
export const riskCategories = ['BUSINESS_PURPOSE', 'VAGUE_DESCRIPTION', 'PERSONAL_EXTENSION', 'HISTORY_COMPARISON', 'UNTRUSTED_INPUT'] as const;
export type RiskCategory = typeof riskCategories[number];
export type Evidence = {
    label: string;
    value: string;
    numericClaims: {
        unit: '元' | '晚' | '%' | '笔';
        value: number;
    }[];
};
export type AIContext = {
    schema: 1;
    reimbursementId: 'CURRENT-CLAIM';
    reimbursementVersion: number;
    companyId: 'CURRENT-COMPANY';
    reimbursement: {
        expenseType: string;
        amountCents: number | null;
        currency: string;
        expenseDate: string;
        city: string;
        grade: string;
        businessDescription: string;
        partialReason: string;
        stay: {
            checkIn: string;
            checkOut: string;
            nights: number | null;
            amountCents: number | null;
        };
    };
    invoiceSummary: {
        ref: string;
        type: string;
        date: string;
        amountCents: number | null;
        currency: string;
        merchant: string;
    }[];
    auditResults: {
        ruleId: string;
        ruleKey: string;
        status: Status;
        message: string;
        facts: Record<string, unknown>;
    }[];
    policyReferences: {
        ref: string;
        ruleId: string;
        versionId: string | null;
        versionNumber: number | null;
        basis: string;
        summary: string;
    }[];
    historySummary: null | {
        source: 'EXPLICIT_DEMO_FIXTURE';
        label: string;
        currency: 'CNY';
        expenseType: '业务招待费';
        period: '2026-10';
        samples: {
            date: string;
            amountCents: number;
        }[];
        meanCents: number;
        maxCents: number;
    };
    evidence: Record<string, Evidence>;
    limitations: string[];
};
export type AIRisk = {
    riskId: string;
    riskCategory: RiskCategory;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    description: string;
    evidenceRefs: string[];
    evidenceQuotes: {
        ref: string;
        quote: string;
    }[];
    verificationQuestions: string[];
    suggestedAction: string;
};
export type AIOutput = {
    analysisStatus: 'COMPLETED';
    assessment: 'POTENTIAL_RISK' | 'NO_ADDITIONAL_ISSUE' | 'INSUFFICIENT_DATA';
    summary: string;
    riskItems: AIRisk[];
    ruleExplanation: {
        summary: string;
        evidenceRefs: string[];
        verificationQuestions: string[];
        suggestedAction: string;
    };
    limitations: string[];
    requiresHumanReview: boolean;
};
export type AIConfig = {
    enabled: boolean;
    mode: 'DEMO';
    provider: 'LOCAL_DEMO';
    modelName: '关键词与预设场景模板-v1';
    promptVersion: 'r009-demo-v1';
    manualOnly: true;
    categories: RiskCategory[];
    timeoutMs: number;
    maxOutputChars: number;
    maxRiskItems: number;
};
export type AIConfigVersion = {
    id: string;
    version: number;
    status: 'DRAFT' | 'VALIDATED' | 'PUBLISHED';
    config: AIConfig;
    createdAt: string;
    createdBy: string;
    publishedAt: string | null;
    reason: string;
    replaces: string | null;
    validatedFingerprint?: string;
    testedFingerprint?: string;
};
export type AIConfigLog = {
    id: string;
    versionId: string;
    action: string;
    actorId: string;
    actorName: string;
    at: string;
    reason: string;
    before: unknown;
    after: unknown;
};
export type Analysis = {
    requestedBy?: { id: string; name: string; role: "财务" };
    analysisId: string;
    reimbursementId: string;
    reimbursementVersion: number;
    auditBatchId: string;
    analysisMode: 'DEMO';
    modelProvider: 'LOCAL_DEMO';
    modelName: string;
    promptVersion: string;
    config: AIConfigVersion;
    analysisTimestamp: string;
    completedAt: string | null;
    inputFingerprint: string;
    context: AIContext;
    analysisStatus: 'RUNNING' | 'COMPLETED' | 'FAILED';
    structuredResult: AIOutput | null;
    errorCode: string | null;
    durationMs: number | null;
    historyRequested: boolean;
    fault: DemoFault;
};
export const demoFaults = ['NONE', 'TIMEOUT', 'UNAVAILABLE', 'INVALID_JSON', 'INVALID_EVIDENCE', 'UNSUPPORTED_ACTION', 'UNSUPPORTED_NUMBER'] as const;
export type DemoFault = typeof demoFaults[number];
export const feedbackStatuses = ['CONFIRMED_VALID', 'FALSE_POSITIVE', 'NEED_MORE_INFO', 'IGNORED', 'UNREVIEWED'] as const;
export type FeedbackStatus = typeof feedbackStatuses[number];
export type AIFeedback = {
    feedbackId: string;
    analysisId: string;
    riskId: string;
    reimbursementId: string;
    reviewerId: string;
    reviewerName: string;
    feedbackStatus: FeedbackStatus;
    feedbackComment: string;
    createdAt: string;
    relatedAuditBatchId: string;
    evidenceRefs: string[];
};
export type HumanFinding = {
    id: string;
    analysisId: string;
    reimbursementId: string;
    auditBatchId: string;
    reviewerId: string;
    reviewerName: string;
    at: string;
    description: string;
    evidenceRefs: string[];
    source: 'HUMAN';
    completeGroundTruth: false;
};
export type AIWorkspace = {
    schema: 1;
    analyses: Analysis[];
    feedback: AIFeedback[];
    humanFindings: HumanFinding[];
    configVersions: AIConfigVersion[];
    configLogs: AIConfigLog[];
};
export type AIActor = {
    id: string;
    name: string;
    role: string;
};
