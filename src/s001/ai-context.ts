import { calculateNights, parseYuan, centsToYuan } from '../r001/rule';
import type { Batch } from './types';
import type { AIContext, Evidence } from './ai-types';
const cents = (s: string) => { const n = parseYuan(s); return n.ok ? n.cents : null; };
const money = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) ? (n < 0 ? '-' + centsToYuan(-n) : centsToYuan(n)) + '元' : '资料不足';
export function inputFingerprint(value: unknown): string {
    let h = 14695981039346656037n;
    for (const c of JSON.stringify(value)) {
        h ^= BigInt(c.codePointAt(0)!);
        h = BigInt.asUintN(64, h * 1099511628211n);
    }
    return h.toString(16).padStart(16, '0');
}
// No attachments, account numbers, tax identifiers, raw invoice numbers, people, or full histories.
export function buildAIContext(b: Batch, useDemoHistory = false): AIContext {
    const d = b.input, known = [d.employee, d.hotel, d.companyId || '', ...d.invoices.flatMap(i => [i.buyerName, i.sellerName, i.buyerTaxId, i.sellerTaxId, i.number, i.code]), ...(b.context.entityConfig?.companies.flatMap(c => [c.companyName, c.taxpayerId, ...c.companyAliases.flatMap(a => [a.name, a.taxpayerId || ''])]) || []), ...(b.context.workflow?.org.people.map(p => p.name) || [])].filter(s => s.length >= 2).sort((a, b) => b.length - a.length);
    const redact = (s: unknown) => { let t = String(s ?? '').normalize('NFKC'); for (const token of known)
        t = t.split(token).join('[标识已隐藏]'); return t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已隐藏]').replace(/\b(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}\b/g, '[手机号已隐藏]').replace(/\b(?:\d[ -]?){15,19}[Xx]?\b/g, '[长编号已隐藏]').replace(/\b\d{8,}[\dXx]?\b/g, '[长编号已隐藏]').replace(/\b[A-Za-z0-9]{15,}\b/g, '[编号已隐藏]').slice(0, 600); };
    const lodging = d.expenseType === '住宿费';
    const r1 = b.results.find(r => r.ruleId === 'R001')?.evidence as any;
    const context: AIContext = { schema: 1, reimbursementId: 'CURRENT-CLAIM', reimbursementVersion: b.revision, companyId: 'CURRENT-COMPANY', reimbursement: { expenseType: redact(d.expenseType), amountCents: cents(d.amountYuan), currency: d.currency === 'CNY' ? 'CNY' : 'UNSUPPORTED', expenseDate: redact(d.businessDate || (d.expenseType === '住宿费' ? d.checkIn : '')), city: lodging ? redact(d.city) : '', grade: lodging ? redact(d.grade) : '', businessDescription: redact(d.businessDescription), partialReason: redact(d.partialReason), stay: lodging ? { checkIn: redact(d.checkIn), checkOut: redact(d.checkOut), nights: calculateNights(d.checkIn, d.checkOut), amountCents: cents(d.hotelAmountYuan) } : {checkIn:'',checkOut:'',nights:null,amountCents:null} }, invoiceSummary: [], auditResults: [], policyReferences: [], historySummary: null, evidence: {}, limitations: ['仅分析所提供的脱敏字段和规则结果；未读取原件正文或公司完整财务资料。', '关键词演示可能遗漏语义或产生误报，不代表大模型准确性；人工仍须核实。'] };
    const ev = (ref: string, label: string, value: string, numericClaims: Evidence['numericClaims'] = []) => { context.evidence[ref] = { label, value: redact(value), numericClaims }; };
    ev('reimbursement.businessDescription', '业务说明', context.reimbursement.businessDescription);
    ev('reimbursement.amount', '申请金额', money(context.reimbursement.amountCents), context.reimbursement.amountCents === null ? [] : [{ unit: '元', value: context.reimbursement.amountCents }]);
    ev('reimbursement.expenseType', '费用类型', d.expenseType);
    ev('reimbursement.lodging', '住宿日期与所填金额', lodging ? `入住${d.checkIn || '未填'}，退房${d.checkOut || '未填'}，住宿${context.reimbursement.stay.nights ?? '未知'}晚，住宿申请${money(context.reimbursement.stay.amountCents)}；该记录不证明个人延住已纳入报销。` : "当前费用非住宿，未提供适用住宿明细。", [...(context.reimbursement.stay.nights === null ? [] : [{ unit: '晚' as const, value: context.reimbursement.stay.nights }]), ...(context.reimbursement.stay.amountCents === null ? [] : [{ unit: '元' as const, value: context.reimbursement.stay.amountCents }])]);
    const merchantMap = new Map<string, string>();
    context.invoiceSummary = d.invoices.map((i, index) => { if (!merchantMap.has(i.sellerName))
        merchantMap.set(i.sellerName, '商户' + (merchantMap.size + 1)); return { ref: 'I' + (index + 1), type: redact(i.type), date: redact(i.date), amountCents: cents(i.amountYuan), currency: i.currency === 'CNY' ? 'CNY' : 'UNSUPPORTED', merchant: i.sellerName ? merchantMap.get(i.sellerName)! : '未提供' }; });
    for (const r of b.results) {
        const e = r.evidence as any, facts: Record<string, unknown> = {}, claims: Evidence['numericClaims'] = [];
        if (r.ruleId === 'R001' && e) {
            Object.assign(facts, { nightlyRateCents: e.standardSnapshot?.nightlyRateCents ?? null, nights: e.nights ?? null, limitCents: e.limitCents ?? null, excessCents: e.excessCents ?? null });
        }
        if (r.ruleId === 'R002' && Array.isArray(e)) {
            Object.assign(facts, { exactCount: e.reduce((s, v) => s + (v.exactCount || 0), 0), potentialCount: e.reduce((s, v) => s + (v.potentialCount || 0), 0), matches: e.flatMap(v => (v.matches || []).map((m: any) => ({ kind: m.kind, date: m.historical?.invoice?.issueDate || '', amountCents: m.historical?.invoice?.amountCents ?? null, businessStatus: m.historical?.businessStatus || '' }))).slice(0, 20) });
        }
        if (r.ruleId === 'R003' && e)
            Object.assign(facts, { amountCents: e.amountCents ?? null, invoiceTotalCents: e.invoiceTotalCents ?? null, differenceCents: e.differenceCents ?? null });
        if (r.ruleId === 'R004' && e)
            Object.assign(facts, { invoiceStatuses: (e.details || []).map((x: any) => x.status) });
        if (r.ruleId === 'R005' && e)
            Object.assign(facts, { selectedAccountCode: redact(e.selectedAccountCode), recommendedAccountCode: redact(e.recommendedAccountCode), allowedAccountCodes: (e.allowedAccountCodes || []).map(redact) });
        if (r.ruleId === 'R006' && e)
            Object.assign(facts, { approvalStatus: e.approval?.status || 'UNKNOWN', attachmentsStatus: e.attachments?.status || 'UNKNOWN' });
        if (r.ruleId === 'R007' && e)
            Object.assign(facts, { availableForCurrentCents: e.availableForCurrentCents ?? null, excessCents: e.excessCents ?? null, controlMode: e.controlMode || '', warnings: e.warnings || [] });
        for (const [key, value] of Object.entries(facts))
            if (key.endsWith('Cents') && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
                claims.push({ unit: '元', value });
        const message = redact(r.message);
        context.auditResults.push({ ruleId: r.ruleId, ruleKey: r.ruleKey, status: r.status, message, facts });
        const numbers = Object.entries(facts).filter(([k, v]) => k.endsWith('Cents') && Number.isSafeInteger(v)).map(([k, v]) => `${({ nightlyRateCents: '每晚标准', limitCents: '限额', excessCents: '超额', amountCents: '申请金额', invoiceTotalCents: '发票合计', differenceCents: '金额差异', availableForCurrentCents: '可用预算' } as Record<string, string>)[k] || k} ${money(v)}`).join('；');
        ev('audit.' + r.ruleId, `${r.ruleId} 原确定性审核结果`, `${r.ruleId} ${r.status}：${message}${numbers ? '；' + numbers : ''}`, claims);
        const v = r.configuration?.version, legacyVersion = r.ruleId === 'R001' ? r1?.standardSnapshot?.catalogVersion : e?.configVersion ?? e?.policyVersion ?? e?.budget?.version;
        const summary = `${r.ruleId} ${v ? 'R008发布版本' + v.versionNumber : '原审核证据版本' + (legacyVersion ?? '不可确认')}；${numbers || '仅提供本批次结果，不补造条款'}。`;
        const p = { ref: 'policy.' + r.ruleId, ruleId: r.ruleId, versionId: v?.versionId || null, versionNumber: v?.versionNumber ?? (Number.isSafeInteger(legacyVersion) ? legacyVersion : null), basis: v ? '批次中的R008不可变配置快照' : '本批次原证据；统一版本不可确认', summary: redact(summary) };
        if (v || Number.isSafeInteger(legacyVersion) && legacyVersion >= 1) {
            context.policyReferences.push(p);
            ev(p.ref, `${r.ruleId} 实际制度摘要`, p.summary, claims);
        }
    }
    if (useDemoHistory && d.expenseType === '业务招待费' && d.currency === 'CNY' && context.reimbursement.expenseDate >= '2026-10-10' && context.reimbursement.expenseDate <= '2026-10-31') {
        const samples = [{ date: '2026-10-01', amountCents: 30000 }, { date: '2026-10-05', amountCents: 40000 }, { date: '2026-10-10', amountCents: 50000 }];
        context.historySummary = { source: 'EXPLICIT_DEMO_FIXTURE', label: '显式选择的3条虚构同类比较样本，非本企业真实历史/行业数据', currency: 'CNY', expenseType: '业务招待费', period: '2026-10', samples, meanCents: 40000, maxCents: 50000 };
        ev('history.demo', '虚构比较样本', '显式演示样本3笔：300.00元、400.00元、500.00元，样本均值400.00元；非企业真实历史或行业均值。', [{ unit: '笔', value: 3 }, ...samples.map(x => ({ unit: '元' as const, value: x.amountCents }))]);
    }
    else if (useDemoHistory)
        context.limitations.push('所选历史比较样本仅适用于2026年10月10日至31日的人民币业务招待费，当前不适用，未提供历史比较数据。');
    return context;
}
