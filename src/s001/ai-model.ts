import type { State, Claim, Batch } from './types';
import type { AIWorkspace, AIConfig, AIConfigVersion, AIActor, Analysis, DemoFault, AIFeedback, FeedbackStatus } from './ai-types';
import { riskCategories, feedbackStatuses, demoFaults } from './ai-types';
import { buildAIContext, inputFingerprint } from './ai-context';
import { validateAIOutput, failureMessages } from './ai-output';
import { localDemoAnalysis } from './ai-demo';
import { PROMPT_VERSION } from './ai-prompt';
import type { Completion } from './ai-service';
export const AI_KEY = 'qingbao-r009-v1';
export const defaultAIWorkspace = (): AIWorkspace => ({ schema: 1, analyses: [], feedback: [], humanFindings: [], configVersions: [], configLogs: [] });
export const defaultAIConfig = (): AIConfigVersion => ({ id: 'AI-PRESET-V1', version: 1, status: 'PUBLISHED', config: { enabled: true, mode: 'DEMO', provider: 'LOCAL_DEMO', modelName: '关键词与预设场景模板-v1', promptVersion: PROMPT_VERSION, manualOnly: true, categories: [...riskCategories], timeoutMs: 1500, maxOutputChars: 14000, maxRiskItems: 8 }, createdAt: '2026-10-31T00:00:00.000Z', createdBy: '系统预置演示', publishedAt: '2026-10-31T00:00:00.000Z', reason: '系统预置演示配置，非企业正式制度，不调用外部模型', replaces: null });
const time = (s: string) => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const text = (s: unknown, max = 800): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
function finance(a: AIActor, at: string) { if (a?.role !== '财务' || !text(a.id, 100) || !text(a.name, 100) || !time(at))
    throw Error('仅模拟财务人员可进行AI辅助分析或反馈，人员/时间必填'); }
function admin(financial: State, a: AIActor, at: string) { if (a?.role !== '管理员' || !text(a.id, 100) || !text(a.name, 100) || !time(at))
    throw Error('仅模拟规则管理员可维护AI设置'); if (!financial.ruleBook)
    throw Error('请先在现有R008中心显式导入规则，再维护AI设置版本'); }
export function validateAIConfig(c: AIConfig) {
    const fields = ['enabled', 'mode', 'provider', 'modelName', 'promptVersion', 'manualOnly', 'categories', 'timeoutMs', 'maxOutputChars', 'maxRiskItems'];
    if (!c || Object.keys(c).length !== fields.length || Object.keys(c).some(k => !fields.includes(k)) || typeof c.enabled !== 'boolean' || c.mode !== 'DEMO' || c.provider !== 'LOCAL_DEMO' || c.modelName !== '关键词与预设场景模板-v1' || c.promptVersion !== PROMPT_VERSION || c.manualOnly !== true || !Array.isArray(c.categories) || !c.categories.length || new Set(c.categories).size !== c.categories.length || c.categories.some(x => !riskCategories.includes(x)) || !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 30000 || !Number.isSafeInteger(c.maxOutputChars) || c.maxOutputChars < 3000 || c.maxOutputChars > 30000 || !Number.isSafeInteger(c.maxRiskItems) || c.maxRiskItems < 1 || c.maxRiskItems > 10)
        throw Error('AI配置无效：仅支持本地演示/人工触发，超时100–30000毫秒，风险1–10项；不接受密钥/外部地址/可执行参数');
}
export function effectiveAIConfig(s: AIWorkspace): AIConfigVersion { return structuredClone(s.configVersions.filter(v => v.status === 'PUBLISHED').at(-1) || defaultAIConfig()); }
function validConfigVersion(v: AIConfigVersion) { validateAIConfig(v.config); if (!text(v.id, 100) || !Number.isSafeInteger(v.version) || v.version < 1 || !['DRAFT', 'VALIDATED', 'PUBLISHED'].includes(v.status) || !time(v.createdAt) || !text(v.createdBy, 100) || !text(v.reason, 500) || (v.status === 'PUBLISHED' && (!time(v.publishedAt!) || v.publishedAt! < v.createdAt)))
    throw Error('AI设置版本无效'); }
