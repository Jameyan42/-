import test from 'node:test';
import assert from 'node:assert/strict';
import { createExampleStandards } from '../r001/standards';
import { empty, saveDraft, execute, current, validate, save, load, KEY } from './model';
import { auditAll, registry, historyRow } from './rules';
import { initializeRules, draftRule, updateRule, validateDraft, simulateDraft, publishRule, runSimulation, simulationInput, simulationContext } from './rule-config-model';
import { resolveVersion, resolveAll, applySelection, type RuleId, type RuleVersion } from './rule-config';
// @ts-ignore Shared existing organization module.
import { defaultOrg } from '../organization.js';
import { submitWorkflow, activeWorkflow } from './workflow-model';
import { approvalNodes, selectPolicy } from './workflow-rule';
import { reconcileBudget, seedBudgetOpening } from './budget-model';
import { budgetRule, requiredBudgetEscalation, sameEscalation } from './budget-rule';
import type { State, Input } from './types';
const at = '2026-10-31T02:00:00.000Z', a = { id: 'admin-gu', name: '顾远', role: '管理员' };
function init() { return initializeRules(empty(), a, at, createExampleStandards()); }
function input() { const d = simulationInput(); d.checkIn = d.businessDate = '2026-10-30'; d.checkOut = '2026-10-31'; d.invoices[0]!.date = '2026-10-30'; return d; }
function result(s: State, id: RuleId, d = input(), time = at) { return auditAll(d, simulationContext(s, d, time), registry.filter(r => r.ruleId === id))[0]!; }
function drafted(s: State, id: RuleId, company = '*') {
    const source = s.ruleBook!.versions.filter(v => v.ruleId === id && v.status === 'PUBLISHED' && v.companyId === company).at(-1) || s.ruleBook!.versions.find(v => v.ruleId === id && v.status === 'PUBLISHED');
    s = draftRule(s, id, source?.versionId || null, company, a, at);
    return s;
}
function updated(s: State, mutate: (v: RuleVersion) => void) { const v = structuredClone(s.ruleBook!.versions.at(-1)!); v.effectiveFrom = '2026-10-30'; v.changeReason = '自动化：模拟企业制度变更'; mutate(v); return updateRule(s, v.versionId, v, a, at); }
function publish(s: State, d = input()) { const id = s.ruleBook!.versions.at(-1)!.versionId; s = validateDraft(s, id, a, at); s = simulateDraft(s, id, d, a, at); return publishRule(s, id, a, at, true); }
function rate(s: State, cents: number, co = '*') { s = drafted(s, 'R001', co); s = updated(s, v => { (v.parameters as any).standards.rows.find((r: any) => r.city === '深圳' && r.grade === '普通员工').nightlyRateCents = cents; }); return s; }
test('T001/T003 显式导入真实已有标准，草稿保存不影响正式审核，只有七条规则', () => {
    const s = init(), n = rate(s, 40000);
    assert.equal(result(s, 'R001').status, 'PASS');
    assert.equal(result(n, 'R001').status, 'PASS');
    assert.equal(registry.length, 7);
    assert.equal((result(n, 'R001').evidence as any).standardSnapshot.nightlyRateCents, 50000);
    validate(n);
});
test('T002/T004/T005 400→450模拟430 REVIEW→PASS，发布确实生效', () => {
    let s = publish(rate(init(), 40000));
    s = rate(s, 45000);
    const id = s.ruleBook!.versions.at(-1)!.versionId;
    s = validateDraft(s, id, a, at);
    s = simulateDraft(s, id, input(), a, at);
    const sim = s.ruleBook!.versions.at(-1)!.simulation!;
    assert.equal(sim.before.status, 'REVIEW');
    assert.equal(sim.after.status, 'PASS');
    assert.equal((sim.before.evidence as any).excessCents, 3000);
    s = publishRule(s, id, a, at, true);
    assert.equal(result(s, 'R001').status, 'PASS');
    assert.equal((result(s, 'R001').evidence as any).limitCents, 45000);
    validate(s);
});
test('T006 历史批次保留旧参数版本，发布不修改旧批次，刷新能验证', () => {
    let s = publish(rate(init(), 40000)), d = input();
    s = saveDraft(s, d, at);
    s = execute(s, d.id, { ...simulationContext(s, d, at), budgetOrg: defaultOrg() }, 'OLD');
    const old = JSON.stringify(current(s.claims[0]!)!);
    s = publish(rate(s, 45000));
    assert.equal(JSON.stringify(current(s.claims[0]!)!), old);
    s = execute(s, d.id, { ...simulationContext(s, d, at), budgetOrg: defaultOrg() }, 'NEW');
    assert.equal(current(s.claims[0]!)!.results[0]!.status, 'PASS');
    assert.equal(s.claims[0]!.batches[0]!.results[0]!.status, 'REVIEW');
    validate(s);
});
test('T007 集团/法人完整参数集优先，深圳450东莞350', () => {
    let s = publish(rate(init(), 45000, 'SZ'));
    const dg = { ...input(), companyId: 'DG' };
    s = publish(rate(s, 35000, 'DG'), dg);
    const d = input();
    d.amountYuan = d.hotelAmountYuan = '400';
    assert.equal(result(s, 'R001', d).status, 'PASS');
    assert.equal(result(s, 'R001', { ...d, companyId: 'DG' }).status, 'REVIEW');
    assert.equal(result(s, 'R001', { ...d, companyId: 'SH' }).configuration!.version!.companyId, '*');
});
test('T008/T023 同范围期间冲突和并行草稿分叉阻止发布', () => {
    let s = rate(init(), 40000);
    const first = s.ruleBook!.versions.at(-1)!;
    s = rate(s, 45000);
    const second = s.ruleBook!.versions.at(-1)!;
    s = validateDraft(s, first.versionId, a, at);
    s = simulateDraft(s, first.versionId, input(), a, at);
    s = publishRule(s, first.versionId, a, at, true);
    assert.throws(() => validateDraft(s, second.versionId, a, at), /冲突/);
});
test('T009 负数/字符串/小数分/重复城市职级配置无效，保留原值', () => {
    const s = rate(init(), 40000), before = JSON.stringify(s);
    for (const value of [-1, 'abc', 0.1, Number.MAX_SAFE_INTEGER + 1])
        assert.throws(() => updated(s, v => (v.parameters as any).standards.rows[0].nightlyRateCents = value), /非负金额/);
    assert.throws(() => updated(s, v => (v.parameters as any).standards.rows.push((v.parameters as any).standards.rows[0])), /冲突/);
    assert.equal(JSON.stringify(s), before);
});
test('T010 未来业务日期和审核时钟双重门槛，不能提前使用', () => {
    let s = rate(init(), 45000);
    s = updated(s, v => v.effectiveFrom = '2026-11-01');
    const future = { ...input(), businessDate: '2026-11-01', checkIn: '2026-11-01', checkOut: '2026-11-02' };
    s = publish(s, future);
    assert.equal(resolveVersion(s.ruleBook!, future, 'R001', at).version!.versionNumber, 1);
    assert.equal(resolveVersion(s.ruleBook!, future, 'R001', '2026-11-01T00:00:00.000Z').version!.versionNumber, 2);
    assert.equal(resolveVersion(s.ruleBook!, input(), 'R001', '2026-11-01T00:00:00.000Z').version!.versionNumber, 1);
});
test('T011 回滚以新版本复制历史内容，旧发布对象不可变', () => {
    let s = publish(rate(init(), 40000)), v1 = structuredClone(s.ruleBook!.versions.find(v => v.ruleId === 'R001')!);
    s = draftRule(s, 'R001', v1.versionId, '*', a, at);
    s = updated(s, () => { });
    s = publish(s);
    assert.equal(result(s, 'R001').configuration!.version!.versionNumber, 3);
    assert.equal((result(s, 'R001').evidence as any).limitCents, 50000);
    assert.deepEqual(s.ruleBook!.versions.find(v => v.versionId === v1.versionId), v1);
});
test('T012 查重策略真实生效，确定重复不能配置PASS，源字段/历史不缩小', () => {
    let s = drafted(init(), 'R002');
    s = updated(s, v => (v.parameters as any).exactAction = 'BLOCK');
    s = publish(s);
    const d = input(), c = simulationContext(s, d, at), h = historyRow({ ...d, id: 'OTHER' }, { ...d.invoices[0]!, id: 'OTHERINV' }, at, '已通过')!;
    const r = auditAll(d, { ...c, invoiceHistory: [h] }, registry.filter(r => r.ruleId === 'R002'))[0]!;
    assert.equal(r.status, 'BLOCK');
    s = drafted(s, 'R002');
    assert.throws(() => updated(s, v => (v.parameters as any).exactAction = 'PASS'), /不得/);
    assert.throws(() => updated(s, v => (v.parameters as any).historyScope = 'ONLY_APPROVED'), /不得/);
});
test('T013 部分报销允许/原因/费用类型真实应用；超票额零额负数不误放', () => {
    let s = drafted(init(), 'R003');
    s = updated(s, v => Object.assign(v.parameters, { allowPartial: true, requirePartialReason: true, partialAction: 'PASS', expenseTypes: ['住宿费', '办公费'] }));
    s = publish(s);
    const d = input();
    d.invoices[0]!.amountYuan = '1000';
    d.amountYuan = d.hotelAmountYuan = '800';
    assert.equal(result(s, 'R003', d).status, 'PASS');
    assert.equal(result(s, 'R003', { ...d, partialReason: '' }).status, 'INSUFFICIENT_DATA');
    assert.equal(result(s, 'R003', { ...d, expenseType: '办公费' }).status, 'PASS');
    assert.equal(result(s, 'R003', { ...d, amountYuan: '1100' }).status, 'BLOCK');
    assert.notEqual(result(s, 'R003', { ...d, amountYuan: '0' }).status, 'PASS');
});
test('T014 R004票种政策真实生效，名称税号仍来自唯一法人主数据', () => {
    let s = drafted(init(), 'R004');
    s = updated(s, v => (v.parameters as any).policies.push({ invoiceType: '特殊票据演示', applicable: false, requireTaxId: false, reason: '明确模拟特例，不豁免其他规则' }));
    s = publish(s);
    const d = input();
    d.invoices[0]!.type = '特殊票据演示';
    assert.equal(result(s, 'R004', d).status, 'NOT_APPLICABLE');
    assert.equal('companies' in (s.ruleBook!.versions.at(-1)!.parameters as object), false);
    d.invoices[0]!.type = '数电发票';
    d.invoices[0]!.buyerTaxId = 'DEMO-DG-001';
    assert.equal(result(s, 'R004', d).status, 'BLOCK');
});
test('T015 R005新映射影响实际审核，推荐须在现有允许科目范围，冲突失败', () => {
    let s = drafted(init(), 'R005');
    s = updated(s, v => { const m = (v.parameters as any).mappings[0]; m.allowedAccountCodes = ['6602.11']; m.recommendedAccountCode = '6602.11'; });
    s = publish(s);
    assert.equal(result(s, 'R005').status, 'BLOCK');
    assert.equal(result(s, 'R005', { ...input(), accountCode: '6602.11' }).status, 'PASS');
    s = drafted(s, 'R005');
    assert.throws(() => updated(s, v => (v.parameters as any).mappings[0].recommendedAccountCode = 'INVALID'), /科目/);
    assert.throws(() => updated(s, v => (v.parameters as any).mappings.push({ ...((v.parameters as any).mappings[0]), ruleId: 'CONFLICT' })), /冲突/);
});
test('T016 新R006阈值2000使1500仅一节点，已有流程和附件锁定旧政策', () => {
    let s = init(), d = input();
    d.amountYuan = d.hotelAmountYuan = '1500';
    s = saveDraft(s, d, at);
    s = submitWorkflow(s, d.id, defaultOrg(), a, '模拟提交', at, 'WF-OLD');
    const old = structuredClone(activeWorkflow(s.claims[0]!)!);
    assert.equal(approvalNodes(d, old.org, selectPolicy(d, old.config.approvalPolicies).policy!).length, 2);
    s = drafted(s, 'R006');
    s = updated(s, v => { for (const p of (v.parameters as any).approvalPolicies.filter((p: any) => p.companyId === 'SZ'))
        if (p.maxAmount !== null)
            p.maxAmount = 200000;
        else
            p.minAmount = 200001; });
    s = publish(s);
    assert.deepEqual(activeWorkflow(s.claims[0]!), old);
    const d2 = { ...d, id: 'NEXT' };
    s = saveDraft(s, d2, at);
    s = submitWorkflow(s, d2.id, defaultOrg(), a, '新政策提交', at, 'WF-NEW');
    const nw = activeWorkflow(s.claims.find(x => x.id === d2.id)!)!;
    assert.equal(approvalNodes(d2, nw.org, selectPolicy(d2, nw.config.approvalPolicies).policy!).length, 1);
    assert.equal(resolveAll(s, d, at)!.find(v => v.ruleId === 'R006')!.version!.versionNumber, 1);
    validate(s);
});
test('T017/T018 R007 80→90在85%时预警变化，模拟与发布均不改预算金额/流水', () => {
    let s = init();
    s = seedBudgetOpening(s, 'B-SZ-sales-住宿费-2026-10', 800000, 0, a, at, 'OPEN');
    let d = input();
    d.amountYuan = d.hotelAmountYuan = '500';
    const original = JSON.stringify(s.budgetBook);
    s = drafted(s, 'R007');
    s = updated(s, v => (v.parameters as any).policies.find((p: any) => p.expenseType === '住宿费').warningThresholds = [90, 100]);
    s = validateDraft(s, s.ruleBook!.versions.at(-1)!.versionId, a, at);
    s = simulateDraft(s, s.ruleBook!.versions.at(-1)!.versionId, d, a, at);
    const sim = s.ruleBook!.versions.at(-1)!.simulation!;
    assert.match(sim.before.message, /80%/);
    assert.doesNotMatch(sim.after.message, /80%/);
    assert.equal(JSON.stringify(s.budgetBook), original);
    s = publishRule(s, s.ruleBook!.versions.at(-1)!.versionId, a, at, true);
    assert.equal(JSON.stringify(s.budgetBook), original);
    assert.doesNotMatch(result(s, 'R007', d).message, /预警/);
    validate(s);
});
test('R007 发布HARD策略确实阻止预占，SOFT与具名授权绑定规则版本', () => {
    let s = init();
    s = drafted(s, 'R007');
    s = updated(s, v => { const p = (v.parameters as any).policies.find((p: any) => p.expenseType === '住宿费'); p.controlMode = 'SOFT'; });
    s = publish(s);
    const d = input();
    d.amountYuan = d.hotelAmountYuan = '11000';
    s = saveDraft(s, d, at);
    s = reconcileBudget(s, d.id, 'RES', at, a, defaultOrg());
    assert.equal(s.budgetBook!.transactions.at(-1)!.after.reserved, 1100000);
    const ctx = applySelection(d, simulationContext(s, d, at), resolveVersion(s.ruleBook!, d, 'R007', at));
    const esc = requiredBudgetEscalation(d, { ...ctx, ruleSelections: resolveAll(s, d, at) }, defaultOrg())!;
    assert.ok(esc.ruleVersionId);
    assert.equal(sameEscalation(esc, { ...esc, ruleVersionId: 'NEW' }), false);
    s = drafted(s, 'R007');
    s = updated(s, v => (v.parameters as any).policies.find((p: any) => p.expenseType === '住宿费').controlMode = 'HARD');
    s = publish(s);
    assert.equal(result(s, 'R007', d).status, 'BLOCK');
    assert.throws(() => reconcileBudget(s, d.id, 'RES2', at, a, defaultOrg()), /预算未通过/);
});
test('T019 普通财务/员工不能创建编辑模拟或发布', () => {
    const s = rate(init(), 40000), id = s.ruleBook!.versions.at(-1)!.versionId;
    for (const role of ['员工', '财务', '主管']) {
        const actor = { ...a, role };
        assert.throws(() => draftRule(s, 'R001', id, '*', actor, at), /管理员/);
        assert.throws(() => validateDraft(s, id, actor, at), /管理员/);
        assert.throws(() => simulateDraft(s, id, input(), actor, at), /管理员/);
        assert.throws(() => publishRule(s, id, actor, at, true), /管理员/);
    }
});
test('T020 管理员停用有确认限制，后续审核不默认通过', () => {
    let s = drafted(init(), 'R002');
    s = updated(s, v => v.enabled = false);
    s = validateDraft(s, s.ruleBook!.versions.at(-1)!.versionId, a, at);
    s = simulateDraft(s, s.ruleBook!.versions.at(-1)!.versionId, input(), a, at);
    assert.throws(() => publishRule(s, s.ruleBook!.versions.at(-1)!.versionId, a, at, false), /二次确认/);
    s = publishRule(s, s.ruleBook!.versions.at(-1)!.versionId, a, at, true);
    assert.equal(result(s, 'R002').status, 'INSUFFICIENT_DATA');
});
test('T021 保存失败/并发不改变有效正式配置，状态仅在成功持久化后替换', () => {
    const old = init(), n = publish(rate(old, 40000));
    let raw = JSON.stringify(old);
    const storage = { getItem: () => raw, setItem: () => { throw Error('QUOTA'); } };
    assert.throws(() => save(storage, n, raw), /保存失败/);
    assert.equal((load(storage).state.ruleBook!.versions.filter(v => v.ruleId === 'R001')).length, 1);
    const stale = raw;
    raw = JSON.stringify(n);
    assert.throws(() => save(storage, old, stale), /其他页面/);
});
test('T022 刷新恢复草稿、版本及日志；改草稿清除旧测试证据', () => {
    let s = rate(init(), 40000);
    s = validateDraft(s, s.ruleBook!.versions.at(-1)!.versionId, a, at);
    s = simulateDraft(s, s.ruleBook!.versions.at(-1)!.versionId, input(), a, at);
    s = updated(s, v => (v.parameters as any).standards.rows[0].nightlyRateCents = 45000);
    assert.equal(s.ruleBook!.versions.at(-1)!.simulation, undefined);
    assert.throws(() => publishRule(s, s.ruleBook!.versions.at(-1)!.versionId, a, at, true), /校验/);
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; } };
    save(storage, s, null);
    assert.deepEqual(load(storage).state, s);
});
test('T024 配置丢失或同级冲突 fail closed；旧单没有公司不自动套集团通过', () => {
    let s = init();
    s.ruleBook!.versions = s.ruleBook!.versions.filter(v => v.ruleId !== 'R001');
    assert.equal(result(s, 'R001').status, 'ERROR');
    s = init();
    const v = structuredClone(s.ruleBook!.versions[0]!);
    v.versionId = 'CONFLICT';
    v.versionNumber = 90;
    s.ruleBook!.versions.push(v);
    assert.equal(result(s, 'R001').status, 'ERROR');
    assert.equal(result(init(), 'R001', { ...input(), companyId: '' }).status, 'ERROR');
});
test('T025 旧七规则批次没有版本，不补造版本；导入后原结果仍可读取', () => {
    let s = empty();
    const d = input();
    s = saveDraft(s, d, at);
    s = execute(s, d.id, { ...simulationContext(s, d, at), budgetOrg: defaultOrg() }, 'LEGACY');
    const old = JSON.stringify(s.claims[0]!.batches);
    s = initializeRules(s, a, at, createExampleStandards());
    assert.equal(JSON.stringify(s.claims[0]!.batches), old);
    assert.equal(s.claims[0]!.batches[0]!.results[0]!.configuration, undefined);
    validate(s);
});
test('反复模拟不会递归嵌套旧模拟，发布参数不允许任意脚本字段', () => {
    let s = rate(init(), 40000), id = s.ruleBook!.versions.at(-1)!.versionId;
    s = validateDraft(s, id, a, at);
    for (let i = 0; i < 3; i++)
        s = simulateDraft(s, id, input(), a, at);
    assert.equal(s.ruleBook!.versions.at(-1)!.simulation!.after.configuration!.version!.simulation, undefined);
    assert.throws(() => updated(s, v => (v.parameters as any).script = 'eval(1)'), /不支持/);
});
test('集团已有法人覆盖后仍可创建集团新版本，不错误替代法人政策', () => {
    let s = publish(rate(init(), 45000, 'SZ'));
    s = rate(s, 48000, '*');
    s = publish(s);
    assert.equal((result(s, 'R001').evidence as any).limitCents, 45000);
    assert.equal((result(s, 'R001', { ...input(), companyId: 'SH' }).evidence as any).limitCents, 48000);
});
test('上海日历生效，不在UTC晚8小时；缺少标准保留真实复核', () => {
    const s0 = rate(init(), 45000);
    let s = updated(s0, v => v.effectiveFrom = '2026-11-01');
    const d = { ...input(), businessDate: '2026-11-01', checkIn: '2026-11-01', checkOut: '2026-11-02' };
    s = publish(s, d);
    assert.equal(resolveVersion(s.ruleBook!, d, 'R001', '2026-10-31T16:00:00.000Z').version!.versionNumber, 2);
    assert.equal(result(s, 'R001', { ...d, city: '未配置城市' }, '2026-11-01T00:00:00.000Z').status, 'REVIEW');
});
test('R006 已有旧流程在显式初始化和发布后仍锁定原政策，不补造旧版本', () => {
    let s = empty(), d = input();
    s = saveDraft(s, d, at);
    s = submitWorkflow(s, d.id, defaultOrg(), a, '旧版本模拟提交', at, 'WF');
    const old = structuredClone(activeWorkflow(s.claims[0]!)!);
    s = initializeRules(s, a, at, createExampleStandards());
    s = drafted(s, 'R006');
    s = updated(s, v => (v.parameters as any).attachmentPolicies[0].requirements[1].required = false);
    s = publish(s);
    const x = resolveAll(s, d, at)!.find(v => v.ruleId === 'R006')!;
    assert.equal(x.version, null);
    assert.match(x.basis, /不可确认/);
    assert.deepEqual(activeWorkflow(s.claims[0]!), old);
    validate(s);
});
test('已发布对象不能就地修改，草稿归档后不可编辑或发布，可复制成新草稿', async () => {
    const { archiveDraft } = await import('./rule-config-model');
    let s = init();
    const official = s.ruleBook!.versions[0]!;
    assert.throws(() => updateRule(s, official.versionId, official, a, at), /只读/);
    s = rate(s, 45000);
    const v = s.ruleBook!.versions.at(-1)!;
    s = archiveDraft(s, v.versionId, a, at);
    assert.equal(s.ruleBook!.versions.at(-1)!.status, 'ARCHIVED');
    assert.throws(() => validateDraft(s, v.versionId, a, at), /只能/);
    s = draftRule(s, 'R001', v.versionId, '*', a, at);
    assert.equal(s.ruleBook!.versions.at(-1)!.status, 'DRAFT');
    validate(s);
});
test('R003不适用范围不假通过，新增费用类型0元需复核；有原因也不能越票额', () => {
    let s = drafted(init(), 'R003');
    s = updated(s, v => Object.assign(v.parameters, { expenseTypes: ['办公费'], partialAction: 'PASS', requirePartialReason: true }));
    s = publish(s);
    assert.equal(result(s, 'R003').status, 'NOT_APPLICABLE');
    const d = { ...input(), expenseType: '办公费', amountYuan: '0' };
    assert.equal(result(s, 'R003', d).status, 'REVIEW');
    d.amountYuan = '9999';
    assert.equal(result(s, 'R003', d).status, 'BLOCK');
});
test('R007统一接管后旧预算入口不能改策略，但仍能改额度且不改流水', async () => {
    const { configureBudgets } = await import('./budget-model');
    let s = drafted(init(), 'R007');
    s = updated(s, () => { });
    s = publish(s);
    let rows = structuredClone(s.budgetBook!.budgets);
    rows[0]!.controlMode = 'WARNING';
    assert.throws(() => configureBudgets(s, rows, a, '模拟改策略', at, 'C1'), /R008/);
    rows = structuredClone(s.budgetBook!.budgets);
    rows[0]!.budgetAmount += 10000;
    s = configureBudgets(s, rows, a, '模拟预算追加', at, 'C2');
    assert.equal(s.budgetBook!.transactions.filter(t => t.scope === 'CLAIM').length, 0);
    assert.equal(s.budgetBook!.budgets[0]!.budgetAmount, 1010000);
    validate(s);
});
test('未知法人/费用映射、无效预算阈值、审批区间冲突均不能保存有效草稿', () => {
    for (const id of ['R005', 'R006', 'R007'] as RuleId[]) {
        const s = drafted(init(), id);
        assert.throws(() => updated(s, v => { const p = v.parameters as any; if (id === 'R005')
            p.mappings[0].companyId = 'UNKNOWN'; if (id === 'R006')
            p.approvalPolicies[1].minAmount = 0; if (id === 'R007')
            p.policies[0].warningThresholds = [-1, 90]; }));
    }
});
test('模拟只读业务对象，R006附件规则变化真实影响材料检查', () => {
    let s = drafted(init(), 'R006');
    s = updated(s, v => (v.parameters as any).attachmentPolicies[0].requirements.forEach((x: any) => x.required = false));
    const before = JSON.stringify([s.claims, s.budgetBook]), sim = runSimulation(s, s.ruleBook!.versions.at(-1)!.versionId, input(), at);
    assert.equal((sim.before.evidence as any).attachments.status, 'INSUFFICIENT_DATA');
    assert.equal((sim.after.evidence as any).attachments.status, 'PASS');
    assert.equal(JSON.stringify([s.claims, s.budgetBook]), before);
});
test('R007无适用法人策略时单规则失败不终止其他六规则，提交仍禁止占用', () => {
    let s = drafted(init(), 'R007', 'SZ');
    s = updated(s, () => { });
    s = publish(s);
    const d = { ...input(), companyId: 'DG' };
    s = saveDraft(s, d, at);
    s = execute(s, d.id, { ...simulationContext(s, d, at), budgetOrg: defaultOrg() }, 'MISSING-BUDGET-POLICY');
    const b = current(s.claims[0]!)!;
    assert.equal(b.results.length, 7);
    assert.equal(b.results[6]!.status, 'ERROR');
    assert.equal(b.results[0]!.status, 'PASS');
    assert.throws(() => reconcileBudget(s, d.id, 'FAIL-RES', at, a, defaultOrg()), /预算未通过/);
    validate(s);
});
test('首个R007未来发布在生效前完全沿用原策略，不会提前关闭预算或改变正式审核',()=>{
 let s=drafted(init(),'R007');s=updated(s,v=>{v.effectiveFrom='2026-11-01';(v.parameters as any).policies[0].controlMode='WARNING';});s=publish(s,{...input(),checkIn:'2026-11-01',checkOut:'2026-11-02',businessDate:'2026-11-01'});assert.equal(result(s,'R007').configuration!.version,null);assert.equal(result(s,'R007').status,'PASS');const d=input();s=saveDraft(s,d,at);s=reconcileBudget(s,d.id,'FUTURE-BASELINE',at,a,defaultOrg());assert.equal(s.budgetBook!.transactions.at(-1)!.after.reserved,43000);assert.equal(result(s,'R007',{...d,checkIn:'2026-11-01',checkOut:'2026-11-02',businessDate:'2026-11-01'},'2026-11-01T00:00:00.000Z').configuration!.version!.versionNumber,1);validate(s);
});
