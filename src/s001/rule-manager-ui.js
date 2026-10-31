import { definitions, resolveVersion, fingerprint, policyToday } from './rule-config.ts';
import { initializeRules, draftRule, updateRule, validateDraft, simulateDraft, publishRule, archiveDraft, simulationInput } from './rule-config-model.ts';
import { loadState } from '../r001/model';
import { centsToYuan, parseYuan } from '../r001/rule';
import { escapeHtml as esc, displayTime } from '../shared/audit-ui';
let chosen = '', versionId = '', query = '', company = '', category = '', status = '';
const labels = { DRAFT: '草稿', VALIDATED: '已校验', PUBLISHED: '已发布', ARCHIVED: '已归档' };
const options = (rows, value) => rows.map(r => { const [v, t] = Array.isArray(r) ? r : [r, r]; return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`; }).join('');
const pathInput = (path, v, label, type = 'text') => `<label>${label}<input data-r008-path="${path}" data-kind="${type}" value="${esc((type === 'money' || type === 'nullableMoney') ? (v === null ? '' : centsToYuan(v)) : v ?? '')}" ${type === 'date' ? 'type="date"' : ''}></label>`;
const pathSelect = (path, v, label, rows, kind = 'string') => `<label>${label}<select data-r008-path="${path}" data-kind="${kind}">${options(rows, v)}</select></label>`;
function parameters(v, s) {
    const p = v.parameters;
    if (v.ruleId === 'R001')
        return `<p>人民币元/晚；保存后以整数分计算。增加城市可在下方结构化参数中新增标准行。</p><div class="table-wrap"><table><thead><tr><th>城市</th><th>职级</th><th>每晚标准（元）</th></tr></thead><tbody>${p.standards.rows.map((r, i) => `<tr><td>${pathInput(`standards.rows.${i}.city`, r.city, '城市')}</td><td>${pathSelect(`standards.rows.${i}.grade`, r.grade, '职级', ['普通员工', '部门经理', '高级管理人员'])}</td><td>${pathInput(`standards.rows.${i}.nightlyRateCents`, r.nightlyRateCents, '住宿费标准', 'money')}</td></tr>`).join('')}</tbody></table></div>`;
    if (v.ruleId === 'R002')
        return `<p class="risk">高风险内控：固定发票唯一标识、全部可访问历史及同单票据，不能修改比对字段绕过查重。确定重复不得自动通过。</p><div class="form-grid">${pathSelect('exactAction', p.exactAction, '确定重复处理', [['REVIEW', '人工复核（原制度）'], ['BLOCK', '拦截，不准普通放行']])}${pathSelect('suspectedAction', p.suspectedAction, '疑似重复处理', [['REVIEW', '人工复核'], ['BLOCK', '拦截，修正后重审']])}</div>`;
    if (v.ruleId === 'R003')
        return `<p>币种、负数、精度、超票额校验固定。无票例外暂不开放。</p><div class="form-grid">${pathInput('expenseTypes', p.expenseTypes.join(','), '适用费用类型（逗号分隔）', 'array')}${pathSelect('allowPartial', String(p.allowPartial), '允许部分报销', [['true', '允许'], ['false', '禁止']], 'boolean')}${pathSelect('requirePartialReason', String(p.requirePartialReason), '部分报销原因', [['true', '必填'], ['false', '选填']], 'boolean')}${pathSelect('partialAction', p.partialAction, '符合部分报销条件后', [['REVIEW', '仍需人工复核'], ['PASS', '本规则通过（仍需其他规则及财务确认）']])}</div>`;
    if (v.ruleId === 'R004')
        return `<p>名称、税号、历史别名复用下方“法人主数据”入口，不复制第二套公司记录。</p>${pathInput('minimumConfidence', p.minimumConfidence, 'OCR最低置信度（候选仍需核对）', 'number')}<div class="form-grid">${p.policies.map((r, i) => `<fieldset><legend>${esc(r.invoiceType)}</legend>${pathSelect(`policies.${i}.applicable`, String(r.applicable), '适用抬头政策', [['true', '适用'], ['false', '明确特例，不执行本项']], 'boolean')}${pathSelect(`policies.${i}.requireTaxId`, String(r.requireTaxId), '购买方税号', [['true', '必填'], ['false', '按模拟政策允许空税号']], 'boolean')}${pathInput(`policies.${i}.reason`, r.reason, '制度依据/特例原因')}</fieldset>`).join('')}</div>`;
    if (v.ruleId === 'R005')
        return `<p>推荐科目必须属于允许科目，代码来自现有科目表；法人专属映射优先于集团。新发布仅影响后续审核。</p><div class="table-wrap"><table><thead><tr><th>范围/费用</th><th>科目</th><th>有效期/状态</th></tr></thead><tbody>${p.mappings.map((r, i) => `<tr><td>${pathSelect(`mappings.${i}.companyId`, r.companyId, '适用法人', [['*', '集团'], ...s.entityConfig.companies.map(c => [c.companyId, c.companyName])])}${pathInput(`mappings.${i}.expenseType`, r.expenseType, '费用类型')}</td><td>${pathSelect(`mappings.${i}.recommendedAccountCode`, r.recommendedAccountCode, '推荐科目', s.accountConfig.accounts.map(a => [a.code, a.code + ' ' + a.name]))}${pathInput(`mappings.${i}.allowedAccountCodes`, r.allowedAccountCodes.join(','), '允许科目（逗号分隔）', 'array')}</td><td>${pathInput(`mappings.${i}.effectiveFrom`, r.effectiveFrom, '起始日', 'date')}${pathInput(`mappings.${i}.effectiveTo`, r.effectiveTo || '', '截止日', 'nullable')}${pathSelect(`mappings.${i}.status`, r.status, '状态', ['ACTIVE', 'DISABLED'])}</td></tr>`).join('')}</tbody></table></div>`;
    if (v.ruleId === 'R006')
        return `<p class="review-box">新提交流程读取新版本；在途流程保留当时审批及附件制度，不删除审批记录。金额区间包含边界；高区间下限应为低区间上限+0.01元。</p><h4>审批条件</h4><div class="table-wrap"><table><tbody>${p.approvalPolicies.map((r, i) => `<tr><td>${esc(r.policyId)}<small>${esc(r.companyId)} / ${esc(r.expenseType)} / ${esc(r.grade || '全部职级')}</small></td><td>${pathInput(`approvalPolicies.${i}.minAmount`, r.minAmount, '最低金额（元）', 'money')}${pathInput(`approvalPolicies.${i}.maxAmount`, r.maxAmount, '最高金额（元，空为无上限）', r.maxAmount === null ? 'nullableMoney' : 'nullableMoney')}</td><td>${pathInput(`approvalPolicies.${i}.requiredApprovalRoles`, r.requiredApprovalRoles.join(','), '必要角色（逗号分隔）', 'array')}${pathInput(`approvalPolicies.${i}.approvalSequence`, r.approvalSequence.join(','), '审批顺序（逗号分隔）', 'array')}${pathSelect(`approvalPolicies.${i}.allowSamePerson`, String(r.allowSamePerson), '同人多节点', [['false', '禁止'], ['true', '允许（高风险）']], 'boolean')}${pathSelect(`approvalPolicies.${i}.allowSelf`, String(r.allowSelf), '本人审批', [['false', '禁止'], ['true', '允许（高风险）']], 'boolean')}</td></tr>`).join('')}</tbody></table></div><h4>附件要求</h4><div class="form-grid">${p.attachmentPolicies.map((r, i) => `<fieldset><legend>${esc(r.companyId)} / ${esc(r.expenseType)}</legend>${r.requirements.map((x, j) => pathSelect(`attachmentPolicies.${i}.requirements.${j}.required`, String(x.required), x.type, [['true', '必需'], ['false', '可选']], 'boolean')).join('')}${pathInput(`attachmentPolicies.${i}.minAmount`, r.minAmount, '最低金额（元）', 'money')}${pathInput(`attachmentPolicies.${i}.maxAmount`, r.maxAmount, '最高金额（空为无上限）', 'nullableMoney')}</fieldset>`).join('')}</div>`;
    return `<p class="risk">仅修改审核策略。发布后覆盖所选范围内对应费用的部门/月度策略；不改变预算额度和占用流水。SOFT模式始终需要具名预算负责人额外审批，不能配置成普通放行。</p><div class="table-wrap"><table><tbody>${p.policies.map((r, i) => `<tr><td>${esc(r.expenseType)}</td><td>${pathSelect(`policies.${i}.controlMode`, r.controlMode, '控制模式', [['HARD', '刚性拦截'], ['SOFT', '柔性具名授权'], ['WARNING', '仅预警']])}${pathInput(`policies.${i}.warningThresholds`, r.warningThresholds.join(','), '递增预警阈值（%逗号分隔）', 'numbers')}</td><td>${pathSelect(`policies.${i}.reserveOnSoftExceeded`, String(r.reserveOnSoftExceeded), '柔性超额是否预占', [['true', '保留预占'], ['false', '批准时再检查占用']], 'boolean')}${pathInput(`policies.${i}.extraApproverId`, r.extraApproverId, '预算负责人用户ID')}</td></tr>`).join('')}</tbody></table></div>`;
}
function diffs(a, b, path = '') {
    if (JSON.stringify(a) === JSON.stringify(b))
        return [];
    if (b && typeof b === 'object' && (a === null || a === undefined || typeof a === 'object')) {
        a=a||{};
        return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diffs(a[k], b[k], path ? path + '.' + k : k));
    }
    return [{ path, before: a, after: b }];
}
function differenceRow(d,v) {
 let label=d.path,m=d.path.match(/^parameters\.standards\.rows\.(\d+)\.nightlyRateCents$/),money=false;
 if(m){const r=v.parameters.standards.rows[Number(m[1])];label=(r?r.city+' / '+r.grade+' / ':'')+'每晚住宿标准（元）';money=true;}
 else {money=/\.(minAmount|maxAmount)$/.test(label);const names={parameters:'制度参数',standards:'住宿标准',rows:'标准行',nightlyRateCents:'每晚金额（分）',companyId:'适用法人',enabled:'规则启用',effectiveFrom:'生效日期',effectiveTo:'失效日期',policies:'控制策略',minimumConfidence:'最低置信度',mappings:'科目映射',scenarios:'业务场景',approvalPolicies:'审批政策',attachmentPolicies:'附件政策',minAmount:'最低金额（元）',maxAmount:'最高金额（元）',warningThresholds:'预警百分比',controlMode:'控制模式',exactAction:'确定重复处理',suspectedAction:'疑似重复处理',allowPartial:'允许部分报销',requirePartialReason:'部分报销原因必填',partialAction:'部分报销结果',recommendedAccountCode:'推荐科目',allowedAccountCodes:'允许科目',required:'是否必需',requireTaxId:'税号必填',applicable:'是否适用'};label=label.split('.').map(k=>names[k]||(/^\d+$/.test(k)?'第'+(Number(k)+1)+'项':k)).join(' / ');}
 const display=x=>x===undefined?'未配置':x===null?'无/不计算':money?centsToYuan(x):typeof x==='boolean'?(x?'是':'否'):typeof x==='object'?JSON.stringify(x):String(x);
 return '<tr><td>'+esc(label)+'</td><td>'+esc(display(d.before))+'</td><td>'+esc(display(d.after))+'</td></tr>';
}
function lodgingSimulation(sim) {
 const a=sim.before.evidence||{},b=sim.after.evidence||{},money=n=>Number.isSafeInteger(n)?centsToYuan(n)+' 元':'未匹配/不计算';
 const rows=[['每晚标准',money(a.standardSnapshot?.nightlyRateCents),money(b.standardSnapshot?.nightlyRateCents)],['住宿晚数',a.nights??'资料不足',b.nights??'资料不足'],['申请金额',money(a.amountCents),money(b.amountCents)],['最高报销限额',money(a.limitCents),money(b.limitCents)],['超标金额',money(a.excessCents),money(b.excessCents)]];
 return '<div class="table-wrap"><table><thead><tr><th>住宿计算项目</th><th>当前正式规则</th><th>此草稿规则</th></tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(String(x))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}

export function ruleManager(s, a) {
    const admin = a?.role === '管理员', b = s.ruleBook;
    let out = `<section class="panel" id="r008-center"><h3>规则管理中心 · R008</h3><p>配置草稿 → 校验 → 真实模拟 → 二次确认发布。R008不增加第八条费用审核。当前${admin ? '规则管理员' : '只读'}（演示权限）。</p><p class="footnote">浏览器本地保存；无生产级权限、多人事务或防篡改审计。仅模拟制度，禁止填入真实企业数据。</p><p id="r008-error" role="alert"></p><p id="r008-status" role="status"></p>`;
    if (!b)
        return out + `<p>尚未启用统一版本管理。R001–R007均已实现，沿用现有标准和配置。下方原入口继续可用。</p><button id="r008-init" ${admin ? '' : 'disabled'}>导入现有配置并启用版本管理</button><p>导入不会修改旧单/预算金额/流水，不会把500元住宿标准擅自改成示例400元。R007原策略可能按部门月份不同，需显式发布统一策略后才接管。</p>${definitions.map(d => `<p>${d.ruleId} ${d.ruleName} · 已实现 · ${d.parameterSchema}</p>`).join('')}</section>`;
    const vs = b.versions.filter(v => v.ruleId === chosen);
    if (!vs.some(v => v.versionId === versionId))
        versionId = vs.at(-1)?.versionId || '';
    const v = b.versions.find(v => v.versionId === versionId), def = definitions.find(d => d.ruleId === chosen);
    out += `<div class="toolbar"><input id="r008-query" aria-label="搜索规则" value="${esc(query)}" placeholder="编号或名称"><select id="r008-company" aria-label="筛选法人">${options([['', '所有法人'], ['*', '集团'], ...s.entityConfig.companies.map(c => [c.companyId, c.companyName])], company)}</select><select id="r008-category" aria-label="规则分类">${options([['', '全部分类'], ...new Set(definitions.map(d => d.category))], category)}</select><select id="r008-status-filter" aria-label="启用状态">${options([['', '全部启用状态'], ['true', '已启用'], ['false', '已停用']], status)}</select></div><div class="table-wrap"><table id="r008-list"><thead><tr><th>规则/分类</th><th>适用范围</th><th>正式版本/状态</th><th>生效日/最近修改</th><th>操作</th></tr></thead><tbody>${definitions.filter(d => (d.ruleId + d.ruleName).includes(query) && (!category || d.category === category)).flatMap(d => {
        const rows = b.versions.filter(v => v.ruleId === d.ruleId && v.status === 'PUBLISHED');
        const scopes = [...new Set(rows.map(v => v.companyId))];
        if (!scopes.length)
            scopes.push('*');
        return scopes.filter(c => !company || c === company).map(c => { const t = simulationInput(); t.companyId = c; t.checkIn = t.businessDate = policyToday(new Date().toISOString()); const selection = resolveVersion(b, t, d.ruleId, new Date().toISOString()), selected = selection.version?.companyId === c ? selection.version : null; const latest = rows.filter(v => v.companyId === c).at(-1); if (status && String(selected?.enabled) !== status)
            return ''; return `<tr><td>${d.ruleId} ${d.ruleName}<small>${d.category} · 已实现/支持配置</small></td><td>${esc(c === '*' ? '集团' : s.entityConfig.companies.find(x => x.companyId === c)?.companyName || c)}</td><td>${selected ? `v${selected.versionNumber} · ${selected.enabled ? '已启用' : '已停用'}` : '未匹配当前示例业务日 / 沿用原策略'}${latest && latest.effectiveFrom > policyToday(new Date().toISOString()) ? '<small>已发布未来版本，待生效</small>' : ''}</td><td>${esc(latest?.effectiveFrom || '—')}<small>${latest ? esc(displayTime(latest.publishedAt)) : '未统一接管'}</small></td><td><button data-r008-open="${d.ruleId}" data-version="${latest?.versionId || ''}">查看配置</button></td></tr>`; });
    }).join('')}</tbody></table></div>`;
    if (def) {
        out += `<h3>${def.ruleId} ${def.ruleName}</h3><p>${def.description}</p><p>可配置：${def.parameterSchema}</p><div class="toolbar"><select id="r008-version" aria-label="规则版本"><option value="">请选择版本</option>${options(vs.map(x => [x.versionId, `v${x.versionNumber} · ${x.companyId} · ${labels[x.status]} · ${x.effectiveFrom}`]), versionId)}</select><select id="r008-new-company" aria-label="新版本法人">${options([['*', '集团通用'], ...s.entityConfig.companies.map(c => [c.companyId, c.companyName])], v?.companyId || '*')}</select><button id="r008-new" ${admin ? '' : 'disabled'}>${v?.status === 'PUBLISHED' ? '复制为新草稿 / 回滚来源' : '创建新草稿'}</button></div>`;
        if (v) {
            const editable = admin && ['DRAFT', 'VALIDATED'].includes(v.status), prev = b.versions.find(x => x.versionId === v.replaces) || b.versions.find(x => x.versionId === v.sourceVersionId);
            const delta = diffs(prev ? { parameters: prev.parameters, companyId: prev.companyId, enabled: prev.enabled, effectiveFrom: prev.effectiveFrom, effectiveTo: prev.effectiveTo } : null, { parameters: v.parameters, companyId: v.companyId, enabled: v.enabled, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo });
            out += `<p>版本ID ${esc(v.versionId)} · v${v.versionNumber} · ${labels[v.status]} · ${v.enabled ? '规则启用' : '规则停用'} · ${v.status === 'PUBLISHED' && v.effectiveFrom > policyToday(new Date().toISOString()) ? '待生效' : '按业务日期匹配'}</p><form id="r008-edit"><fieldset ${editable ? '' : 'disabled'}><legend>配置字段${editable ? '（草稿保存不影响正式审核）' : '（只读）'}</legend><div class="form-grid"><label>适用法人<select name="companyId">${options([['*', '集团'], ...s.entityConfig.companies.map(c => [c.companyId, c.companyName])], v.companyId)}</select></label><label>启用状态<select name="enabled">${options([['true', '启用'], ['false', '停用：后续审核返回配置错误，不豁免内控']], String(v.enabled))}</select></label><label>生效日期<input name="effectiveFrom" type="date" value="${v.effectiveFrom}"></label><label>失效日期（可空）<input name="effectiveTo" type="date" value="${v.effectiveTo || ''}"></label><label>变更原因<input name="changeReason" value="${esc(v.changeReason)}" required></label></div>${parameters(v, s)}<details><summary>高级：完整结构化参数（新增标准/政策行，非可执行脚本）</summary><p>勾选后才使用JSON，且仍通过相同字段/金额/冲突校验。正常编辑上方表格不需JSON。</p><label><input type="checkbox" name="useJson">使用完整参数替代上方字段</label><textarea name="parameters" rows="12">${esc(JSON.stringify(v.parameters, null, 2))}</textarea></details><button class="primary">保存草稿</button></fieldset></form><h4>变更摘要（已保存字段）</h4><div class="table-wrap"><table id="r008-diff"><thead><tr><th>字段</th><th>原值</th><th>新值</th></tr></thead><tbody>${delta.map(d => differenceRow(d,v)).join('') || '<tr><td colspan="3">参数没有变化（仍须检查生效期、范围、启用状态）</td></tr>'}</tbody></table></div><div class="enterprise-buttons"><button id="r008-validate" ${editable ? '' : 'disabled'}>校验配置与冲突</button><button id="r008-publish" ${editable && v.simulation?.fingerprint === fingerprint(v) ? '' : 'disabled'}>发布此版本（需二次确认）</button><button id="r008-archive" ${editable ? '' : 'disabled'}>归档此草稿</button></div><p>关键规则启停仅管理员可发布，停用不变成审核通过。高风险：修改R002、职责分离、票种特例或预算模式需谨慎复核。</p><h4>真实规则模拟测试（独立内存）</h4><form id="r008-simulate"><div class="form-grid"><label>模拟法人<select name="companyId">${options(s.entityConfig.companies.map(c => [c.companyId, c.companyName]), v.companyId === '*' ? 'SZ' : v.companyId)}</select></label><label>模拟金额（元）<input name="amount" value="430"></label><label>入住日期<input name="date" type="date" value="${v.effectiveFrom}"></label><label>城市<input name="city" value="深圳"></label><label>职级<select name="grade">${options(['普通员工', '部门经理', '高级管理人员'], '普通员工')}</select></label></div><details><summary>完整模拟输入（票据、金额原因、费用类型等）</summary><label><input name="fullInput" type="checkbox">使用下方完整输入</label><textarea name="input" rows="10">${esc(JSON.stringify({ ...simulationInput(), companyId: v.companyId === '*' ? 'SZ' : v.companyId, checkIn: v.effectiveFrom, businessDate: v.effectiveFrom }, null, 2))}</textarea></details><button ${editable && v.status === 'VALIDATED' ? '' : 'disabled'}>运行新旧规则模拟</button></form>${v.simulation ? `<div id="r008-simulation"><table><thead><tr><th>当前正式规则</th><th>此草稿规则</th></tr></thead><tbody><tr><td>${esc(v.simulation.before.status)} · ${esc(v.simulation.before.message)}</td><td>${esc(v.simulation.after.status)} · ${esc(v.simulation.after.message)}</td></tr></tbody></table>${v.simulation.after.ruleId==='R001'?lodgingSimulation(v.simulation):''}<p>安全检查：${esc(v.simulation.checks.join('；'))}</p><details><summary>完整新旧结果/参数快照</summary><pre>${esc(JSON.stringify(v.simulation, null, 2))}</pre></details></div>` : ''}<h4>版本历史</h4><div class="table-wrap"><table><tbody>${vs.map(x => `<tr><td>v${x.versionNumber} · ${x.companyId}</td><td>${labels[x.status]} / ${x.enabled ? '启用' : '停用'} / ${x.effectiveFrom}</td><td>${esc(x.createdBy)} / ${esc(x.publishedBy || '未发布')}</td><td>${esc(x.changeReason)}</td><td><button data-r008-select="${x.versionId}">查看/选作回滚来源</button></td></tr>`).join('')}</tbody></table></div>`;
        }
        out += `<h4>追加式变更记录</h4><div class="table-wrap"><table id="r008-logs"><thead><tr><th>时间/人员</th><th>动作/原因</th><th>结果/差异</th></tr></thead><tbody>${b.logs.filter(l => l.ruleId === chosen).slice().reverse().map(l => `<tr><td>${esc(displayTime(l.operationTime))}<small>${esc(l.operatorName)} / ${esc(l.operatorId)}</small></td><td>${esc(l.actionType)}<small>${esc(l.changeReason)}</small></td><td>${esc(l.publishResult)}<details><summary>修改前后</summary><pre>${esc(JSON.stringify({ before: l.beforeValue, after: l.afterValue }, null, 2))}</pre></details></td></tr>`).join('')}</tbody></table></div>`;
    }
    return out + '</section>';
}
export function bindRuleManager(root, s, a, persist, render) {
    const action = (fn, msg) => { try {
        const next = fn();
        persist(next);
        render();
        root.querySelector('#r008-status').textContent = msg;
    }
    catch (e) {
        root.querySelector('#r008-error').textContent = String(e);
    } };
    const at = () => new Date().toISOString();
    root.querySelector('#r008-edit')?.addEventListener('input', () => { for (const el of root.querySelectorAll('#r008-validate,#r008-publish,#r008-simulate button'))
        el.disabled = true; root.querySelector('#r008-status').textContent = '有未保存的字段，请先保存草稿，再校验和模拟。'; });
    root.querySelector('#r008-init')?.addEventListener('click', () => action(() => { const r = loadState(localStorage); if (!r.ok)
        throw Error('原住宿标准无法读取，未导入'); return initializeRules(s, a, at(), r.state.standards); }, '已导入真实配置，历史审核未修改'));
    for (const [id, set] of [['r008-query', v => query = v], ['r008-company', v => company = v], ['r008-category', v => category = v], ['r008-status-filter', v => status = v]])
        root.querySelector('#' + id)?.addEventListener('change', e => { set(e.target.value); render(); });
    root.querySelectorAll('[data-r008-open]').forEach(el => el.addEventListener('click', () => { chosen = el.dataset.r008Open; versionId = el.dataset.version; render(); }));
    root.querySelectorAll('[data-r008-select]').forEach(el => el.addEventListener('click', () => { versionId = el.dataset.r008Select; render(); }));
    root.querySelector('#r008-version')?.addEventListener('change', e => { versionId = e.target.value; render(); });
    root.querySelector('#r008-new')?.addEventListener('click', () => action(() => { const next = draftRule(s, chosen, versionId || null, root.querySelector('#r008-new-company').value, a, at()); versionId = next.ruleBook.versions.at(-1).versionId; return next; }, '新草稿已创建，正式规则未变'));
    root.querySelector('#r008-edit')?.addEventListener('submit', e => {
        e.preventDefault();
        action(() => {
            const form = e.currentTarget, f = new FormData(form), v = s.ruleBook.versions.find(v => v.versionId === versionId), p = f.has('useJson') ? JSON.parse(f.get('parameters')) : structuredClone(v.parameters);
            if (!f.has('useJson'))
                form.querySelectorAll('[data-r008-path]').forEach(el => { const path = el.dataset.r008Path.split('.'); let o = p; for (const k of path.slice(0, -1))
                    o = o[k]; let value = el.value; const kind = el.dataset.kind; if (kind === 'money' || kind === 'nullableMoney') {
                    if (kind === 'nullableMoney' && !value.trim())
                        value = null;
                    else {
                        const n = parseYuan(value);
                        if (!n.ok)
                            throw Error('金额必须为有效的非负金额，最多两位小数');
                        value = n.cents;
                    }
                }
                else if (kind === 'number') {
                    if (!value.trim() || !Number.isFinite(Number(value)))
                        throw Error('数值字段不能为空且必须为有效数字');
                    value = Number(value);
                }
                else if (kind === 'boolean')
                    value = value === 'true';
                else if (kind === 'array' || kind === 'numbers')
                    value = value.split(/[,，]/).map(x => x.trim()).filter(Boolean).map(x => kind === 'numbers' ? Number(x) : x);
                else if (kind === 'nullable')
                    value = value || null; o[path.at(-1)] = value; });
            return updateRule(s, versionId, { companyId: f.get('companyId'), enabled: f.get('enabled') === 'true', effectiveFrom: f.get('effectiveFrom'), effectiveTo: f.get('effectiveTo') || null, changeReason: f.get('changeReason'), parameters: p }, a, at());
        }, '草稿已保存，需重新校验及模拟后才能发布');
    });
    root.querySelector('#r008-validate')?.addEventListener('click', () => action(() => validateDraft(s, versionId, a, at()), '配置与范围冲突检查通过，请继续真实模拟'));
    root.querySelector('#r008-simulate')?.addEventListener('submit', e => { e.preventDefault(); action(() => { const f = new FormData(e.currentTarget); let d = f.has('fullInput') ? JSON.parse(f.get('input')) : simulationInput(); if (!f.has('fullInput')) {
        d.companyId = f.get('companyId');
        d.amountYuan = d.hotelAmountYuan = d.invoices[0].amountYuan = f.get('amount');
        d.city = f.get('city');
        d.grade = f.get('grade');
        d.checkIn = d.businessDate = d.invoices[0].date = f.get('date');
        const t = new Date(d.checkIn + 'T00:00:00Z');
        t.setUTCDate(t.getUTCDate() + 1);
        d.checkOut = t.toISOString().slice(0, 10);
        const c = s.entityConfig.companies.find(c => c.companyId === d.companyId);
        d.invoices[0].buyerName = c?.companyName || '';
        d.invoices[0].buyerTaxId = c?.taxpayerId || '';
    } return simulateDraft(s, versionId, d, a, at()); }, '新旧真实结果已保存，未产生报销/预算/审批写入'); });
    root.querySelector('#r008-archive')?.addEventListener('click', () => action(() => archiveDraft(s, versionId, a, at()), '草稿已归档，不影响已发布制度'));
    root.querySelector('#r008-publish')?.addEventListener('click', () => { const v = s.ruleBook.versions.find(v => v.versionId === versionId); if (!confirm(`确认发布${v.ruleId} v${v.versionNumber}？\n范围：${v.companyId}\n生效：${v.effectiveFrom}\n${v.enabled ? '启用' : '停用（将阻止新审核通过）'}\n原因：${v.changeReason}\n请先核对页面变更摘要。历史审核保持不变。`))
        return; action(() => publishRule(s, versionId, a, at(), true), '版本已发布；后续审核按法人和业务日期读取，历史结果未修改'); });
}