export function sourceBatch(financial: State, id: string, batchId: string): {
    claim: Claim;
    batch: Batch;
} { const claim = financial.claims.find(d => d.id === id), batch = claim?.batches.find(b => b.id === batchId); if (!claim || !batch)
    throw Error('原单据或审核批次不可访问，不生成无来源分析'); return { claim, batch }; }
export function analysisStale(r: Analysis, financial: State) { const claim = financial.claims.find(c => c.id === r.reimbursementId); return !claim || claim.revision !== r.reimbursementVersion || claim.currentBatchId !== r.auditBatchId; }
export function beginAIAnalysis(financial: State, s: AIWorkspace, id: string, batchId: string, a: AIActor, at: string, analysisId: string, options: {
    force?: boolean;
    history?: boolean;
    fault?: DemoFault;
} = {}) {
    finance(a, at);
    validateAIWorkspace(s);
    const { claim, batch } = sourceBatch(financial, id, batchId);
    if (claim.currentBatchId !== batch.id || claim.revision !== batch.revision)
        throw Error('只能分析当前有效审核批次，请先执行七规则自动审核');
    if (!['R001', 'R002', 'R003', 'R004', 'R005', 'R006', 'R007'].every(id => batch.results.some(r => r.ruleId === id)))
        throw Error('当前历史批次未执行完整七规则，请先重新自动审核；旧分析不补造');
    const config = effectiveAIConfig(s);
    if (!config.config.enabled)
        throw Error('AI辅助分析已由管理员停用，原确定性审核不受影响');
    const fault = options.fault || 'NONE';
    if (!demoFaults.includes(fault))
        throw Error('不支持的演示场景');
    const context = buildAIContext(batch, !!options.history), fp = inputFingerprint(context);
    if (s.analyses.some(r => r.reimbursementId === id && r.analysisStatus === 'RUNNING'))
        throw Error('本单已有进行中的分析，请等待、取消或结束上次中断记录');
    const prior = [...s.analyses].reverse().find(r => r.reimbursementId === id && r.auditBatchId === batchId && r.reimbursementVersion === claim.revision && r.config.id === config.id && r.fault === fault && r.historyRequested === !!options.history && r.analysisStatus === 'COMPLETED' && r.inputFingerprint === fp && JSON.stringify(r.context) === JSON.stringify(context));
    if (prior && !options.force)
        return { state: s, record: prior, reused: true };
    if (s.analyses.length >= 100 || s.analyses.filter(r => r.reimbursementId === id).length >= 30)
        throw Error('演示分析历史已达上限，保留已有记录，不自动删除');
    if (!text(analysisId, 100) || s.analyses.some(r => r.analysisId === analysisId))
        throw Error('分析编号必须唯一');
    const record: Analysis = {
        requestedBy: {id:a.id,name:a.name,role:"财务"}, analysisId, reimbursementId: id, reimbursementVersion: batch.revision, auditBatchId: batchId, analysisMode: 'DEMO', modelProvider: 'LOCAL_DEMO', modelName: config.config.modelName, promptVersion: config.config.promptVersion, config, analysisTimestamp: at, completedAt: null, inputFingerprint: fp, context, analysisStatus: 'RUNNING', structuredResult: null, errorCode: null, durationMs: null, historyRequested: !!options.history, fault };
    const n = structuredClone(s);
    n.analyses.push(record);
    return { state: n, record: structuredClone(record), reused: false };
}
export function completeAIAnalysis(s: AIWorkspace, id: string, completion: Completion, at: string): AIWorkspace {
    validateAIWorkspace(s);
    const n = structuredClone(s), r = n.analyses.find(r => r.analysisId === id);
    if (!r || r.analysisStatus !== 'RUNNING' || !time(at) || at < r.analysisTimestamp)
        throw Error('仅进行中记录可完成；不会覆盖旧分析结果');
    if (!(completion.errorCode === 'INTERRUPTED' && completion.durationMs === null) && (!Number.isSafeInteger(completion.durationMs) || completion.durationMs! < 0 || completion.durationMs! > 86400000))
        throw Error('分析耗时无效');
    if (completion.analysisStatus === 'COMPLETED') {
        if (completion.errorCode !== null || !completion.structuredResult)
            throw Error('完成状态与结果不一致');
        r.structuredResult = validateAIOutput(completion.structuredResult, r.context, r.config.config);
        r.errorCode = null;
    }
    else if (completion.analysisStatus === 'FAILED') {
        if (!completion.errorCode || !Object.hasOwn(failureMessages, completion.errorCode) || completion.structuredResult !== null)
            throw Error('失败状态无效');
        r.structuredResult = null;
        r.errorCode = completion.errorCode;
    }
    else
        throw Error('不支持的执行状态');
    r.analysisStatus = completion.analysisStatus;
    r.durationMs = completion.durationMs;
    r.completedAt = at;
    return n;
}
export function interruptAIAnalysis(s: AIWorkspace, id: string, a: AIActor, at: string) { finance(a, at); return completeAIAnalysis(s, id, { analysisStatus: 'FAILED', structuredResult: null, errorCode: 'INTERRUPTED', durationMs: null }, at); }
export function localReferenceOptions(financial: State, r: Analysis) {
    const { batch } = sourceBatch(financial, r.reimbursementId, r.auditBatchId), files = [...(batch.input.attachments || []), ...batch.input.invoices.flatMap(i => i.attachment ? [i.attachment as any] : [])];
    return [...Object.keys(r.context.evidence), ...files.filter(f => typeof f?.id === 'string').map(f => 'material:' + f.id)];
}
function feedbackReferences(refs: string[], financial: State, r: Analysis) { const allowed = localReferenceOptions(financial, r); if (!Array.isArray(refs) || refs.length > 12 || new Set(refs).size !== refs.length || refs.some(ref => !allowed.includes(ref)))
    throw Error('人工证明引用必须来自该分析批次的字段或材料'); }
