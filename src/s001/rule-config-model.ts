import { createExampleStandards } from '../r001/standards';
import { defaultEntities } from './entity-rule';
import { defaultAccounts } from './account-config';
import { defaultWorkflowConfig } from './workflow-config';
import { defaultBudgetBook } from './budget-config';
import { auditAll, registry, historyRow } from './rules';
import { applySelection, definitions, fingerprint, resolveAll, resolveVersion, ruleIds, validateVersion, type RuleBook, type RuleVersion, type RuleId, type Selection, versionSnapshot, policyToday } from './rule-config';
import type { Context, Input, State } from './types';
import type { StandardsCatalog } from '../r001/types';
export type RuleActor = {
    id: string;
    name: string;
    role: string;
};
const nowValid = (at: string) => typeof at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) && Number.isFinite(Date.parse(at)) && new Date(at).toISOString() === at;
function authorize(actor: RuleActor, at: string) { if (actor?.role !== '管理员' || !actor.id?.trim() || !actor.name?.trim() || !nowValid(at))
    throw Error('仅模拟规则管理员可维护及发布规则，时间必须有效'); }
function log(b: RuleBook, v: RuleVersion, actionType: string, a: RuleActor, at: string, before: unknown, after: unknown, publishResult = '未发布') {
    b.logs.push({ logId: crypto.randomUUID(), ruleId: v.ruleId, versionId: v.versionId, actionType, operatorId: a.id, operatorName: a.name, operationTime: at, beforeValue: structuredClone(before), afterValue: structuredClone(after), changeReason: v.changeReason, publishResult });
}
function defaults(s: State, id: RuleId, catalog: StandardsCatalog): RuleVersion['parameters'] {
    if (id === 'R001')
        return { currency: 'CNY', standards: structuredClone(catalog) };
    if (id === 'R002')
        return { identity: 'FIXED', historyScope: 'ACCESSIBLE', exactAction: 'REVIEW', suspectedAction: 'REVIEW' };
    if (id === 'R003')
        return { expenseTypes: ['住宿费'], allowPartial: true, requirePartialReason: false, partialAction: 'REVIEW', allowNoInvoice: false };
    if (id === 'R004') {
        const { policies, minimumConfidence } = s.entityConfig || defaultEntities();
        return structuredClone({ policies, minimumConfidence });
    }
    if (id === 'R005') {
        const { mappings, scenarios } = s.accountConfig || defaultAccounts();
        return structuredClone({ mappings, scenarios });
    }
    if (id === 'R006') {
        const { approvalPolicies, attachmentPolicies } = s.workflowConfig || defaultWorkflowConfig();
        return structuredClone({ approvalPolicies, attachmentPolicies });
    }
    return { policies: [] };
}
export function initializeRules(s: State, a: RuleActor, at: string, catalog: StandardsCatalog): State {
    authorize(a, at);
    if (s.ruleBook)
        throw Error('已初始化，不能覆盖现有规则版本');
    const n = structuredClone(s);
    n.entityConfig ||= defaultEntities();
    n.accountConfig ||= defaultAccounts();
    n.workflowConfig ||= defaultWorkflowConfig();
    n.budgetBook ||= defaultBudgetBook();
    n.ruleBook = { schema: 1, versions: [], logs: [] };
    for (const id of ruleIds) {
        // R007 legacy policies may differ by department/month. Do not pretend a single group policy represents them.
        // Start managed R007 only through an explicit policy draft; legacy effective policy snapshots remain authoritative until then.
        if (id === 'R007')
            continue;
        const v: RuleVersion = { versionId: crypto.randomUUID(), ruleId: id, versionNumber: 1, companyId: '*', scope: 'GROUP', parameters: defaults(n, id, catalog), enabled: true, status: 'PUBLISHED', effectiveFrom: '2020-01-01', effectiveTo: null, createdBy: a.id, createdAt: at, publishedBy: a.id, publishedAt: at, changeReason: '显式导入现有配置，参数保持不变；不补造旧审核版本', replaces: null, sourceVersionId: null };
        validateVersion(v, n);
        n.ruleBook.versions.push(v);
        log(n.ruleBook, v, 'INITIALIZE', a, at, null, v, '已发布初始配置');
    }
    n.revision++;
    return n;
}
export function draftRule(s: State, id: RuleId, sourceId: string | null, companyId: string, a: RuleActor, at: string): State {
    authorize(a, at);
    if (!s.ruleBook)
        throw Error('请先显式导入现有配置');
    const n = structuredClone(s), b = n.ruleBook!, source = b.versions.find(v => v.versionId === sourceId);
    if (sourceId && !source)
        throw Error('版本来源不存在');
    if (source && source.ruleId !== id)
        throw Error('不能跨规则复制');
    const sample = simulationInput();
    sample.companyId = companyId;
    sample.checkIn = sample.businessDate = policyToday(at);
    const current = resolveVersion(b, sample, id, at).version;
    const previous = current?.companyId === companyId ? current : null;
    const v: RuleVersion = { versionId: crypto.randomUUID(), ruleId: id, versionNumber: Math.max(0, ...b.versions.filter(v => v.ruleId === id).map(v => v.versionNumber)) + 1, companyId, scope: companyId === '*' ? 'GROUP' : 'COMPANY', parameters: structuredClone(source?.parameters || defaults(n, id, createExampleStandards())), enabled: source?.enabled ?? true, status: 'DRAFT', effectiveFrom: policyToday(at), effectiveTo: null, createdBy: a.id, createdAt: at, publishedBy: null, publishedAt: null, changeReason: source ? '复制历史参数创建新版本（发布前填写具体原因）' : '新建制度（发布前填写具体原因）', replaces: previous?.versionId || null, sourceVersionId: source?.versionId || null };
    if (id === 'R007' && !source) {
        const co = companyId === '*' ? 'SZ' : companyId;
        const rows = (s.budgetBook || defaultBudgetBook()).budgets.filter(x => x.companyId === co && x.departmentId === 'sales' && x.budgetPeriod === policyToday(at).slice(0, 7));
        v.parameters = { policies: rows.map(x => ({ expenseType: x.expenseType, controlMode: x.controlMode, warningThresholds: structuredClone(x.warningThresholds), reserveOnSoftExceeded: x.reserveOnSoftExceeded, extraApproverId: x.extraApproverId })) };
        v.changeReason = '预算策略草稿：从当前销售部月份拷贝，发布将显式覆盖所选法人/集团所有部门月份策略，请复核差异';
    }
    validateVersion(v, n);
    b.versions.push(v);
    log(b, v, source ? 'COPY_OR_ROLLBACK' : 'CREATE_DRAFT', a, at, source || null, v);
    n.revision++;
    return n;
}
function editable(s: State, id: string, a: RuleActor, at: string) { authorize(a, at); const n = structuredClone(s), v = n.ruleBook?.versions.find(v => v.versionId === id); if (!v || !['DRAFT', 'VALIDATED'].includes(v.status))
    throw Error('只能修改草稿/已校验版本，已发布配置只读'); return { n, v, b: n.ruleBook! }; }
