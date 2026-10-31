import { parseYuan } from '../r001/rule';
import { riskCategories, type AIContext, type AIConfig, type AIOutput } from './ai-types';
export class AnalysisFailure extends Error {
    constructor(public code: string) { super(code); }
}
function fail(code: string): never { throw new AnalysisFailure(code); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).length !== allowed.length || Object.keys(v).some(k => !allowed.includes(k)))
    fail('OUTPUT_SCHEMA'); }
const text = (s: unknown, max = 600): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
function strings(a: unknown, min = 1, max = 12): a is string[] { return Array.isArray(a) && a.length >= min && a.length <= max && a.every(s => text(s)); }
function refs(a: unknown, c: AIContext, min = 1): asserts a is string[] { if (!strings(a, min, 10) || new Set(a).size !== a.length)
    fail('OUTPUT_SCHEMA'); for (const ref of a)
    if (!Object.hasOwn(c.evidence, ref))
        fail('EVIDENCE_NOT_FOUND'); }
function groundedText(texts: string[], referenceIds: string[], c: AIContext) {
    const evidence = referenceIds.map(id => c.evidence[id]!), all = texts.join('\n');
    if (/(?:自动|直接|立即|已执行).{0,8}(?:批准|付款|释放预算|修改规则|发布规则|删除报销|审核通过)/.test(all))
        fail('UNSAFE_ACTION');
    if (/(?:已证实|确定存在|认定为).{0,8}(?:舞弊|骗报|虚假报销|偷税)/.test(all))
        fail('UNSAFE_ASSERTION');
    for (const clause of all.match(/第[\d一二三四五六七八九十百]+条/g) || [])
        if (!referenceIds.some(id => id.startsWith('policy.') && c.evidence[id]!.value.includes(clause)))
            fail('POLICY_UNSUPPORTED');
    if (/行业平均|行业均值/.test(all))
        fail('POLICY_UNSUPPORTED');
    if (/历史平均|历史均值|企业平均|公司均值|样本均值/.test(all) && (!c.historySummary || !referenceIds.includes('history.demo')))
        fail('HISTORY_UNSUPPORTED');
    for (const m of all.matchAll(/(-?\d+(?:\.\d{1,2})?)\s*(元|晚|%|笔)/g)) {
        const unit = m[2]!, raw = m[1]!, n = unit === '元' ? parseYuan(raw.replace(/^-/, '').trim()) : null;
        const value = unit === '元' ? (n?.ok ? n.cents * (raw.startsWith('-') ? -1 : 1) : NaN) : Number(raw);
        if (!evidence.some(e => e.numericClaims.some(k => k.unit === unit && k.value === value)))
            fail('NUMERIC_UNSUPPORTED');
    }
}
export function validateAIOutput(raw: unknown, c: AIContext, config: AIConfig): AIOutput {
    let value: unknown;
    try {
        const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
        if (!serialized || serialized.length > config.maxOutputChars)
            fail('OUTPUT_SIZE');
        value = JSON.parse(serialized);
    }
    catch (e) {
        if (e instanceof AnalysisFailure)
            throw e;
        return fail('OUTPUT_JSON');
    }
    if (!object(value))
        fail('OUTPUT_SCHEMA');
    keys(value, ['analysisStatus', 'assessment', 'summary', 'riskItems', 'ruleExplanation', 'limitations', 'requiresHumanReview']);
    if (value.analysisStatus !== 'COMPLETED' || !['POTENTIAL_RISK', 'NO_ADDITIONAL_ISSUE', 'INSUFFICIENT_DATA'].includes(String(value.assessment)) || !text(value.summary) || !Array.isArray(value.riskItems) || value.riskItems.length > config.maxRiskItems || !strings(value.limitations) || value.requiresHumanReview !== true)
        fail('OUTPUT_SCHEMA');
    const ids = new Set<string>();
    for (const risk of value.riskItems) {
        if (!object(risk))
            fail('OUTPUT_SCHEMA');
        keys(risk, ['riskId', 'riskCategory', 'riskLevel', 'description', 'evidenceRefs', 'evidenceQuotes', 'verificationQuestions', 'suggestedAction']);
        if (!text(risk.riskId, 80) || ids.has(risk.riskId) || !riskCategories.includes(risk.riskCategory as any) || !config.categories.includes(risk.riskCategory as any) || !['LOW', 'MEDIUM', 'HIGH'].includes(String(risk.riskLevel)) || !text(risk.description) || !strings(risk.verificationQuestions) || !text(risk.suggestedAction) || !Array.isArray(risk.evidenceQuotes) || !risk.evidenceQuotes.length || risk.evidenceQuotes.length > 10)
            fail('OUTPUT_SCHEMA');
        ids.add(risk.riskId);
        refs(risk.evidenceRefs, c);
        for (const q of risk.evidenceQuotes) {
            if (!object(q))
                fail('OUTPUT_SCHEMA');
            keys(q, ['ref', 'quote']);
            if (!text(q.ref, 120) || !risk.evidenceRefs.includes(q.ref) || !text(q.quote, 300) || !c.evidence[q.ref]!.value.includes(q.quote))
                fail('EVIDENCE_QUOTE');
        }
        groundedText([risk.description, ...risk.verificationQuestions, risk.suggestedAction], risk.evidenceRefs, c);
    }
    if ((value.assessment === 'POTENTIAL_RISK') !== (value.riskItems.length > 0))
        fail('OUTPUT_SCHEMA');
    const explanation = value.ruleExplanation;
    if (!object(explanation))
        fail('OUTPUT_SCHEMA');
    keys(explanation, ['summary', 'evidenceRefs', 'verificationQuestions', 'suggestedAction']);
    if (!text(explanation.summary) || !strings(explanation.verificationQuestions) || !text(explanation.suggestedAction))
        fail('OUTPUT_SCHEMA');
    refs(explanation.evidenceRefs, c, 0);
    groundedText([explanation.summary, ...explanation.verificationQuestions, explanation.suggestedAction], explanation.evidenceRefs, c);
    groundedText([value.summary, ...value.limitations], Object.keys(c.evidence), c);
    return value as unknown as AIOutput;
}
export const failureMessages: Record<string, string> = { TIMEOUT: '演示服务超时，原七规则与财务流程仍可使用。', CANCELLED: '本次分析已取消，未改变报销审批。', INTERRUPTED: '上次页面会话已中断，可重新分析。', SERVICE_UNAVAILABLE: '演示服务不可用，请重试或继续原审核。', OUTPUT_JSON: '返回内容不是有效JSON，未接受为有效分析。', OUTPUT_SCHEMA: '输出字段/风险等级/操作结构不符合约定，未接受该结果。', OUTPUT_SIZE: '返回内容超过本次输出上限。', EVIDENCE_NOT_FOUND: '分析引用不存在的证据/制度，结果校验失败。', EVIDENCE_QUOTE: '分析引文与实际输入不匹配，结果校验失败。', POLICY_UNSUPPORTED: '分析包含无法核实的制度或行业断言，结果校验失败。', HISTORY_UNSUPPORTED: '没有对应历史依据，不能引用均值。', NUMERIC_UNSUPPORTED: '分析包含输入证据不支持的数值，结果校验失败。', UNSAFE_ACTION: '分析包含不允许的直接操作，结果已拒绝。', UNSAFE_ASSERTION: '分析将推测定性为确定违规，结果已拒绝。', REAL_NOT_CONFIGURED: '当前没有安全且获授权的真实模型服务；只能使用演示模式。' };