export function recordAIFeedback(financial: State, s: AIWorkspace, analysisId: string, riskId: string, status: FeedbackStatus, comment: string, evidenceRefs: string[], a: AIActor, at: string): AIWorkspace {
    finance(a, at);
    validateAIWorkspace(s);
    const r = s.analyses.find(r => r.analysisId === analysisId);
    if (!r || r.analysisStatus !== 'COMPLETED' || !r.structuredResult?.riskItems.some(x => x.riskId === riskId))
        throw Error('风险反馈必须对应真实已完成的分析条目');
    if (!feedbackStatuses.includes(status) || !text(comment, 800) || s.feedback.length >= 400 || at < r.completedAt!)
        throw Error('反馈状态、原因、时间或数量无效');
    feedbackReferences(evidenceRefs, financial, r);
    const n = structuredClone(s);
    n.feedback.push({ feedbackId: crypto.randomUUID(), analysisId, riskId, reimbursementId: r.reimbursementId, reviewerId: a.id, reviewerName: a.name, feedbackStatus: status, feedbackComment: comment.trim(), createdAt: at, relatedAuditBatchId: r.auditBatchId, evidenceRefs: structuredClone(evidenceRefs) });
    return n;
}
export function addHumanFinding(financial: State, s: AIWorkspace, analysisId: string, description: string, evidenceRefs: string[], a: AIActor, at: string): AIWorkspace {
    finance(a, at);
    validateAIWorkspace(s);
    const r = s.analyses.find(r => r.analysisId === analysisId);
    if (!r || r.analysisStatus === 'RUNNING' || !text(description, 800) || !evidenceRefs.length || s.humanFindings.length >= 200 || at < r.analysisTimestamp)
        throw Error('人工发现需关联分析、具体说明和实际证据');
    feedbackReferences(evidenceRefs, financial, r);
    const n = structuredClone(s);
    n.humanFindings.push({ id: crypto.randomUUID(), analysisId, reimbursementId: r.reimbursementId, auditBatchId: r.auditBatchId, reviewerId: a.id, reviewerName: a.name, at, description: description.trim(), evidenceRefs: structuredClone(evidenceRefs), source: 'HUMAN', completeGroundTruth: false });
    return n;
}
export function feedbackStatistics(s: AIWorkspace) {
    validateAIWorkspace(s);
    const risks = s.analyses.flatMap(r => (r.structuredResult?.riskItems || []).map(item => ({ analysisId: r.analysisId, riskId: item.riskId }))), latest = risks.map(r => [...s.feedback].reverse().find(f => f.analysisId === r.analysisId && f.riskId === r.riskId)?.feedbackStatus || 'UNREVIEWED');
    const valid = latest.filter(x => x === 'CONFIRMED_VALID').length, falsePositive = latest.filter(x => x === 'FALSE_POSITIVE').length, ignored = latest.filter(x => x === 'IGNORED').length, needInfo = latest.filter(x => x === 'NEED_MORE_INFO').length, labeled = valid + falsePositive, finished = s.analyses.filter(r => r.durationMs !== null);
    return { documents: new Set(s.analyses.map(r => r.reimbursementId)).size, analyses: s.analyses.length, risks: risks.length, reviewed: valid + falsePositive + ignored, valid, falsePositive, ignored, needInfo, pending: risks.length - valid - falsePositive - ignored, labeled, falsePositiveRate: labeled ? falsePositive / labeled : null, falseNegativeRate: null, failures: s.analyses.filter(r => r.analysisStatus === 'FAILED').length, running: s.analyses.filter(r => r.analysisStatus === 'RUNNING').length, meanDurationMs: finished.length ? Math.round(finished.reduce((sum, r) => sum + r.durationMs!, 0) / finished.length) : null, humanFindings: s.humanFindings.length, modelCost: null };
}
function configLog(s: AIWorkspace, v: AIConfigVersion, a: AIActor, at: string, action: string, before: unknown, after: unknown) { s.configLogs.push({ id: crypto.randomUUID(), versionId: v.id, action, actorId: a.id, actorName: a.name, at, reason: v.reason, before: structuredClone(before), after: structuredClone(after) }); }
const configFingerprint = (v: AIConfigVersion) => inputFingerprint([v.config, v.reason, v.replaces]);
export function draftAIConfig(financial: State, s: AIWorkspace, a: AIActor, at: string, sourceId?: string): AIWorkspace {
    admin(financial, a, at);
    validateAIWorkspace(s);
    const n = structuredClone(s), current = effectiveAIConfig(s), source = sourceId ? s.configVersions.find(v => v.id === sourceId) || (sourceId === defaultAIConfig().id ? defaultAIConfig() : undefined) : current;
    if (!source)
        throw Error('设置来源不存在');
    if (n.configVersions.length >= 40)
        throw Error('设置版本已达上限，不删除历史');
    const v: AIConfigVersion = { id: crypto.randomUUID(), version: Math.max(1, ...s.configVersions.map(v => v.version)) + 1, status: 'DRAFT', config: structuredClone(source.config), createdAt: at, createdBy: a.id, publishedAt: null, reason: '填写本次演示设置修改原因', replaces: current.id };
    n.configVersions.push(v);
    configLog(n, v, a, at, 'CREATE_DRAFT', source, v);
    return n;
}
function editableConfig(financial: State, s: AIWorkspace, id: string, a: AIActor, at: string) { admin(financial, a, at); validateAIWorkspace(s); const n = structuredClone(s), v = n.configVersions.find(v => v.id === id); if (!v || v.status === 'PUBLISHED')
    throw Error('已发布AI设置只读，请创建新草稿'); return { n, v }; }