export function updateRule(s: State, id: string, values: Pick<RuleVersion, 'parameters' | 'enabled' | 'effectiveFrom' | 'effectiveTo' | 'changeReason' | 'companyId'>, a: RuleActor, at: string): State {
    const { n, v, b } = editable(s, id, a, at), before = structuredClone(v);
    Object.assign(v, structuredClone({ parameters: values.parameters, enabled: values.enabled, effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo, changeReason: values.changeReason, companyId: values.companyId }), { scope: values.companyId === '*' ? 'GROUP' : 'COMPANY', status: 'DRAFT' });
    delete v.simulation;
    delete v.validationFingerprint;
    // If scope changes, it must not retain a replacement edge into a different company.
    const old = b.versions.find(x => x.versionId === v.replaces);
    if (old?.companyId !== v.companyId)
        v.replaces = null;
    validateVersion(v, n);
    log(b, v, 'UPDATE_PARAMETERS', a, at, before, v);
    n.revision++;
    return n;
}
export function checkConflict(b: RuleBook, v: RuleVersion) {
    const overlaps = b.versions.filter(x => x.status === 'PUBLISHED' && x.ruleId === v.ruleId && x.companyId === v.companyId && x.effectiveFrom <= (v.effectiveTo || '9999-12-31') && v.effectiveFrom <= (x.effectiveTo || '9999-12-31'));
    const ancestors = new Set<string>();
    let p = b.versions.find(x => x.versionId === v.replaces);
    while (p && !ancestors.has(p.versionId)) {
        ancestors.add(p.versionId);
        p = b.versions.find(x => x.versionId === p!.replaces);
    }
    if (v.replaces) {
        const old = b.versions.find(x => x.versionId === v.replaces);
        if (!old || old.status !== 'PUBLISHED' || old.ruleId !== v.ruleId || old.companyId !== v.companyId || v.effectiveFrom < old.effectiveFrom)
            throw Error('替代版本范围或生效日无效');
    }
    if (overlaps.some(x => !ancestors.has(x.versionId)))
        throw Error('相同范围和期间存在同级正式版本冲突，请从当前版本创建草稿');
}
export function validateDraft(s: State, id: string, a: RuleActor, at: string): State {
    const { n, v, b } = editable(s, id, a, at);
    validateVersion(v, n);
    checkConflict(b, v);
    v.status = 'VALIDATED';
    v.validationFingerprint = fingerprint(v);
    log(b, v, 'VALIDATE', a, at, null, { status: v.status });
    n.revision++;
    return n;
}
export function simulationInput(): Input { return { id: 'SIM-R008', companyId: 'SZ', departmentId: 'sales', employee: '林晓', applicantId: 'lin', grade: '普通员工', department: '销售部', expenseType: '住宿费', amountYuan: '430', hotelAmountYuan: '430', currency: 'CNY', city: '深圳', checkIn: '2026-10-31', checkOut: '2026-11-01', businessDate: '2026-10-31', hotel: '模拟酒店', partialReason: '模拟部分报销原因', accountCode: '6602.01', accountStage: '财务确认', invoices: [{ id: 'SIM-INVOICE', type: '数电发票', code: '', number: '98765432109876543210', date: '2026-10-31', sellerName: '模拟酒店', sellerTaxId: 'DEMO-SELLER', buyerName: '星河科技（深圳）有限公司', buyerTaxId: 'DEMO-SZ-001', amountYuan: '430', currency: 'CNY', source: 'manual' }] }; }
export function simulationContext(s: State, d: Input, at: string): Context {
    return { at, standards: createExampleStandards(), invoiceHistory: [], entityConfig: s.entityConfig || defaultEntities(), accountConfig: s.accountConfig || defaultAccounts(), workflowConfig: s.workflowConfig || defaultWorkflowConfig(), budgetBook: structuredClone(s.budgetBook || defaultBudgetBook()), claimRevision: 1, ruleSelections: resolveAll(s, d, at) };
}
export function runSimulation(s: State, id: string, input: Input, at: string) {
    const v = s.ruleBook?.versions.find(v => v.versionId === id);
    if (!v)
        throw Error('模拟版本不存在');
    validateVersion(v, s);
    const d = structuredClone(input);
    if (v.companyId !== '*' && d.companyId !== v.companyId)
        throw Error('模拟单法人必须与草稿适用范围一致');
    const c = simulationContext(s, d, at), selection: Selection = { ruleId: v.ruleId, version: versionSnapshot(v), date: v.ruleId === 'R001' ? d.checkIn : d.businessDate || d.checkIn, basis: '显式草稿模拟（忽略发布/生效时间，仅内存）' };
    // Explicitly compare policy changes for R006, never pretend an existing workflow is approved under new policy.
    const next = { ...c, ruleSelections: [...(c.ruleSelections || []).filter(x => x.ruleId !== v.ruleId), selection] };
    const reg = registry.filter(r => r.ruleId === v.ruleId), before = auditAll(d, c, reg)[0]!, after = auditAll(d, next, reg)[0]!;
    if (after.status === 'ERROR')
        throw Error('草稿运行失败：' + after.message);
    const checks: string[] = [];
    const guard = (bad: Input, label: string, ctx = next) => { const r = auditAll(bad, ctx, reg)[0]!; if (r.status === 'PASS')
        throw Error('发布前安全检查失败：' + label); checks.push(label); };
    if (v.ruleId === 'R001')
        guard({ ...d, hotelAmountYuan: '-1', amountYuan: '-1' }, '负数住宿不能通过');
    if (v.ruleId === 'R002') {
        const history = d.invoices.flatMap(i => { const other = { ...d, id: 'SIM-OTHER' }; return historyRow(other, { ...i, id: 'SIM-OTHER-' + i.id }, at, '已通过') || []; });
        guard(d, '确定重复不能自动通过', { ...next, invoiceHistory: history });
    }
    if (v.ruleId === 'R003')
        guard({ ...d, amountYuan: '-1' }, '负数金额不能通过');
    if (v.ruleId === 'R004')
        guard({ ...d, invoices: [] }, '缺少票据不能通过');
    if (v.ruleId === 'R005')
        guard({ ...d, accountCode: '不存在的科目' }, '错误科目不能通过');
    if (v.ruleId === 'R006')
        guard(d, '未完成业务审批不能通过');
    if (v.ruleId === 'R007')
        guard({ ...d, amountYuan: '-1' }, '负数预算申请不能通过');
    if (JSON.stringify(c.budgetBook) !== JSON.stringify(next.budgetBook))
        throw Error('模拟上下文被污染');
    // Exercise all existing registrations with identical isolated inputs; INFO/REVIEW are legitimate, ERROR is not.
    const regress = auditAll(d, next);
    if (regress.some(r => r.status === 'ERROR'))
        throw Error('发布前七规则执行回归失败：' + regress.filter(r => r.status === 'ERROR').map(r => r.ruleId + ':' + r.message).join('；'));
    checks.push('七规则真实函数执行无异常（非全套自动化测试）', '无预算流水/单据/审批写入');
    return { fingerprint: fingerprint(v), at, input: d, before, after, checks };
}
export function simulateDraft(s: State, id: string, d: Input, a: RuleActor, at: string): State {
    const { n, v, b } = editable(s, id, a, at);
    if (v.status !== 'VALIDATED' || v.validationFingerprint !== fingerprint(v))
        throw Error('请先校验最新草稿');
    const untouched = JSON.stringify([s.claims, s.budgetBook]), sim = runSimulation(n, id, d, at);
    if (untouched !== JSON.stringify([n.claims, n.budgetBook]))
        throw Error('模拟不得修改业务数据');
    v.simulation = sim;
    log(b, v, 'SIMULATE', a, at, null, sim);
    n.revision++;
    return n;
}
export function publishRule(s: State, id: string, a: RuleActor, at: string, confirmed: boolean): State {
    const { n, v, b } = editable(s, id, a, at);
    if (!confirmed)
        throw Error('发布前必须二次确认变更摘要');
    if (v.status !== 'VALIDATED' || v.validationFingerprint !== fingerprint(v) || v.simulation?.fingerprint !== fingerprint(v))
        throw Error('必须完成最新草稿校验和真实模拟后才能发布');
    validateVersion(v, n);
    checkConflict(b, v);
    runSimulation(n, id, v.simulation.input, at);
    const before = structuredClone(v);
    v.status = 'PUBLISHED';
    v.publishedAt = at;
    v.publishedBy = a.id;
    log(b, v, v.enabled ? 'PUBLISH' : 'DISABLE', a, at, before, v, '已发布；保存成功后生效');
    n.revision++;
    return n;
}
export function archiveDraft(s: State, id: string, a: RuleActor, at: string): State {
    const { n, v, b } = editable(s, id, a, at);
    const before = structuredClone(v);
    v.status = 'ARCHIVED';
    delete v.simulation;
    delete v.validationFingerprint;
    log(b, v, 'ARCHIVE_DRAFT', a, at, before, { status: v.status });
    n.revision++;
    return n;
}
export function validateRuleBook(s: State) {
    const b = s.ruleBook;
    if (!b)
        return;
    if (b.schema !== 1 || !Array.isArray(b.versions) || b.versions.length > 200 || !Array.isArray(b.logs) || b.logs.length > 800 || new Set(b.versions.map(v => v.versionId)).size !== b.versions.length || new Set(b.versions.map(v => v.ruleId + ':' + v.versionNumber)).size !== b.versions.length || new Set(b.logs.map(l => l.logId)).size !== b.logs.length)
        throw Error('规则版本库格式、容量或唯一性错误');
    for (const v of b.versions) {
        validateVersion(v, s);
        if (v.status === 'PUBLISHED' && (!nowValid(v.publishedAt!) || !v.publishedBy || v.publishedAt! < v.createdAt))
            throw Error('已发布版本时间或人员无效');
        if (v.replaces === v.versionId)
            throw Error('版本不能替代自身');
    }
    for (const l of b.logs)
        if (!l.logId || !l.operatorId || !l.operatorName || !nowValid(l.operationTime) || !l.changeReason || !b.versions.some(v => v.versionId === l.versionId))
            throw Error('规则变更记录无效');
}
