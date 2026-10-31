import { calendarOrdinal } from '../r001/rule';
import { GRADES, type StandardsCatalog } from '../r001/types';
import { validateAccounts } from './account-rule';
import { expenseTypes, type AccountConfig } from './account-config';
import { validateEntities, type EntityConfig } from './entity-rule';
import { validateWorkflowConfig } from './workflow-rule';
import type { WorkflowConfig } from './workflow-config';
import type { Context, Input, State, RuleResult } from './types';
export const ruleIds = ['R001', 'R002', 'R003', 'R004', 'R005', 'R006', 'R007'] as const;
export type RuleId = typeof ruleIds[number];
export type Parameters = {
    R001: {
        currency: 'CNY';
        standards: StandardsCatalog;
    };
    R002: {
        identity: 'FIXED';
        historyScope: 'ACCESSIBLE';
        exactAction: 'BLOCK' | 'REVIEW';
        suspectedAction: 'BLOCK' | 'REVIEW';
    };
    R003: {
        expenseTypes: string[];
        allowPartial: boolean;
        requirePartialReason: boolean;
        partialAction: 'PASS' | 'REVIEW';
        allowNoInvoice: false;
    };
    R004: Pick<EntityConfig, 'policies' | 'minimumConfidence'>;
    R005: Pick<AccountConfig, 'mappings' | 'scenarios'>;
    R006: Omit<WorkflowConfig, 'version'>;
    R007: {
        policies: {
            expenseType: string;
            controlMode: 'HARD' | 'SOFT' | 'WARNING';
            warningThresholds: number[];
            reserveOnSoftExceeded: boolean;
            extraApproverId: string;
        }[];
    };
};
export type RuleVersion = {
    versionId: string;
    ruleId: RuleId;
    versionNumber: number;
    companyId: string;
    scope: 'COMPANY' | 'GROUP';
    parameters: Parameters[RuleId];
    enabled: boolean;
    status: 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'ARCHIVED';
    effectiveFrom: string;
    effectiveTo: string | null;
    createdBy: string;
    createdAt: string;
    publishedBy: string | null;
    publishedAt: string | null;
    changeReason: string;
    replaces: string | null;
    sourceVersionId: string | null;
    validationFingerprint?: string;
    simulation?: {
        fingerprint: string;
        at: string;
        input: Input;
        before: RuleResult;
        after: RuleResult;
        checks: string[];
    };
};
export type ConfigLog = {
    logId: string;
    ruleId: string;
    versionId: string;
    actionType: string;
    operatorId: string;
    operatorName: string;
    operationTime: string;
    beforeValue: unknown;
    afterValue: unknown;
    changeReason: string;
    publishResult: string;
};
export type RuleBook = {
    schema: 1;
    versions: RuleVersion[];
    logs: ConfigLog[];
};
export type Selection = {
    ruleId: RuleId;
    version: RuleVersion | null;
    date: string;
    basis: string;
    error?: string;
};
export const definitions = ruleIds.map((ruleId, i) => ({ ruleId, ruleName: ['住宿费超标', '发票重复报销', '发票金额一致性', '发票抬头与税号', '费用与会计科目', '审批流程与附件', '费用预算与额度'][i]!, category: ['费用标准', '票据内控', '票据内控', '票据内控', '核算', '流程内控', '预算'][i]!, description: ['按城市和职级计算连续住宿总额', '固定唯一标识及完整历史范围，不开放绕过查重', '精确金额比较，部分报销政策', '复用法人主数据，维护票种适用政策', '复用已配置科目表', '新流程使用发布政策，在途审批与附件一起锁定', '仅策略，不复制预算额度或改写流水'][i]!, configurable: true, supportedScopes: ['GROUP', 'COMPANY'], riskLevel: i === 1 || i === 5 ? 'HIGH' : 'MEDIUM', parameterSchema: ['城市、职级、每晚整数分、人民币', '固定标识/全历史、确定/疑似重复动作', '费用类型、部分报销、原因、复核策略', '票种适用、税号必填、OCR置信度（法人另行维护）', '法人映射、允许/推荐科目、日期、场景', '审批金额区间/顺序/角色/职责分离，附件条件', '费用类型、模式、阈值、柔性额外具名审批'][i]! }));
export function versionSnapshot(v: RuleVersion): RuleVersion { const n = structuredClone(v); delete n.simulation; delete n.validationFingerprint; return n; }
export function fingerprint(v: RuleVersion) { return JSON.stringify([v.ruleId, v.companyId, v.scope, v.parameters, v.enabled, v.effectiveFrom, v.effectiveTo, v.changeReason, v.replaces]); }
const text = (s: unknown) => typeof s === 'string' && s.trim().length > 0 && s.length <= 500;
const date = (s: string) => calendarOrdinal(s) !== null;
export function validateParameters(v: RuleVersion, s: State) {
    const p = v.parameters as any;
    if (!p || typeof p !== 'object' || Array.isArray(p))
        throw Error('参数必须是已定义的对象');
    const keys: Record<RuleId, string[]> = { R001: ['currency', 'standards'], R002: ['identity', 'historyScope', 'exactAction', 'suspectedAction'], R003: ['expenseTypes', 'allowPartial', 'requirePartialReason', 'partialAction', 'allowNoInvoice'], R004: ['policies', 'minimumConfidence'], R005: ['mappings', 'scenarios'], R006: ['approvalPolicies', 'attachmentPolicies'], R007: ['policies'] };
    if (Object.keys(p).length !== keys[v.ruleId].length || Object.keys(p).some(k => !keys[v.ruleId].includes(k)))
        throw Error('参数字段缺失或包含不支持的字段；不接受脚本/表达式');
    if (v.ruleId === 'R001') {
        if (p.currency !== 'CNY' || !p.standards || !Number.isSafeInteger(p.standards.version) || p.standards.version < 1 || !Array.isArray(p.standards.rows) || !p.standards.rows.length || p.standards.rows.length > 300 || !Number.isFinite(Date.parse(p.standards.updatedAt)))
            throw Error('住宿标准、人民币或版本格式无效');
        const rows = p.standards.rows as any[];
        if (new Set(rows.map(r => r.id)).size !== rows.length || new Set(rows.map(r => JSON.stringify([r.city, r.grade]))).size !== rows.length)
            throw Error('住宿标准冲突：同城市职级只能有一个标准');
        if (rows.some(r => !text(r.id) || !text(r.city) || !GRADES.includes(r.grade) || !Number.isSafeInteger(r.nightlyRateCents) || r.nightlyRateCents < 0))
            throw Error('住宿费标准必须为有效的非负金额（整数分），城市/职级有效');
    }
    else if (v.ruleId === 'R002') {
        if (p.identity !== 'FIXED' || p.historyScope !== 'ACCESSIBLE' || !['BLOCK', 'REVIEW'].includes(p.exactAction) || !['BLOCK', 'REVIEW'].includes(p.suspectedAction))
            throw Error('唯一标识及完整可访问历史不得削弱，重复不得自动通过');
    }
    else if (v.ruleId === 'R003') {
        if (!Array.isArray(p.expenseTypes) || !p.expenseTypes.length || new Set(p.expenseTypes).size !== p.expenseTypes.length || p.expenseTypes.some((t: string) => !expenseTypes.includes(t)) || typeof p.allowPartial !== 'boolean' || typeof p.requirePartialReason !== 'boolean' || !['PASS', 'REVIEW'].includes(p.partialAction) || p.allowNoInvoice !== false)
            throw Error('金额政策格式无效；本期不开放无票豁免');
    }
    else if (v.ruleId === 'R004') {
        if (!s.entityConfig)
            throw Error('法人主数据缺失');
        validateEntities({ ...s.entityConfig, ...p });
    }
    else if (v.ruleId === 'R005') {
        if (!s.accountConfig)
            throw Error('科目主数据缺失');
        const c = { ...s.accountConfig, ...p } as AccountConfig;
        validateAccounts(c);
        if (c.mappings.some(m => !expenseTypes.includes(m.expenseType) || (m.companyId !== '*' && !s.entityConfig?.companies.some(c => c.companyId === m.companyId))))
            throw Error('费用类型或法人不存在');
        const rows = c.mappings.filter(m => m.status === 'ACTIVE');
        for (const [i, a] of rows.entries())
            for (const b of rows.slice(i + 1))
                if (a.companyId === b.companyId && a.expenseType === b.expenseType && a.effectiveFrom <= (b.effectiveTo || '9999-12-31') && b.effectiveFrom <= (a.effectiveTo || '9999-12-31'))
                    throw Error('会计科目映射有效期冲突');
    }
    else if (v.ruleId === 'R006') {
        validateWorkflowConfig({ version: 1, ...p });
        if ([...p.approvalPolicies, ...p.attachmentPolicies].some((r: any) => !expenseTypes.includes(r.expenseType) || (r.companyId !== '*' && !s.entityConfig?.companies.some(c => c.companyId === r.companyId))))
            throw Error('审批或附件政策引用未知法人/费用类型');
        for (const rows of [p.approvalPolicies, p.attachmentPolicies] as any[][])
            for (const [i, a] of rows.entries())
                for (const b of rows.slice(i + 1))
                    if (a.status === 'ACTIVE' && b.status === 'ACTIVE' && a.companyId === b.companyId && a.expenseType === b.expenseType && (!('grade' in a) || !a.grade || !b.grade || a.grade === b.grade) && a.minAmount <= (b.maxAmount ?? Number.MAX_SAFE_INTEGER) && b.minAmount <= (a.maxAmount ?? Number.MAX_SAFE_INTEGER) && a.effectiveFrom <= (b.effectiveTo || '9999-12-31') && b.effectiveFrom <= (a.effectiveTo || '9999-12-31'))
                        throw Error('审批或附件有效金额区间/期间冲突');
    }
    else {
        if (!Array.isArray(p.policies) || !p.policies.length || p.policies.length > 30 || new Set(p.policies.map((x: any) => x.expenseType)).size !== p.policies.length)
            throw Error('预算策略重复或缺失');
        for (const r of p.policies)
            if (!expenseTypes.includes(r.expenseType) || !['HARD', 'SOFT', 'WARNING'].includes(r.controlMode) || !Array.isArray(r.warningThresholds) || !r.warningThresholds.length || r.warningThresholds.length > 10 || r.warningThresholds.some((n: number, i: number) => !Number.isInteger(n) || n < 1 || n > 100 || (i > 0 && n <= r.warningThresholds[i - 1])) || typeof r.reserveOnSoftExceeded !== 'boolean' || !text(r.extraApproverId))
                throw Error('预算模式/递增预警阈值（1–100）/额外审批人无效');
    }
}
export function validateVersion(v: RuleVersion, s: State) {
    if (!v || !ruleIds.includes(v.ruleId) || !text(v.versionId) || !Number.isSafeInteger(v.versionNumber) || v.versionNumber < 1 || !text(v.companyId) || !['GROUP', 'COMPANY'].includes(v.scope) || (v.companyId === '*') !== (v.scope === 'GROUP') || (v.companyId !== '*' && !s.entityConfig?.companies.some(c => c.companyId === v.companyId)) || typeof v.enabled !== 'boolean' || !['DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED'].includes(v.status) || !date(v.effectiveFrom) || (v.effectiveTo !== null && (!date(v.effectiveTo) || v.effectiveTo < v.effectiveFrom)) || !text(v.createdBy) || !Number.isFinite(Date.parse(v.createdAt)) || !text(v.changeReason))
        throw Error('规则版本范围、状态、日期、原因或标识无效');
    validateParameters(v, s);
}
export function policyToday(at: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)); }
export function businessDate(d: Input, id: RuleId) { return id === 'R001' ? d.checkIn : (d.businessDate || (d.expenseType === '住宿费' ? d.checkIn : '')); }
// Replacements are explicit immutable edges; no edits to the replaced published version.
export function resolveVersion(book: RuleBook, d: Input, id: RuleId, at: string): Selection {
    const day = businessDate(d, id), base = { ruleId: id, date: day, basis: id === 'R001' ? '入住日期' : '业务发生日期（旧住宿单兼容入住日期）' };
    if (!d.companyId || !date(day) || !Number.isFinite(Date.parse(at)))
        return { ...base, version: null, error: '缺少适用法人、业务日期或审核时间' };
    const eligible = book.versions.filter(v => v.ruleId === id && v.status === 'PUBLISHED' && v.publishedAt && v.publishedAt <= at && v.effectiveFrom <= policyToday(at) && day >= v.effectiveFrom && (!v.effectiveTo || day <= v.effectiveTo));
    const active = eligible.filter(v => !eligible.some(n => n.replaces === v.versionId && n.companyId === v.companyId));
    const own = active.filter(v => v.companyId === d.companyId), rows = own.length ? own : active.filter(v => v.companyId === '*');
    if (rows.length !== 1)
        return { ...base, version: null, error: rows.length ? '同级有效规则冲突，禁止随机选择' : '没有适用的已发布配置' };
    const version = versionSnapshot(rows[0]!);
    return { ...base, version, ...(!version.enabled ? { error: '关键规则已停用，必须人工恢复制度，不能视作通过' } : {}) };
}
/** A future first budget policy cannot disable the existing legacy baseline before its activation. */
export function usesManagedBudgets(book:RuleBook|undefined,at:string,day=policyToday(at)) {
 return !!book?.versions.some(v=>v.ruleId==='R007'&&v.status==='PUBLISHED'&&v.publishedAt&&v.publishedAt<=at&&v.effectiveFrom<=policyToday(at)&&v.effectiveFrom<=day);
}
export function resolveAll(s: State, d: Input, at: string): Selection[] | undefined {
    if (!s.ruleBook)
        return undefined;
    return ruleIds.map(id => {
        if (id === 'R007' && !usesManagedBudgets(s.ruleBook,at,businessDate(d,id)))
            return { ruleId: id, version: null, date: businessDate(d, id), basis: '沿用R007预算台账原策略快照；尚未发布统一策略' };
        if (id === 'R006') {
            const w = [...(s.claims.find(x => x.id === d.id)?.workflows || [])].reverse().find(w => !w.cancelledAt && w.reimbursementVersion === s.claims.find(x => x.id === d.id)?.revision);
            if (w?.ruleSelection)
                return structuredClone(w.ruleSelection);
            if (w)
                return { ruleId: id, version: null, date: businessDate(d, id), basis: '在途历史审批政策锁定；历史配置版本不可确认' };
        }
        return resolveVersion(s.ruleBook!, d, id, at);
    });
}
export function applySelection(d: Input, c: Context, x: Selection): Context {
    const n = structuredClone(c);
    if (x.error)
        throw Error(x.error);
    if (!x.version)
        return n;
    const v = x.version, p = v.parameters as any;
    if (v.ruleId === 'R001')
        n.standards = { ...p.standards, version: v.versionNumber, updatedAt: v.publishedAt || v.createdAt };
    if (v.ruleId === 'R004') {
        if (!n.entityConfig)
            throw Error('法人主数据缺失');
        n.entityConfig = { ...n.entityConfig, ...p, version: v.versionNumber };
    }
    if (v.ruleId === 'R005') {
        if (!n.accountConfig)
            throw Error('科目主数据缺失');
        n.accountConfig = { ...n.accountConfig, ...p, version: v.versionNumber };
    }
    if (v.ruleId === 'R006')
        n.workflowConfig = { ...p, version: v.versionNumber };
    if (v.ruleId === 'R007') {
        if (!n.budgetBook)
            throw Error('预算台账缺失');
        const policy = p.policies.find((r: any) => r.expenseType === d.expenseType);
        if (!policy)
            throw Error('当前费用未配置预算控制策略');
        n.budgetBook.budgets = n.budgetBook.budgets.map(b => b.companyId === d.companyId && b.expenseType === d.expenseType ? { ...b, ...policy } : b);
    }
    return n;
}
export function policyOutcome(d: Input, c: Context, r: RuleResult, x: Selection): RuleResult {
    if (!x.version)
        return r;
    const p = x.version.parameters as any;
    if (r.ruleId === 'R002' && r.status === 'REVIEW') {
        const a = r.evidence as any[];
        const exact = a.some(v => v.exactCount > 0), suspect = a.some(v => v.potentialCount > 0);
        if ((exact && p.exactAction === 'BLOCK') || (suspect && p.suspectedAction === 'BLOCK'))
            return { ...r, status: 'BLOCK', severity: 'high', message: r.message + '；已发布策略要求拦截，不能普通放行' };
    }
    if (r.ruleId === 'R003' && !p.expenseTypes.includes(d.expenseType) && r.status !== 'INSUFFICIENT_DATA')
        return { ...r, status: 'NOT_APPLICABLE', severity: 'none', message: '该费用类型不在已发布的票额支持政策范围内，未判定通过' };
    if (r.ruleId === 'R003' && p.expenseTypes.includes(d.expenseType)) {
        const e = r.evidence as any;
        if (e && (e.amountCents === 0 || e.invoiceTotalCents === 0))
            return { ...r, status: 'REVIEW', severity: 'medium', message: '0元申请或0元票额需要核实，不按部分报销自动通过' };
        if (e?.differenceCents < 0 && e.amountCents > 0 && e.invoiceTotalCents > 0) {
            if (!p.allowPartial)
                return { ...r, status: 'BLOCK', severity: 'high', message: '当前已发布制度禁止部分报销' };
            if (p.requirePartialReason && !d.partialReason.trim())
                return { ...r, status: 'INSUFFICIENT_DATA', severity: 'high', message: '部分报销必须填写原因' };
            return { ...r, status: p.partialAction, severity: p.partialAction === 'PASS' ? 'none' : 'medium', message: p.partialAction === 'PASS' ? '部分报销符合已发布金额政策及原因要求' : '部分报销按已发布制度需要人工复核' };
        }
        if (r.status === 'NOT_APPLICABLE' && e?.differenceCents === 0 && e.amountCents > 0)
            return { ...r, status: 'PASS', severity: 'none', message: '发票金额合计与申请金额一致（已发布适用政策）' };
        if (r.status === 'NOT_APPLICABLE' && e?.differenceCents > 0)
            return { ...r, status: 'BLOCK', severity: 'high', message: '申请金额超过票额，已发布政策禁止放行' };
    }
    return r;
}
