import { load as loadFinancial } from './model.ts';
import { AI_KEY, loadAI, saveAI, defaultAIConfig, effectiveAIConfig, beginAIAnalysis, completeAIAnalysis, interruptAIAnalysis, recordAIFeedback, addHumanFinding, feedbackStatistics, analysisStale, localReferenceOptions, draftAIConfig, saveAIConfig, validateAIConfigDraft, testAIConfigDraft, publishAIConfig } from './ai-model.ts';
import { executeAIService } from './ai-service.ts';
import { failureMessages } from './ai-output.ts';
import { aiSelfTestContext } from './ai-evaluation.ts';
import { LOCAL_DEMO_NOTICE } from './ai-prompt.ts';
import { riskCategories } from './ai-types.ts';
import { escapeHtml as esc, displayTime, formatYuan as yuan } from '../shared/audit-ui';
const selected = new Map(), jobs = new Map(), unsaved = new Map();
let settingsSelection = '';
const categoryNames = { BUSINESS_PURPOSE: '业务用途', VAGUE_DESCRIPTION: '说明完整性', PERSONAL_EXTENSION: '个人延住', HISTORY_COMPARISON: '比较样本', UNTRUSTED_INPUT: '指令式输入' };
const assessmentNames = { POTENTIAL_RISK: '发现待核实线索', NO_ADDITIONAL_ISSUE: '未发现新增线索', INSUFFICIENT_DATA: '信息不足' };
const feedbackNames = { CONFIRMED_VALID: '有效提示（仍需核实事实）', FALSE_POSITIVE: '误报', NEED_MORE_INFO: '需要补充信息', IGNORED: '忽略不适用建议', UNREVIEWED: '尚未复核' };
const stateName = r => r.analysisStatus === 'COMPLETED' ? assessmentNames[r.structuredResult.assessment] : r.analysisStatus === 'RUNNING' ? '分析中 / 会话中断后可结束' : '分析失败';
const opts = (rows, v) => rows.map(([key, text]) => `<option value="${esc(key)}" ${key === v ? 'selected' : ''}>${esc(text)}</option>`).join('');
const errorHtml = error => `<p class="risk" role="alert">${esc(error)}</p>`;
function statsBody(s) { const n = feedbackStatistics(s); return `<div class="r009-metrics">${[['documents', '分析单据（去重）', n.documents], ['analyses', '分析批次', n.analyses], ['risks', '演示风险提示', n.risks], ['reviewed', '已处理提示', n.reviewed], ['valid', '有效提示', n.valid], ['falsePositive', '误报提示', n.falsePositive], ['pending', '待确认（含待补）', n.pending], ['ignored', '忽略提示', n.ignored], ['failures', '分析失败', n.failures], ['humanFindings', '人工额外发现', n.humanFindings]].map(([key, label, value]) => `<div><small>${label}</small><b data-r009-stat="${key}">${value}</b></div>`).join('')}</div><p>误报率：<b data-r009-stat="falsePositiveRate">${n.falsePositiveRate === null ? '暂无有效标注' : (n.falsePositiveRate * 100).toFixed(1) + '%'}</b>（${n.falsePositive}/${n.labeled}；分母仅“有效提示＋误报”的最后标签，忽略/待补/未复核不计正确或错误）。</p><p>漏报率：暂无可计算数据，人工额外发现不等于完整真值集。演示平均处理耗时：${n.meanDurationMs === null ? '暂无记录' : n.meanDurationMs + ' 毫秒'}（非财务审核时长，不代表效率收益）。模型用量与费用：未调用真实模型，无实际用量/计费记录。</p><small>统计范围为当前浏览器全部演示分析尝试，含失败/进行中；重分析新增批次，风险条数可重复。历史与过期提示仍计入，不能作为企业违规率或模型准确率。</small>`; }
export function aiStatisticsHtml() { try {
    return `<section class="panel" id="r009-statistics"><details><summary>AI辅助演示反馈统计</summary><p>${LOCAL_DEMO_NOTICE}</p>${statsBody(loadAI(localStorage).state)}</details></section>`;
}
catch {
    return `<section class="panel"><p>AI演示统计记录无法读取，暂不计算；原七规则和财务流程不受影响，未覆盖原数据。</p></section>`;
} }
function evidenceHtml(r, refs) { return refs.map(ref => { const e = r.context.evidence[ref]; return e ? `<div class="review-box"><b>${esc(e.label)}</b><p>${esc(e.value || '未填写')}</p><small>证据引用：${esc(ref)}</small></div>` : ''; }).join(''); }
function references(financial, r) { try {
    return localReferenceOptions(financial, r).map((ref, index) => [ref, r.context.evidence[ref]?.label || `该审核批次原附件 ${index + 1}`]);
}
catch {
    return [];
} }
export function aiPanel(financial, claim, batch, actor, history = false) {
    let store;
    try {
        store = loadAI(localStorage).state;
    }
    catch (err) {
        return `<section class="panel" id="r009-panel" data-claim="${esc(claim.id)}"><h3>AI风险分析 · 本地演示</h3>${errorHtml('分析记录无法安全读取，未覆盖原值。原七规则与财务复核仍可使用。')}<details><summary>诊断</summary><p>${esc(String(err))}</p></details></section>`;
    }
    const all = store.analyses.filter(r => r.reimbursementId === claim.id && (!history || r.auditBatchId === batch?.id)), validSelection = all.find(r => r.analysisId === selected.get(claim.id)), record = validSelection || all.at(-1), config = effectiveAIConfig(store), canAnalyze = !history && actor?.role === '财务' && batch?.id === claim.currentBatchId && batch?.revision === claim.revision, hasRunning = store.analyses.some(r => r.reimbursementId === claim.id && r.analysisStatus === 'RUNNING');
    if (record)
        selected.set(claim.id, record.analysisId);
    let out = `<section class="panel" id="r009-panel" data-claim="${esc(claim.id)}" data-batch="${esc(batch?.id || '')}" data-history="${history ? 'true' : 'false'}"><div class="panel-title"><h3>AI风险分析 · R009</h3><span class="badge">本地演示 / 未接入大模型</span></div><p>${LOCAL_DEMO_NOTICE}</p><p>先查看上方确定性结果，再按需生成辅助建议。此区域没有修改金额、发票、科目、审批、预算或发布制度的权限，不能替代独立财务复核。</p><p id="r009-message" role="status"></p><p>当前配置 v${config.version} · ${config.config.enabled ? '启用' : '已停用'} · 仅人工点击，不上传资料或读取附件正文。</p>`;
    if (!history)
        out += `<div class="enterprise-buttons"><button type="button" id="r009-start" class="primary" ${canAnalyze && !hasRunning && config.config.enabled ? '' : 'disabled'}>AI辅助分析（演示）</button><button type="button" id="r009-rerun" ${canAnalyze && !hasRunning && config.config.enabled && all.length ? '' : 'disabled'}>重新分析（新增记录）</button></div><p>${!batch ? '当前没有有效审核批次，请先执行自动审核。' : actor?.role !== '财务' ? '需切换为财务角色；其他角色只读。' : hasRunning ? '仅分析按钮等待，七规则与财务操作仍可使用。' : '相同输入/批次/配置可复用结果，明确重新分析才新建记录。'}</p><details><summary>演示选项与故障测试（非真实接口）</summary><label class="r009-check"><input id="r009-history" type="checkbox">显式使用3条虚构招待费比较样本（仅2026年10月同类人民币业务适用）</label><label>预设故障<select id="r009-fault">${opts([['NONE', '正常演示'], ['TIMEOUT', '模拟服务超时'], ['UNAVAILABLE', '模拟服务不可用'], ['INVALID_JSON', '模拟无效JSON'], ['INVALID_EVIDENCE', '模拟不存在的制度引用'], ['UNSUPPORTED_ACTION', '模拟不允许的工具操作'], ['UNSUPPORTED_NUMBER', '模拟无依据准确率']], 'NONE')}</select></label></details>`;
    if (!all.length)
        return out + '<p>该单尚无辅助分析。不会自动发送或生成分析。</p></section>';
    out += `<label>本单分析历史<select id="r009-select">${opts(all.slice().reverse().map(r => [r.analysisId, `${displayTime(r.analysisTimestamp)} · 单据v${r.reimbursementVersion} · ${stateName(r)}${analysisStale(r, financial) ? ' · 已过期' : ''}`]), record.analysisId)}</select></label><p>关联审核批次 ${esc(record.auditBatchId)} · 单据版本 ${record.reimbursementVersion} · 演示模板 ${esc(record.promptVersion)} · 配置v${record.config.version} · 发起人 ${esc(record.requestedBy?.name||"历史未记录")}</p>`;
    if (analysisStale(record, financial))
        out += '<p class="review-box" data-testid="r009-stale">报销单或审核批次已修改，此分析已过期。请先重新自动审核，再按需重新分析；旧结果只供追溯。</p>';
    if (record.config.id !== config.id)
        out += '<p>当前正式AI设置已有新版本；此处仍保留分析时配置，不用新名称覆盖历史。</p>';
    let reviewText = '原批次暂不可访问，仅查看保存的脱敏证据';
    try {
        const b = financial.claims.find(d => d.id === record.reimbursementId)?.batches.find(b => b.id === record.auditBatchId);
        if (b)
            reviewText = b.review ? (b.review.decision === 'approved' ? '财务已通过' : '财务已驳回') + '：' + b.review.reason : '原批次尚未最终复核';
    }
    catch { }
    out += `<p>关联原财务处理：${esc(reviewText)}。此信息来自原单据，不由辅助分析更改。</p>`;
    if (record.analysisStatus === 'RUNNING')
        out += `<p data-testid="r009-running">分析中；离开或刷新不会伪造完成。</p>${!history && actor?.role === '财务' ? jobs.has(record.analysisId) ? '<button id="r009-cancel">取消本次分析</button>' : unsaved.has(record.analysisId) ? '<button id="r009-retry-save">重试保存已生成结果（不重新调用）</button>' : '<button id="r009-interrupt">结束上次中断记录后重试</button>' : ''}`;
    else if (record.analysisStatus === 'FAILED')
        out += `<div class="review-box" data-testid="r009-failed"><b>辅助分析失败</b><p>${esc(failureMessages[record.errorCode] || '分析不可用')}</p><small>错误类别：${esc(record.errorCode)}。没有接受无效输出；原规则结果、业务状态和预算未改变。</small></div>`;
    else {
        const result = record.structuredResult;
        out += `<div class="review-box" data-testid="r009-result"><b>${esc(assessmentNames[result.assessment])}</b><p>${esc(result.summary)}</p><p>新增线索 ${result.riskItems.length} 项；关注程度用于人工排序，不代表违规严重性。</p></div><details open class="r009-rule-summary"><summary>原确定性规则汇总（不算新增风险，不改原结论）</summary><p>${esc(result.ruleExplanation.summary)}</p><ul>${result.ruleExplanation.verificationQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul><p>${esc(result.ruleExplanation.suggestedAction)}</p><details><summary>查看原规则证据</summary>${evidenceHtml(record, result.ruleExplanation.evidenceRefs)}</details></details>`;
        const allowedRefs = references(financial, record), canFeedback = actor?.role === '财务' && !history && allowedRefs.length > 0;
        for (const risk of result.riskItems) {
            const feedback = store.feedback.filter(f => f.analysisId === record.analysisId && f.riskId === risk.riskId), latest = feedback.at(-1);
            out += `<article class="r009-risk" data-r009-risk="${esc(risk.riskId)}"><h4>${esc(categoryNames[risk.riskCategory])} · ${esc({ LOW: '低', MEDIUM: '中', HIGH: '高' }[risk.riskLevel])}关注</h4><p>${esc(risk.description)}</p><ul>${risk.verificationQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul><p><b>下一步：</b>${esc(risk.suggestedAction)}</p><details><summary>查看证据与原文引用</summary>${risk.evidenceQuotes.map(q => `<blockquote>${esc(q.quote)}</blockquote>`).join('')}${evidenceHtml(record, risk.evidenceRefs)}</details><p data-r009-feedback-label>人工反馈：${esc(latest ? feedbackNames[latest.feedbackStatus] : '尚未复核')}</p>${canFeedback ? `<form data-r009-feedback="${esc(risk.riskId)}"><label>反馈结果<select name="aiFeedbackStatus">${opts(Object.entries(feedbackNames), latest?.feedbackStatus || 'UNREVIEWED')}</select></label><label>核实情况与原因（必填）<textarea name="aiFeedbackComment" maxlength="800" required></textarea></label><label>证明引用（可选，按Ctrl或Command多选）<select name="aiEvidence" multiple>${opts(allowedRefs, '')}</select></label><button>保存人工反馈</button></form>` : ''}<details><summary>反馈历史（追加，不覆盖）</summary>${feedback.map(f => `<p>${esc(feedbackNames[f.feedbackStatus])} · ${esc(f.reviewerName)} · ${esc(displayTime(f.createdAt))}</p><p>${esc(f.feedbackComment)}</p>`).join('') || '<p>暂无反馈。</p>'}</details><small>“有效提示”仅表示核实后有参考价值，不自动证明违规；反馈不会训练模型或修改规则。</small></article>`;
        }
        out += `<details><summary>分析局限与脱敏输入快照</summary><ul>${result.limitations.map(x => `<li>${esc(x)}</li>`).join('')}</ul><pre>${esc(JSON.stringify(record.context, null, 2))}</pre></details>`;
    }
    if (record.analysisStatus !== 'RUNNING') {
        const allowed = references(financial, record);
        out += `<details><summary>财务人员额外发现（独立人工记录）</summary><p>人工发现不计为AI命中，不表示已完整标注所有异常，不能据此计算漏报率。</p>${!history && actor?.role === '财务' && allowed.length ? `<form id="r009-human"><label>人工发现及核实情况<textarea name="aiHumanDescription" maxlength="800" required></textarea></label><label>实际证据引用（至少一项）<select name="aiHumanEvidence" multiple required>${opts(allowed, '')}</select></label><button>保存人工发现</button></form>` : ''}${store.humanFindings.filter(f => f.analysisId === record.analysisId).map(f => `<div class="review-box"><p>${esc(f.description)}</p><small>人工记录 · ${esc(f.reviewerName)} · ${esc(displayTime(f.at))}</small></div>`).join('')}</details>`;
    }
    out += `<details><summary>本浏览器演示反馈统计及口径</summary>${statsBody(store)}</details><small>分析ID ${esc(record.analysisId)} · ${esc(displayTime(record.analysisTimestamp))} · ${record.durationMs === null ? '耗时尚不可得' : record.durationMs + '毫秒演示处理'}。不记录或推测真实模型费用。</small></section>`;
    return out;
}
export function bindAIPanel(root, financial, claim, batch, actor, history = false) {
    const panel = root.querySelector('#r009-panel');
    if (!panel)
        return;
    const message = text => { const current = root.querySelector('#r009-panel'); const target = current?.querySelector('#r009-message'); if (target && current.dataset.claim === claim.id)
        target.textContent = text; };
    const freshFinance = () => loadFinancial(localStorage).state;
    function paint(notice = '') { if (!root.isConnected)
        return; const current = root.querySelector('#r009-panel'); if (current?.dataset.claim !== claim.id)
        return; const f = freshFinance(), d = f.claims.find(d => d.id === claim.id); if (!d)
        return; const b = history ? d.batches.find(b => b.id === batch?.id) : d.batches.find(b => b.id === d.currentBatchId && b.revision === d.revision); current.outerHTML = aiPanel(f, d, b, actor, history); bindAIPanel(root, f, d, b, actor, history); message(notice); }
    const change = (action, notice) => { try {
        const loaded = loadAI(localStorage), next = action(freshFinance(), loaded.state);
        saveAI(localStorage, next, loaded.raw);
        paint(notice);
    }
    catch (e) {
        message(String(e));
    } };
    async function finish(id, completion) {
        try {
            const loaded = loadAI(localStorage);
            saveAI(localStorage, completeAIAnalysis(loaded.state, id, completion, new Date().toISOString()), loaded.raw);
            unsaved.delete(id);
        }
        catch (e) {
            unsaved.set(id, completion);
            try {
                paint(String(e) + '；可重试保存已生成结果，不再次调用服务。');
            }
            catch {
                message('AI结果尚未保存，请恢复本地存储后重试；原财务数据不变。');
            }
            return;
        }
        try {
            if (selected.get(claim.id) === id)
                paint(completion.analysisStatus === 'COMPLETED' ? '辅助建议已保存，原七规则及审批状态保持。' : '失败状态已保存，可继续传统审核。');
            else
                message('新的分析记录已完成，可在本单历史选择查看；当前反馈输入保留。');
        }
        catch {
            message('AI结果已保存，但原单据数据已有变化，请刷新查看。');
        }
    }
    async function start(force) {
        let run;
        try {
            const loaded = loadAI(localStorage), f = freshFinance(), d = f.claims.find(d => d.id === claim.id);
            run = beginAIAnalysis(f, loaded.state, claim.id, d?.currentBatchId || '', actor, new Date().toISOString(), crypto.randomUUID(), { force, history: !!panel.querySelector('#r009-history')?.checked, fault: panel.querySelector('#r009-fault')?.value || 'NONE' });
            selected.set(claim.id, run.record.analysisId);
            if (run.reused) {
                paint('相同输入与配置已复用有效分析，没有新增调用记录。');
                return;
            }
            saveAI(localStorage, run.state, loaded.raw);
            const controller = new AbortController();
            jobs.set(run.record.analysisId, controller);
            paint('正在本地演示分析，可继续查看和处理原审核。');
            const completion = await executeAIService(run.record, undefined, controller.signal);
            jobs.delete(run.record.analysisId);
            await finish(run.record.analysisId, completion);
        }
        catch (e) {
            message(String(e));
        }
    }
    panel.querySelector('#r009-start')?.addEventListener('click', () => start(false));
    panel.querySelector('#r009-rerun')?.addEventListener('click', () => start(true));
    panel.querySelector('#r009-select')?.addEventListener('change', e => { selected.set(claim.id, e.target.value); paint(); });
    const id = selected.get(claim.id);
    panel.querySelector('#r009-cancel')?.addEventListener('click', () => jobs.get(id)?.abort());
    panel.querySelector('#r009-interrupt')?.addEventListener('click', () => change((_f, s) => interruptAIAnalysis(s, id, actor, new Date().toISOString()), '中断状态已保存，可以重新分析。'));
    panel.querySelector('#r009-retry-save')?.addEventListener('click', () => { const result = unsaved.get(id); if (result)
        finish(id, result); });
    panel.querySelectorAll('[data-r009-feedback]').forEach(form => form.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(form); change((financial, s) => recordAIFeedback(financial, s, id, form.dataset.r009Feedback, f.get('aiFeedbackStatus'), f.get('aiFeedbackComment'), f.getAll('aiEvidence'), actor, new Date().toISOString()), '反馈已追加保存，不改变原自动结果，也不自动训练模型。'); }));
    panel.querySelector('#r009-human')?.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.currentTarget); change((financial, s) => addHumanFinding(financial, s, id, f.get('aiHumanDescription'), f.getAll('aiHumanEvidence'), actor, new Date().toISOString()), '人工发现已保存，未计为AI命中或完整真值标注。'); });
}
export function aiSettingsHtml(financial, actor) {
    let store;
    try {
        store = loadAI(localStorage).state;
    }
    catch {
        return '<section class="panel"><h3>AI辅助审核设置</h3><p>AI记录无法安全读取，保留原值；R008规则配置仍可使用。</p></section>';
    }
    const published = effectiveAIConfig(store), versions = [defaultAIConfig(), ...store.configVersions], v = versions.find(v => v.id === settingsSelection) || versions.at(-1), admin = actor?.role === '管理员' && !!financial.ruleBook, editable = admin && v.status !== 'PUBLISHED';
    settingsSelection = v.id;
    return `<section class="panel" id="r009-settings"><h3>AI辅助审核设置（R008扩展区）</h3><p>沿用草稿→校验→自检→确认发布；只管理辅助分析设置，不属于第八条确定性审核。</p><p>${LOCAL_DEMO_NOTICE}</p><p>正式设置v${published.version}：${published.config.enabled ? '启用' : '停用'}。真实模型接口：尚未配置/授权。本区不接收密钥和外部地址。</p><p id="r009-settings-message" role="status"></p>${!financial.ruleBook ? '<p>请先在上方R008显式导入现有配置，再维护AI设置版本；当前可使用系统预置演示。</p>' : ''}<label>设置版本<select id="r009-settings-version">${opts(versions.map(v => [v.id, `v${v.version} · ${v.status === 'PUBLISHED' ? '已发布' : v.status === 'VALIDATED' ? '已校验' : '草稿'} · ${v.config.enabled ? '启用' : '停用'}`]), v.id)}</select></label><button id="r009-settings-new" ${admin ? '' : 'disabled'}>复制此设置为新草稿</button><form id="r009-settings-form"><fieldset ${editable ? '' : 'disabled'}><legend>演示设置 · ${v.status === 'PUBLISHED' ? '已发布只读' : '草稿不影响正式设置'}</legend><div class="form-grid"><label>辅助功能<select name="aiEnabled">${opts([['true', '启用'], ['false', '停用（不影响原七规则）']], String(v.config.enabled))}</select></label><label>演示服务超时（毫秒）<input name="aiTimeout" type="number" min="100" max="30000" value="${v.config.timeoutMs}"></label><label>最大风险项目<input name="aiMaxRisks" type="number" min="1" max="10" value="${v.config.maxRiskItems}"></label><label>最大输出字符<input name="aiMaxChars" type="number" min="3000" max="30000" value="${v.config.maxOutputChars}"></label><label>变更原因<input name="aiConfigReason" value="${esc(v.reason)}" maxlength="500" required></label></div><p>分析类别（停用某类不表示该风险不存在）：</p>${riskCategories.map(c => `<label class="r009-check"><input name="aiCategory" type="checkbox" value="${c}" ${v.config.categories.includes(c) ? 'checked' : ''}>${categoryNames[c]}</label>`).join('')}<p>人工触发：固定。模式：本地演示。模板：${esc(v.config.promptVersion)}。无自动上传、外部调用、AI审批或自动学习。</p><button class="primary">保存AI设置草稿</button></fieldset></form><div class="enterprise-buttons"><button id="r009-settings-validate" ${editable ? '' : 'disabled'}>校验AI设置</button><button id="r009-settings-test" ${editable && v.status === 'VALIDATED' ? '' : 'disabled'}>运行演示设置自检</button><button id="r009-settings-publish" ${editable && v.testedFingerprint ? '' : 'disabled'}>发布AI设置（需确认）</button></div><details><summary>设置变更记录</summary>${store.configLogs.slice().reverse().map(l => `<p>${esc(l.action)} · ${esc(l.actorName)} · ${esc(displayTime(l.at))}</p><p>${esc(l.reason)}</p>`).join('') || '<p>暂无管理变更，当前为系统预置演示。</p>'}</details><small>AI设置与原规则中心在同一页面。分析记录单独存储并关联原单据/批次，损坏不阻断原财务流程。localStorage不是生产权限或防篡改审计。</small></section>`;
}
export function bindAISettings(root, financial, actor) {
    const panel = root.querySelector('#r009-settings');
    if (!panel)
        return;
    const paint = notice => { panel.outerHTML = aiSettingsHtml(loadFinancial(localStorage).state, actor); bindAISettings(root, loadFinancial(localStorage).state, actor); root.querySelector('#r009-settings-message').textContent = notice || ''; };
    const action = (fn, notice) => { try {
        const loaded = loadAI(localStorage), next = fn(loadFinancial(localStorage).state, loaded.state);
        saveAI(localStorage, next, loaded.raw);
        paint(notice);
    }
    catch (e) {
        root.querySelector('#r009-settings-message').textContent = String(e);
    } };
    const at = () => new Date().toISOString(), id = settingsSelection;
    panel.querySelector('#r009-settings-version')?.addEventListener('change', e => { settingsSelection = e.target.value; paint(); });
    panel.querySelector('#r009-settings-new')?.addEventListener('click', () => action((f, s) => { const next = draftAIConfig(f, s, actor, at(), id); settingsSelection = next.configVersions.at(-1).id; return next; }, 'AI设置草稿已创建，正式配置未改变。'));
    panel.querySelector('#r009-settings-form')?.addEventListener('input', () => { for (const button of panel.querySelectorAll('#r009-settings-validate,#r009-settings-test,#r009-settings-publish'))
        button.disabled = true; panel.querySelector('#r009-settings-message').textContent = '有未保存字段，请先保存草稿。'; });
    panel.querySelector('#r009-settings-form')?.addEventListener('submit', e => { e.preventDefault(); const data = new FormData(e.currentTarget); action((f, s) => { const old = s.configVersions.find(v => v.id === id); return saveAIConfig(f, s, id, { ...old.config, enabled: data.get('aiEnabled') === 'true', timeoutMs: Number(data.get('aiTimeout')), maxRiskItems: Number(data.get('aiMaxRisks')), maxOutputChars: Number(data.get('aiMaxChars')), categories: data.getAll('aiCategory') }, data.get('aiConfigReason'), actor, at()); }, 'AI设置草稿已保存，需重新校验和自检。'); });
    panel.querySelector('#r009-settings-validate')?.addEventListener('click', () => action((f, s) => validateAIConfigDraft(f, s, id, actor, at()), 'AI设置校验通过。'));
    panel.querySelector('#r009-settings-test')?.addEventListener('click', () => action((f, s) => testAIConfigDraft(f, s, id, aiSelfTestContext(), actor, at()), '内置虚构样本自检通过，未新增财务单据、审批或预算流水；不代表真实模型测试。'));
    panel.querySelector('#r009-settings-publish')?.addEventListener('click', () => { if (confirm('确认发布AI辅助设置？请核对草稿、启用状态、分类与原因。只影响后续辅助分析，不修改七规则、历史分析或财务审批。'))
        action((f, s) => publishAIConfig(f, s, id, actor, at(), true), 'AI设置已发布，历史分析保留当时版本。'); });
}