export function saveAIConfig(financial: State, s: AIWorkspace, id: string, config: AIConfig, reason: string, a: AIActor, at: string): AIWorkspace {
    const { n, v } = editableConfig(financial, s, id, a, at), before = structuredClone(v);
    validateAIConfig(config);
    if (!text(reason, 500))
        throw Error('设置变更原因必填');
    v.config = structuredClone(config);
    v.reason = reason.trim();
    v.status = 'DRAFT';
    delete v.validatedFingerprint;
    delete v.testedFingerprint;
    configLog(n, v, a, at, 'SAVE_DRAFT', before, v);
    return n;
}
export function validateAIConfigDraft(financial: State, s: AIWorkspace, id: string, a: AIActor, at: string): AIWorkspace {
    const { n, v } = editableConfig(financial, s, id, a, at);
    validateAIConfig(v.config);
    if (v.replaces !== effectiveAIConfig(s).id)
        throw Error('当前正式设置已变化，草稿来源冲突，请重新复制');
    v.status = 'VALIDATED';
    v.validatedFingerprint = configFingerprint(v);
    configLog(n, v, a, at, 'VALIDATE', null, { fingerprint: v.validatedFingerprint });
    return n;
}
export function testAIConfigDraft(financial: State, s: AIWorkspace, id: string, context: import('./ai-types').AIContext, a: AIActor, at: string): AIWorkspace {
    const { n, v } = editableConfig(financial, s, id, a, at);
    if (v.status !== 'VALIDATED' || v.validatedFingerprint !== configFingerprint(v))
        throw Error('请先校验最新设置');
    const output = validateAIOutput(localDemoAnalysis(context, v.config), context, v.config);
    v.testedFingerprint = configFingerprint(v);
    configLog(n, v, a, at, 'DEMO_SELF_TEST', null, { assessment: output.assessment, risks: output.riskItems.length, inputSource: '内置虚构自检样本，非真实模型测试' });
    return n;
}
export function publishAIConfig(financial: State, s: AIWorkspace, id: string, a: AIActor, at: string, confirmed: boolean): AIWorkspace {
    const { n, v } = editableConfig(financial, s, id, a, at);
    if (!confirmed || v.status !== 'VALIDATED' || v.validatedFingerprint !== configFingerprint(v) || v.testedFingerprint !== configFingerprint(v))
        throw Error('发布需最新校验、自检和二次确认');
    if (v.replaces !== effectiveAIConfig(s).id)
        throw Error('当前正式设置已变化，存在发布冲突');
    const before = structuredClone(v);
    v.status = 'PUBLISHED';
    v.publishedAt = at;
    configLog(n, v, a, at, 'PUBLISH', before, v);
    return n;
}
// AI store is independent of the financial store, so malformed/failed AI records cannot stop R001–R008.
export function validateAIWorkspace(s: AIWorkspace) {
    if (!s || s.schema !== 1 || !Array.isArray(s.analyses) || s.analyses.length > 100 || !Array.isArray(s.feedback) || s.feedback.length > 400 || !Array.isArray(s.humanFindings) || s.humanFindings.length > 200 || !Array.isArray(s.configVersions) || s.configVersions.length > 40 || !Array.isArray(s.configLogs) || s.configLogs.length > 200)
        throw Error('AI演示记录格式或容量异常；不覆盖原值，原七规则不受影响');
    for (const [rows, key] of [[s.analyses, 'analysisId'], [s.feedback, 'feedbackId'], [s.humanFindings, 'id'], [s.configVersions, 'id'], [s.configLogs, 'id']] as const)
        if (new Set(rows.map((x: any) => x[key])).size !== rows.length)
            throw Error('AI记录编号重复');
    if (new Set(s.configVersions.map(v => v.version)).size !== s.configVersions.length)
        throw Error('AI设置版本重复');
    for (const v of s.configVersions)
        validConfigVersion(v);
    for (const r of s.analyses) {
        validConfigVersion(r.config);
        if(r.requestedBy && (!text(r.requestedBy.id,100)||!text(r.requestedBy.name,100)||r.requestedBy.role!=="财务"))throw Error("AI发起人记录无效");
        if (r.config.status !== 'PUBLISHED' || !r.config.config.enabled)
            throw Error('分析必须使用启用的正式演示设置');
        if (!text(r.analysisId, 100) || !text(r.reimbursementId, 100) || !text(r.auditBatchId, 100) || !Number.isSafeInteger(r.reimbursementVersion) || r.reimbursementVersion < 1 || r.analysisMode !== 'DEMO' || r.modelProvider !== 'LOCAL_DEMO' || r.modelName !== r.config.config.modelName || r.promptVersion !== r.config.config.promptVersion || !time(r.analysisTimestamp) || !['RUNNING', 'COMPLETED', 'FAILED'].includes(r.analysisStatus) || !demoFaults.includes(r.fault) || typeof r.historyRequested !== 'boolean' || r.context?.schema !== 1 || r.context.reimbursementVersion !== r.reimbursementVersion || r.inputFingerprint !== inputFingerprint(r.context))
            throw Error('AI分析版本、模式或上下文无效');
        if (r.analysisStatus === 'RUNNING') {
            if (r.completedAt !== null || r.structuredResult !== null || r.errorCode !== null || r.durationMs !== null)
                throw Error('AI进行中状态异常');
        }
        else {
            if (!time(r.completedAt!) || r.completedAt! < r.analysisTimestamp || (!(r.errorCode === 'INTERRUPTED' && r.durationMs === null) && (!Number.isSafeInteger(r.durationMs) || r.durationMs! < 0 || r.durationMs! > 86400000)))
                throw Error('AI完成时间或耗时无效');
            if (r.analysisStatus === 'COMPLETED') {
                if (r.errorCode !== null || !r.structuredResult)
                    throw Error('AI完成结果缺失');
                validateAIOutput(r.structuredResult, r.context, r.config.config);
            }
            else if (r.structuredResult !== null || !r.errorCode || !Object.hasOwn(failureMessages, r.errorCode))
                throw Error('AI失败记录错误');
        }
    }
    for (const f of s.feedback) {
        const r = s.analyses.find(r => r.analysisId === f.analysisId);
        if (!r?.structuredResult?.riskItems.some(x => x.riskId === f.riskId) || f.reimbursementId !== r.reimbursementId || f.relatedAuditBatchId !== r.auditBatchId || !feedbackStatuses.includes(f.feedbackStatus) || !text(f.feedbackComment) || !text(f.reviewerId, 100) || !text(f.reviewerName, 100) || !time(f.createdAt) || f.createdAt < r.completedAt! || !Array.isArray(f.evidenceRefs))
            throw Error('AI人工反馈关联或内容无效');
    }
    for (const f of s.humanFindings) {
        const r = s.analyses.find(r => r.analysisId === f.analysisId);
        if (!r || f.reimbursementId !== r.reimbursementId || f.auditBatchId !== r.auditBatchId || !text(f.description) || !text(f.reviewerId, 100) || !text(f.reviewerName, 100) || !time(f.at) || !Array.isArray(f.evidenceRefs) || !f.evidenceRefs.length || f.source !== 'HUMAN' || f.completeGroundTruth !== false)
            throw Error('人工发现记录无效');
    }
    for (const l of s.configLogs)
        if (!text(l.id, 100) || !s.configVersions.some(v => v.id === l.versionId) || !text(l.actorId, 100) || !text(l.actorName, 100) || !time(l.at) || !text(l.reason, 500))
            throw Error('AI设置日志无效');
}
export function loadAI(storage: Pick<Storage, 'getItem'>) { const raw = storage.getItem(AI_KEY), state = raw === null ? defaultAIWorkspace() : JSON.parse(raw) as AIWorkspace; validateAIWorkspace(state); return { state, raw }; }
export function saveAI(storage: Pick<Storage, 'getItem' | 'setItem'>, s: AIWorkspace, raw: string | null) { validateAIWorkspace(s); const json = JSON.stringify(s); if (json.length > 450000)
    throw Error('AI演示记录容量已达上限，保留所有记录，不自动删除'); if (storage.getItem(AI_KEY) !== raw)
    throw Error('AI记录已在其他页面变化，请刷新后重试'); try {
    storage.setItem(AI_KEY, json);
}
catch {
    throw Error('AI记录保存失败或配额不足，原分析和财务数据保留，可重试');
} }
