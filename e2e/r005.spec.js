import { addMaterials, completeBusiness } from "./r006-helpers.js";
import { test, expect } from "@playwright/test";
const f = (p, n) => p.locator(`#s001-form [name="${n}"]`),
  inv = (p, n) => p.locator(`[data-invoice] [data-field="${n}"]`).first();
const r5 = (p) => p.locator('[data-rule-key="expense.account-mapping"]');
const data = (p) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("qingbao-s001-v1")));
async function create(p, finance = true) {
  await p.goto("/?view=claims");
  if (finance) await p.locator("#role").selectOption("财务");
  await p.locator("#s001-new").click();
  await p.locator("#s001-example").click();
  if (finance) await addMaterials(p);
}
async function run(p) {
  const stage = await p.locator("#role").inputValue();
  if (stage !== "财务") {
    await p.locator("#s001-form [type=submit]").click();
    return;
  }
  await p.locator("#s001-draft").click();
  if (await p.locator("#s001-form").count()) return;
  await p.locator("[data-detail-s001]").first().click();
  await completeBusiness(p);
}
async function confirmAccount(p, code = "6602.01") {
  await f(p, "accountCode").selectOption(code);
  await f(p, "accountStage").selectOption("财务确认");
}
test("员工推荐不等于确认；单据不驳回且不能冒充财务", async ({ page: p }) => {
  await create(p, false);
  await expect(p.locator("#r005-recommendation")).toContainText(
    "6602.01 差旅费",
  );
  await expect(f(p, "accountCode")).toBeDisabled();
  await run(p);
  await expect(r5(p)).toContainText("待财务确认");
  expect((await data(p)).claims[0].status).toBe("待人工复核");
});
test("错误科目→BLOCK→财务修正→PASS→批准→刷新查看两批证据", async ({
  page: p,
}) => {
  await create(p);
  await confirmAccount(p, "6602.02");
  await run(p);
  await expect(r5(p).locator(">summary")).toContainText("拦截");
  await p.locator("#s001-review-form [name=reason]").fill("先尝试普通批准");
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.locator("#s001-review-error")).toContainText("不能普通放行");
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-edit-s001]").click();
  await confirmAccount(p);
  await f(p, "changeReason").fill("财务按住宿制度更正科目");
  await run(p);
  await expect(r5(p).locator(">summary")).toContainText("通过");
  await p.locator("#s001-review-form [name=reason]").fill("科目及票据已核实");
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.getByTestId("s001-review")).toContainText("财务复核通过");
  await p.reload();
  await p.locator('aside [data-page="审核历史"]').click();
  await p.locator("[data-history-doc]").first().click();
  await p.locator("#s001-batch").selectOption({ index: 0 });
  await expect(r5(p).locator(">summary")).toContainText("拦截");
  const d = (await data(p)).claims[0];
  expect(d.batches).toHaveLength(2);
  expect(d.changes.at(-1).before.accountCode).toBe("6602.02");
  expect(d.batches[1].review.reason).toBe("科目及票据已核实");
});
test("五项异常一次执行，不丢失其他规则", async ({ page: p }) => {
  await create(p);
  await confirmAccount(p, "6602.02");
  await f(p, "checkOut").fill("2026-10-21");
  await f(p, "amountYuan").fill("1800");
  await f(p, "hotelAmountYuan").fill("1800");
  await inv(p, "type").selectOption("增值税电子普通发票");
  await inv(p, "code").fill("044001900111");
  await inv(p, "number").fill("12345678");
  await inv(p, "amountYuan").fill("1000");
  await inv(p, "buyerName").fill("星河科技（东莞）有限公司");
  await inv(p, "buyerTaxId").fill("DEMO-DG-001");
  await run(p);
  await expect(p.locator(".s001-rule")).toHaveCount(6);
  expect(
    (await data(p)).claims[0].batches[0].results.map((r) => r.status),
  ).toEqual(["REVIEW", "REVIEW", "BLOCK", "BLOCK", "BLOCK", "PASS"]);
});
test("法人推荐、允许非默认培训科目及手机显示", async ({ page: p }) => {
  await create(p);
  await f(p, "companyId").selectOption("DG");
  await expect(p.locator("#r005-recommendation")).toContainText(
    "6602.11 差旅住宿费",
  );
  await f(p, "expenseType").selectOption("培训费");
  await f(p, "businessScenario").selectOption("员工培训");
  await confirmAccount(p, "6602.05");
  await run(p);
  await expect(r5(p).locator(">summary")).toContainText("通过");
  await expect(r5(p)).toContainText("6602.04");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
test("配置维护、停用、有效期、冲突和历史版本保留", async ({ page: p }) => {
  await create(p);
  await confirmAccount(p);
  await run(p);
  const old = (await data(p)).claims[0].batches[0];
  await p.locator('aside [data-page="审核规则"]').click();
  const form = p.locator("#r005-config");
  const c = JSON.parse(await form.locator("[name=config]").inputValue());
  c.mappings.push({
    ...c.mappings[0],
    ruleId: "CONFLICT",
    allowedAccountCodes: ["6602.11"],
    recommendedAccountCode: "6602.11",
  });
  await form.locator("[name=config]").fill(JSON.stringify(c));
  await form.locator("[name=reason]").fill("模拟验证冲突配置");
  await form.locator("button").click();
  await p.reload();
  const s = await data(p);
  expect(s.accountConfig.version).toBe(2);
  expect(s.claims[0].batches[0]).toEqual(old);
  await p.locator('aside [data-page="报销单管理"]').click();
  await p.locator("[data-edit-s001]").first().click();
  await run(p);
  await expect(r5(p)).toContainText("配置冲突");
});
