import type { AIContext, AIConfig, AIOutput, AIRisk, RiskCategory } from './ai-types';
// Transparent local pattern templates. This is NOT a language model and is labeled as such in every view.
export function localDemoAnalysis(c: AIContext, config: AIConfig): AIOutput {
    const d = c.reimbursement, risks: AIRisk[] = [], description = d.businessDescription;
    const add = (id: string, category: RiskCategory, text: string, referenceIds: string[], quote: {
        ref: string;
        quote: string;
    }, questions: string[], suggestedAction: string) => { if (!config.categories.includes(category))
        return; risks.push({ riskId: id, riskCategory: category, riskLevel: 'MEDIUM', description: text, evidenceRefs: referenceIds, evidenceQuotes: [quote], verificationQuestions: questions, suggestedAction }); };
    const family = description.match(/家庭旅行|家庭旅游|私人旅行|个人旅游/);
    if (d.expenseType === '住宿费' && family)
        add('DEMO-PURPOSE', 'BUSINESS_PURPOSE', '说明出现个人或家庭旅行字样，可能与公务住宿用途不一致，需要核实，尚不能认定违规。', ['reimbursement.businessDescription', 'reimbursement.expenseType'], { ref: 'reimbursement.businessDescription', quote: family[0] }, ['此次住宿是否对应公司业务活动及批准的出差？'], '核对业务背景和原出差审批，不仅凭关键词判断。');
    const extension = description.match(/.{0,20}个人.{0,16}(?:延住|安排).{0,15}|.{0,20}自行延住.{0,15}/u);
    if (extension && d.expenseType === '住宿费')
        add('DEMO-EXTENSION', 'PERSONAL_EXTENSION', d.stay.nights !== null && d.stay.nights >= 3 ? '说明提及个人延住，当前住宿日期覆盖多晚；仍需确认个人部分是否确已计入申请。' : '说明提及个人延住，但当前日期和金额不足以证明该晚已计入；先核对明细。', ['reimbursement.businessDescription', 'reimbursement.lodging'], { ref: 'reimbursement.businessDescription', quote: extension[0] }, ['公务与个人住宿各有哪些日期？', '所填申请是否已经剔除个人承担的费用？'], '对照酒店水单、出差安排及实际费用归属；不自行扣减金额。');
    if (description.trim() && (/^(公司业务需要|业务需要|报销费用|见附件|其他)[。.!！ ]*$/.test(description) || description.trim().length <= 4))
        add('DEMO-VAGUE', 'VAGUE_DESCRIPTION', '说明较为笼统，现有资料难以理解具体业务背景；这只是补充建议，不声称违反未提供的制度。', ['reimbursement.businessDescription'], { ref: 'reimbursement.businessDescription', quote: description.slice(0, 100) }, ['具体业务事项、对象或目的是什么？'], '补充与费用相关的业务背景后由财务核实。');
    const instruction = description.match(/.{0,12}(?:忽略.{0,20}(?:规则|指令)|直接.{0,10}(?:通过|批准)|system\s*prompt).{0,30}/iu);
    if (instruction)
        add('DEMO-INPUT', 'UNTRUSTED_INPUT', '业务字段出现指令式文字，按待核实数据处理，不授予其任何操作权限。', ['reimbursement.businessDescription'], { ref: 'reimbursement.businessDescription', quote: instruction[0] }, ['该文字是否属于真实业务说明，需要更正或补充吗？'], '核查原始业务含义；保持原规则和人工审批流程。');
    if (c.historySummary && d.amountCents !== null && d.amountCents > c.historySummary.maxCents)
        add('DEMO-HISTORY', 'HISTORY_COMPARISON', '申请高于本次明确提供的虚构同类样本，样本均值400.00元仅供演示比较，不能视为企业或行业常规标准。', ['reimbursement.amount', 'history.demo'], { ref: 'history.demo', quote: '样本均值400.00元' }, ['本次业务规模与这些虚构样本是否可比？', '是否有具体参与人数、事项和金额依据？'], '核实业务背景和可比性，不因高于样本就定性违规。');
    const abnormal = c.auditResults.filter(r => !['PASS', 'NOT_APPLICABLE'].includes(r.status));
    const r2 = abnormal.find(r => r.ruleId === 'R002');
    const result: AIOutput = { analysisStatus: 'COMPLETED', assessment: risks.length ? 'POTENTIAL_RISK' : !description.trim() ? 'INSUFFICIENT_DATA' : 'NO_ADDITIONAL_ISSUE', summary: risks.length ? '预设演示场景发现值得人工核实的线索，不能据此认定违规。' : !description.trim() ? '缺少业务说明，无法判断业务背景，请补充后再分析。' : '在当前预设演示范围内，暂未发现新增线索；这不代表整单合规或风险已排除。', riskItems: risks.slice(0, config.maxRiskItems), ruleExplanation: { summary: abnormal.length ? '原确定性审核需处理：' + abnormal.map(r => r.ruleId + ' ' + r.status).join('、') + '。以下解释不改变这些结果。' : (c.auditResults.length ? '本批次所提供的确定性结果未列出异常；仍须遵守独立财务复核要求。' : '自检样本未提供确定性规则结果，不能推断财务合规。'), evidenceRefs: abnormal.map(r => 'audit.' + r.ruleId), verificationQuestions: r2 ? ['按R002既有匹配记录核对原票和消费事项，疑似匹配本身不证明重复。', '先核对金额和票据，再补齐适用的审批及材料。'] : ['先核对金额和票据，再按每条原规则补齐业务、审批及材料。'], suggestedAction: '逐项查看原规则依据，由财务人员核实和独立复核，不用辅助建议替代原拦截条件。' }, limitations: [...c.limitations, '本次为预设模板/关键词演示，不是大模型推理；未发现线索不表示没有风险。', c.historySummary ? '比较样本为显式选择的虚构记录，没有真实企业统计。' : '未提供历史比较样本，不推断企业往来规律或行业标准。'], requiresHumanReview: true };
    return result;
}
