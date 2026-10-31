import { test, expect } from "@playwright/test";
import { addMaterials, completeBusiness } from "./r006-helpers.js";
const bid = "B-SZ-sales-住宿费-2026-10",
  f = (p, n) => p.locator(`#s001-form [name="${n}"]`),
  data = (p) =>
    p.evaluate(() => JSON.parse(localStorage.getItem("qingbao-s001-v1"))),
  r7 = (p) => p.locator('[data-rule-key="budget.capacity"]');
const doc = (s) => s.claims.find((d) => !d.budgetOpening);
async function setup(p, mode = "HARD", opening = true, limit = "10000") {
  await p.goto("/?view=claims");
  await p.locator("#role").selectOption("财务");
  await p.locator('aside [data-page="预算管理"]').click();
  await p.locator("#r007-company").selectOption("SZ");
  await p.locator("#r007-department").selectOption("sales");
  await p.locator("#r007-expense").selectOption("住宿费");
  await p.locator(`[data-r007-open="${bid}"]`).click();
  const config = p.locator("#r007-config");
  await config.locator("[name=budgetAmountYuan]").fill(limit);
  await config.locator("[name=controlMode]").selectOption(mode);
  await config.locator("[name=reason]").fill("配置R007模拟预算制度");
  await config.locator("button").click();
  await expect(p.locator("#s001-root")).toContainText("预算配置已保存");
  if (opening) {
    await p.locator("#r007-opening button").click();
    await expect(p.locator("#s001-root")).toContainText("期初模拟报销记录");
  }
}
async function create(p, amount = "800") {
  await p.locator('aside [data-page="报销单管理"]').click();
  await p.locator("#s001-new").click();
  await p.locator("#s001-example").click();
  await f(p, "amountYuan").fill(amount);
  await f(p, "hotelAmountYuan").fill(amount);
  await f(p, "checkOut").fill(amount === "2500" ? "2026-10-25" : "2026-10-23");
  await p.locator("[data-field=amountYuan]").fill(amount);
  await f(p, "accountStage").selectOption("财务确认");
  await f(p, "accountCode").selectOption("6602.01");
  await addMaterials(p);
}
async function saveDetail(p) {
  await p.locator("#s001-draft").click();
  await p.locator("[data-detail-s001]").first().click();
}
async function action(p, value, reason) {
  await p.locator("#r006-action-form [name=comment]").fill(reason);
  await p.locator(`#r006-action-form [value="${value}"]`).click();
}
async function decide(p, value = "approved") {
  await p
    .locator("#s001-review-form [name=reason]")
    .fill("核实预算、审批及材料");
  await p.locator(`#s001-review-form [value=${value}]`).click();
}
async function ledger(p) {
  await p.locator('aside [data-page="预算管理"]').click();
  await p.locator(`[data-r007-open="${bid}"]`).click();
}
test("A 草稿无流水→提交预占800→七规则→财务转已使用→刷新看板及流水", async ({
  page: p,
}) => {
  await setup(p);
  await create(p);
  const before = (await data(p)).budgetBook.transactions.length;
  await expect(p.locator("#r007-preview")).toContainText("¥ 2,000.00");
  await saveDetail(p);
  expect((await data(p)).budgetBook.transactions.length).toBe(before);
  await completeBusiness(p);
  await expect(p.locator(".s001-rule")).toHaveCount(7);
  await expect(r7(p).locator(">summary")).toContainText("通过");
  await decide(p);
  await expect(p.getByTestId("s001-review")).toContainText("财务复核通过");
  await p.reload();
  await ledger(p);
  await expect(p.locator("#r007-table")).toContainText("已使用¥ 6,800.00");
  await expect(p.locator("#r007-table")).toContainText("预占¥ 2,000.00");
  await expect(p.locator("#r007-ledger")).toContainText("转已使用");
  const s = await data(p),
    id = doc(s).id;
  expect(
    s.budgetBook.transactions.filter(
      (t) => t.reimbursementId === id && t.transactionType === "CONSUME",
    ),
  ).toHaveLength(1);
});
test("B SOFT超500：待额外授权→具名预算负责人→财务批准但R007仍保留REVIEW", async ({
  page: p,
}) => {
  await setup(p, "SOFT");
  await create(p, "2500");
  await saveDetail(p);
  await completeBusiness(p);
  await expect(r7(p)).toContainText("500.00");
  await expect(p.locator("[data-r006-sub=approval]")).toContainText(
    "预算负责人",
  );
  await decide(p);
  await expect(p.locator("#s001-review-error")).toContainText("不能跳过");
  p.once("dialog", (d) => d.accept());
  await p.locator("#role").selectOption("管理员");
  await p.locator("#actor").selectOption("admin-gu");
  await action(p, "APPROVED", "顾远明确授权本次预算超额");
  await p.locator("#role").selectOption("财务");
  await p.locator("#r006-audit").click();
  await expect(p.locator("[data-r006-sub=approval] h4")).toContainText("通过");
  await expect(r7(p).locator(">summary")).toContainText("需要人工复核");
  await decide(p);
  await expect(p.getByTestId("s001-review")).toContainText("财务复核通过");
  await ledger(p);
  await expect(p.locator("#r007-table")).toContainText("可用¥ -500.00");
});
test("C HARD超额不能提交，占用和流程均不写；自动审核仍展示所有规则", async ({
  page: p,
}) => {
  await setup(p);
  await create(p, "2500");
  await p.locator("#s001-form [type=submit]").click();
  await expect(p.locator(".s001-rule")).toHaveCount(7);
  await expect(r7(p).locator(">summary")).toContainText("拦截");
  const before = JSON.stringify((await data(p)).budgetBook.transactions);
  await action(p, "submit", "尝试刚性超预算提交");
  await expect(p.locator("#r006-action-error")).toContainText("预算");
  expect(JSON.stringify((await data(p)).budgetBook.transactions)).toBe(before);
  expect(doc(await data(p)).workflows).toHaveLength(0);
});
test("D 主管驳回释放1000，已使用不变，刷新后流水存在", async ({ page: p }) => {
  await setup(p);
  await create(p, "1000");
  await saveDetail(p);
  await action(p, "submit", "提交1000元预占");
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("manager-zhao");
  await action(p, "REJECTED", "虚构业务退回");
  await p.locator("#role").selectOption("财务");
  await ledger(p);
  await expect(p.locator("#r007-table")).toContainText("预占¥ 2,000.00");
  await expect(p.locator("#r007-ledger")).toContainText("释放");
  const id = doc(await data(p)).id;
  expect(
    (await data(p)).budgetBook.transactions.filter(
      (t) => t.reimbursementId === id && t.transactionType === "RELEASE",
    ),
  ).toHaveLength(1);
});
test("E 800改1200差额400，旧审批失效；撤销释放且不允许已批准撤销", async ({
  page: p,
}) => {
  await setup(p);
  await create(p);
  await saveDetail(p);
  await completeBusiness(p);
  await p.locator("[data-edit-s001]").click();
  await f(p, "amountYuan").fill("1200");
  await f(p, "hotelAmountYuan").fill("1200");
  await p.locator("[data-field=amountYuan]").fill("1200");
  await f(p, "changeReason").fill("住宿费修正，重新审批");
  await saveDetail(p);
  await expect(p.locator("#s001-root")).toContainText("需重新提交审批");
  const s = await data(p),
    id = doc(s).id,
    last = s.budgetBook.transactions
      .filter((t) => t.reimbursementId === id)
      .at(-1);
  expect(last.transactionType).toBe("ADJUST");
  expect(last.amount).toBe(40000);
  await p.locator("#r007-lifecycle [name=reason]").fill("撤销重新整理材料");
  await p.locator("#r007-lifecycle [value=withdraw]").click();
  await expect(p.locator("#s001-root")).toContainText("已撤销");
  await ledger(p);
  await expect(p.locator("#r007-table")).toContainText("预占¥ 2,000.00");
});
test("WARNING允许负余额，员工配置按钮禁用，移动端七规则无溢出", async ({
  page: p,
}) => {
  await setup(p, "WARNING");
  await create(p, "2500");
  await saveDetail(p);
  await completeBusiness(p);
  await expect(r7(p).locator(">summary")).toContainText("通过");
  await expect(r7(p)).toContainText("预警");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await p.locator("#role").selectOption("员工");
  await ledger(p);
  await expect(p.locator("#r007-config button")).toBeDisabled();
});
test("预算改额不改旧结果，财务批准前重新检查余额且存储故障保留旧值", async ({
  page: p,
}) => {
  await setup(p);
  await create(p);
  await saveDetail(p);
  await completeBusiness(p);
  const old = doc(await data(p)).batches[0],
    id = doc(await data(p)).id;
  await ledger(p);
  await p.locator("#r007-config [name=budgetAmountYuan]").fill("8100");
  await p
    .locator("#r007-config [name=reason]")
    .fill("模拟降额检验最后一刻检查");
  await p.locator("#r007-config button").click();
  expect(doc(await data(p)).batches[0]).toEqual(old);
  await p.locator('aside [data-page="报销单管理"]').click();
  await p.locator(`[data-detail-s001="${id}"]`).click();
  await decide(p);
  await expect(p.locator("#s001-review-error")).toContainText("最新预算");
  p.once("dialog", (d) => d.accept());
  await p.locator("#r006-audit").click();
  await expect(r7(p).locator(">summary")).toContainText("拦截");
});
test("在途预算变柔性后显式补预算授权，原主管记录保留，最终复查独立留存", async ({
  page: p,
}) => {
  await setup(p);
  await create(p);
  await saveDetail(p);
  await completeBusiness(p);
  const original = doc(await data(p)).workflows[0].records;
  await ledger(p);
  await p.locator("#r007-config [name=budgetAmountYuan]").fill("8100");
  await p.locator("#r007-config [name=controlMode]").selectOption("SOFT");
  await p.locator("#r007-config [name=reason]").fill("模拟在途预算制度调整");
  await p.locator("#r007-config button").click();
  await p.locator('aside [data-page="报销单管理"]').click();
  await p.locator("[data-detail-s001]").first().click();
  await p.locator("#r006-audit").click();
  await expect(p.locator("[data-r006-sub=approval]")).toContainText("尚未绑定");
  await p.locator("#r007-lifecycle [name=reason]").fill("按新政策补充具名授权");
  await p.locator("#r007-lifecycle [value=authorize]").click();
  expect(doc(await data(p)).workflows[0].records).toEqual(original);
  await p.locator("#role").selectOption("管理员");
  await p.locator("#actor").selectOption("admin-gu");
  await action(p, "APPROVED", "预算负责人同意新超额700元");
  await p.locator("#role").selectOption("财务");
  await p.locator("#r006-audit").click();
  await decide(p);
  await expect(p.getByTestId("s001-review")).toContainText("财务复核通过");
  expect(
    doc(await data(p)).batches.at(-1).budgetAtReview.evidence.budget.version,
  ).toBe(2);
});
test("提交及流水写入失败时保留原预算和单据，草稿不能另扣额度", async ({
  page: p,
}) => {
  await setup(p);
  await p.locator("#create").click();
  await expect(p.locator("#s001-form")).toBeVisible();
  await create(p);
  await saveDetail(p);
  await p.locator("#r007-lifecycle [name=reason]").fill("草稿不能只点扣预算");
  await p.locator("#r007-lifecycle [value=reserve]").click();
  await expect(p.locator("#r007-lifecycle-error")).toContainText(
    "请先提交有效业务审批",
  );
  const before = JSON.stringify((await data(p)).budgetBook);
  await p.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw Error("quota");
    };
  });
  await action(p, "submit", "提交时模拟存储失败");
  await expect(p.locator("#r006-action-error")).toContainText("保存失败");
  expect(JSON.stringify((await data(p)).budgetBook)).toBe(before);
  expect(doc(await data(p)).workflows).toHaveLength(0);
});
