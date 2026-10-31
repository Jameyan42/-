import { test, expect } from '@playwright/test';
import { addMaterials, completeBusiness } from './r006-helpers.js';
const root = p => p.locator('#s001-root'), state = p => p.evaluate(() => JSON.parse(localStorage.getItem('qingbao-s001-v1')));
async function center(p) { await p.locator('aside [data-page="审核规则"]').click(); }
async function setup(p) { await p.goto('/?view=claims'); await p.locator('#role').selectOption('管理员'); await p.locator('#actor').selectOption('admin-gu'); await center(p); await p.locator('#r008-init').click(); await expect(p.locator('#r008-status')).toContainText('已导入'); }
async function selectRule(p, id) { await p.locator(`[data-r008-open="${id}"]`).first().click(); }
async function draft(p, id = 'R001', co = '*') {
    await selectRule(p, id);
    await p.locator('#r008-new-company').selectOption(co);
    await p.locator('#r008-new').click();
    await expect(p.locator('#r008-status')).toContainText('新草稿');
}
async function save(p, date = '2026-10-20') {
    await p.locator('#r008-edit [name=effectiveFrom]').fill(date);
    await p.locator('#r008-edit [name=changeReason]').fill('端到端：模拟制度调整');
    await p.locator('#r008-edit button.primary').click();
    await expect(p.locator('#r008-status')).toContainText('草稿已保存');
}
async function simulate(p, amount = '430', date = '2026-10-20') {
    await p.locator('#r008-validate').click();
    await expect(p.locator('#r008-status')).toContainText('检查通过');
    await p.locator('#r008-simulate [name=amount]').fill(amount);
    await p.locator('#r008-simulate [name=date]').fill(date);
    await p.locator('#r008-simulate button').click();
    await expect(p.locator('#r008-simulation')).toBeVisible();
}
async function publish(p) { p.once('dialog', d => d.accept()); await p.locator('#r008-publish').click(); await expect(p.locator('#r008-status')).toContainText('版本已发布'); }
async function rate(p, n, co = '*') { await draft(p, 'R001', co); await p.locator('[data-r008-path="standards.rows.0.nightlyRateCents"]').fill(n); await save(p); await simulate(p); await publish(p); }
async function claim(p, amount = '430', co = 'SZ') {
    await p.locator('aside [data-page="报销单管理"]').click();
    await p.locator('#s001-new').click();
    await p.locator('#s001-example').click();
    const f = n => p.locator(`#s001-form [name="${n}"]`);
    await f('companyId').selectOption(co);
    await f('amountYuan').fill(amount);
    await f('hotelAmountYuan').fill(amount);
    await f('checkOut').fill('2026-10-21');
    await p.locator('[data-field=amountYuan]').fill(amount);
    await p.locator('#s001-form button[type=submit]').click();
    await expect(p.locator('.s001-rule')).toHaveCount(7);
}
test('A 400→450 草稿隔离/模拟差异/二次发布/正式审核/历史/刷新', async ({ page: p }) => {
    await setup(p);
    await rate(p, '400');
    await claim(p);
    await expect(p.locator('[data-rule-key="lodging.limit"]')).toContainText('超标 ¥ 30.00');
    const first = (await state(p)).claims[0].batches[0];
    await center(p);
    await draft(p);
    await p.locator('[data-r008-path="standards.rows.0.nightlyRateCents"]').fill('450');
    await save(p);
    await simulate(p);
    await expect(p.locator('#r008-simulation')).toContainText('REVIEW');
    await expect(p.locator('#r008-simulation')).toContainText('每晚标准');
    await expect(p.locator('#r008-simulation')).toContainText('400.00 元');
    await expect(p.locator('#r008-simulation')).toContainText('450.00 元');
    await expect(p.locator('#r008-simulation')).toContainText('30.00 元');
    await expect(p.locator('#r008-simulation')).toContainText('PASS');
    expect(JSON.stringify((await state(p)).claims[0].batches[0])).toBe(JSON.stringify(first));
    // A cancelled confirmation must not publish.
    p.once('dialog', d => d.dismiss());
    await p.locator('#r008-publish').click();
    expect((await state(p)).ruleBook.versions.at(-1).status).toBe('VALIDATED');
    await publish(p);
    await claim(p);
    await expect(p.locator('[data-rule-key="lodging.limit"] > summary')).toContainText('通过');
    const s = await state(p);
    expect(s.claims.at(-1).batches[0]).toEqual(first);
    expect(s.claims[0].batches[0].results[0].configuration.version.versionNumber).toBe(3);
    await p.reload();
    await center(p);
    await selectRule(p, 'R001');
    await expect(p.locator('#r008-logs')).toContainText('PUBLISH');
    await expect(p.locator('#r008-center')).toContainText('已发布');
});
test('B 深圳450东莞350同金额400，不同法人同一个函数', async ({ page: p }) => {
    await setup(p);
    await rate(p, '450', 'SZ');
    await rate(p, '350', 'DG');
    await claim(p, '400', 'SZ');
    await expect(p.locator('[data-rule-key="lodging.limit"] > summary')).toContainText('通过');
    await claim(p, '400', 'DG');
    await expect(p.locator('[data-rule-key="lodging.limit"]')).toContainText('超标 ¥ 50.00');
});
test('C R006阈值1000→2000，1500新流程一节点，旧流程两节点快照不变', async ({ page: p }) => {
    await setup(p);
    await p.locator('#role').selectOption('财务');
    async function saveClaim() { await p.locator('aside [data-page="报销单管理"]').click(); await p.locator('#s001-new').click(); await p.locator('#s001-example').click(); await p.locator('#s001-form [name=amountYuan]').fill('1500'); await p.locator('#s001-form [name=hotelAmountYuan]').fill('1500'); await p.locator('#s001-draft').click(); await p.locator('[data-detail-s001]').first().click(); await p.locator('#r006-action-form [name=comment]').fill('模拟提交审批'); await p.locator('#r006-action-form [value=submit]').click(); }
    await saveClaim();
    let s = await state(p);
    const old = structuredClone(s.claims[0].workflows[0]);
    await p.locator('#role').selectOption('管理员');
    await center(p);
    await draft(p, 'R006');
    await p.locator('[data-r008-path="approvalPolicies.2.maxAmount"]').fill('2000');
    await p.locator('[data-r008-path="approvalPolicies.3.minAmount"]').fill('2000.01');
    await save(p);
    await simulate(p, '1500');
    await publish(p);
    await p.locator('#role').selectOption('财务');
    await saveClaim();
    s = await state(p);
    expect(s.claims.at(-1).workflows[0]).toEqual(old);
    const cfg = s.claims[0].workflows[0].config;
    expect(cfg.approvalPolicies.find(x => x.policyId === 'AP-SZ-LOW').maxAmount).toBe(200000);
    await expect(p.locator('#r006-action-form')).not.toContainText('第2级');
});
test('D R007 85%使用率，80→90模拟预警不同且零流水副作用', async ({ page: p }) => {
    await setup(p);
    await p.locator('aside [data-page="预算管理"]').click();
    await p.locator('[data-r007-open="B-SZ-sales-住宿费-2026-10"]').click();
    await p.locator('#r007-opening [name=usedYuan]').fill('8000');
    await p.locator('#r007-opening [name=reservedYuan]').fill('0');
    await p.locator('#r007-opening button').click();
    const before = (await state(p)).budgetBook;
    await center(p);
    await draft(p, 'R007');
    await p.locator('[data-r008-path="policies.0.warningThresholds"]').fill('90,100');
    await save(p);
    await simulate(p, '500');
    const sim = (await state(p)).ruleBook.versions.at(-1).simulation;
    expect(sim.before.message).toContain('80%');
    expect(sim.after.message).not.toContain('预警');
    expect((await state(p)).budgetBook).toEqual(before);
    await publish(p);
    expect((await state(p)).budgetBook).toEqual(before);
});
test('E 启用版本管理后七规则→材料审批→财务批准→预算一次消耗→历史', async ({ page: p }) => {
    await setup(p);
    await p.locator('#role').selectOption('财务');
    await p.locator('aside [data-page="报销单管理"]').click();
    await p.locator('#s001-new').click();
    await p.locator('#s001-example').click();
    await p.locator('#s001-form [name=accountStage]').selectOption('财务确认');
    await p.locator('#s001-form [name=accountCode]').selectOption('6602.01');
    await addMaterials(p);
    await p.locator('#s001-draft').click();
    await p.locator('[data-detail-s001]').first().click();
    await completeBusiness(p);
    await expect(p.locator('.s001-rule.PASS')).toHaveCount(7);
    await p.locator('#s001-review-form [name=reason]').fill('核实七项规则及配置版本');
    await p.locator('#s001-review-form [value=approved]').click();
    await expect(p.getByTestId('s001-review')).toContainText('财务复核通过');
    const s = await state(p);
    expect(s.budgetBook.transactions.filter(x => x.transactionType === 'CONSUME')).toHaveLength(1);
    await p.locator('#s001-history').click();
    await expect(root(p)).toContainText('已通过');
});
test('权限/无效输入/未保存字段阻止测试/真实持久化失败保留原版本', async ({ page: p }) => {
    await setup(p);
    await draft(p);
    await p.locator('[data-r008-path="standards.rows.0.nightlyRateCents"]').fill('abc');
    await p.locator('#r008-edit button.primary').click();
    await expect(p.locator('#r008-error')).toContainText('非负金额');
    await expect(p.locator('#r008-publish')).toBeDisabled();
    await p.locator('[data-r008-path="standards.rows.0.nightlyRateCents"]').fill('450');
    await save(p);
    await simulate(p);
    const old = (await state(p)).ruleBook.versions.filter(v => v.status === 'PUBLISHED');
    await p.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'qingbao-s001-v1')
        throw new DOMException('Quota', 'QuotaExceededError'); return original.call(this, k, v); }; });
    p.once('dialog', d => d.accept());
    await p.locator('#r008-publish').click();
    await expect(p.locator('#r008-error')).toContainText('保存失败');
    expect((await state(p)).ruleBook.versions.filter(v => v.status === 'PUBLISHED')).toEqual(old);
    await p.reload();
    await p.locator('#role').selectOption('员工');
    await center(p);
    await selectRule(p, 'R001');
    await expect(p.locator('#r008-new')).toBeDisabled();
});
test('列表筛选/未来生效/历史回滚来源/移动端不溢出', async ({ page: p }) => {
    await setup(p);
    await p.locator('#r008-query').fill('R001');
    await p.locator('#r008-query').dispatchEvent('change');
    await expect(p.locator('#r008-list tbody tr')).toHaveCount(1);
    await p.locator('#r008-query').fill('');
    await p.locator('#r008-query').dispatchEvent('change');
    await draft(p);
    await p.locator('[data-r008-path="standards.rows.0.nightlyRateCents"]').fill('450');
    await save(p, '2027-01-01');
    await simulate(p, '430', '2027-01-01');
    await publish(p);
    await expect(root(p)).toContainText('待生效');
    await p.setViewportSize({ width: 390, height: 844 });
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('F R002确定重复策略/R003部分报销/R004票种/R005映射均能在配置页真实发布', async ({ page: p }) => {
    await setup(p);
    await draft(p, 'R002');
    await p.locator('[data-r008-path=exactAction]').selectOption('BLOCK');
    await save(p);
    await simulate(p);
    await publish(p);
    await draft(p, 'R003');
    await p.locator('[data-r008-path=partialAction]').selectOption('PASS');
    await p.locator('[data-r008-path=requirePartialReason]').selectOption('true');
    await save(p);
    await simulate(p);
    await publish(p);
    await draft(p, 'R004');
    await p.locator('[data-r008-path="policies.0.requireTaxId"]').selectOption('false');
    await save(p);
    await simulate(p);
    await publish(p);
    await draft(p, 'R005');
    await p.locator('[data-r008-path="mappings.0.recommendedAccountCode"]').selectOption('6602.11');
    await p.locator('[data-r008-path="mappings.0.allowedAccountCodes"]').fill('6602.11');
    await save(p);
    await simulate(p);
    await publish(p);
    await p.locator('#role').selectOption('财务');
    await p.locator('aside [data-page="报销单管理"]').click();
    await p.locator('#s001-new').click();
    await p.locator('#s001-example').click();
    await p.locator('#s001-form [name=amountYuan]').fill('800');
    await p.locator('#s001-form [name=hotelAmountYuan]').fill('800');
    await p.locator('[data-field=amountYuan]').fill('1000');
    await p.locator('#s001-form [name=partialReason]').fill('仅申请本公司承担的800元');
    await p.locator('[data-field=buyerTaxId]').fill('');
    await p.locator('#s001-form [name=accountStage]').selectOption('财务确认');
    await p.locator('#s001-form [name=accountCode]').selectOption('6602.11');
    await p.locator('#s001-form button[type=submit]').click();
    await expect(p.locator('[data-rule-key="invoice.amount-support"] > summary')).toContainText('通过');
    await expect(p.locator('[data-rule-key="invoice.buyer-entity"] > summary')).toContainText('通过');
    await expect(p.locator('[data-rule-key="expense.account-mapping"] > summary')).toContainText('通过');
    const s = await state(p);
    for (const id of ['R002', 'R003', 'R004', 'R005'])
        expect(s.ruleBook.versions.filter(v => v.ruleId === id && v.status === 'PUBLISHED')).toHaveLength(2);
});
test('G 归档草稿与回滚来源复制，不能直接覆盖已发布版本', async ({ page: p }) => {
    await setup(p);
    await rate(p, '400');
    await selectRule(p, 'R001');
    await expect(p.locator('#r008-edit [name=changeReason]')).toBeDisabled();
    const s = await state(p), v1 = s.ruleBook.versions.find(v => v.ruleId === 'R001');
    await p.locator(`[data-r008-select="${v1.versionId}"]`).click();
    await p.locator('#r008-new').click();
    await save(p);
    await simulate(p);
    await publish(p);
    await claim(p);
    await expect(p.locator('[data-rule-key="lodging.limit"] > summary')).toContainText('通过');
    await center(p);
    await draft(p);
    await p.locator('#r008-archive').click();
    await expect(p.locator('#r008-status')).toContainText('已归档');
    await p.reload();
    await center(p);
    await selectRule(p, 'R001');
    await expect(p.locator('#r008-center')).toContainText('已归档');
});
test('H R005发布新增业务场景后正式录入下拉使用同一配置源',async({page:p})=>{
 await setup(p);await draft(p,'R005');const editor=p.locator('#r008-edit');await editor.locator('details summary').click();const raw=JSON.parse(await editor.locator('[name=parameters]').inputValue());raw.scenarios.push({scenario:'客户驻场住宿',expenseTypes:['住宿费']});await editor.locator('[name=parameters]').fill(JSON.stringify(raw));await editor.locator('[name=useJson]').check();await save(p);await simulate(p);await publish(p);await p.locator('aside [data-page="报销单管理"]').click();await p.locator('#s001-new').click();await p.locator('#s001-example').click();await expect(p.locator('#s001-form [name=businessScenario] option')).toContainText(['未指定','出差住宿','出差交通','客户宴请','日常办公','员工培训','客户驻场住宿']);await p.locator('#s001-form [name=businessScenario]').selectOption('客户驻场住宿');
});
