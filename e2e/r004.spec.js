import { test, expect } from "@playwright/test";
const key = "qingbao-s001-v1",
  data = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const f = (p, n) => p.locator(`#s001-form [name="${n}"]`),
  inv = (p, n, row = 0) =>
    p.locator("[data-invoice]").nth(row).locator(`[data-field="${n}"]`);
async function create(p) {
  await p.goto("/?view=claims");
  await p.locator("#s001-new").click();
  await p.locator("#s001-example").click();
}
async function run(p) {
  await p.locator("#s001-form [type=submit]").click();
}
const r4 = (p) => p.locator('[data-rule-key="invoice.buyer-entity"]');
test("正常四规则→财务批准→刷新，法人和逐票依据保存", async ({ page: p }) => {
  await create(p);
  await expect(f(p, "companyId")).toHaveValue("SZ");
  await run(p);
  await expect(r4(p).locator("> summary")).toContainText("通过");
  await expect(p.getByTestId("s001-business")).toHaveText(
    "规则检查通过（待财务确认）",
  );
  await p.locator("#role").selectOption("财务");
  await p
    .locator("#s001-review-form [name=reason]")
    .fill("已核查法人、购买方和税号一致");
  await p.locator("#s001-review-form [value=approved]").click();
  await p.reload();
  await nav(p, "审核历史");
  await p.locator("[data-history-doc]").click();
  await expect(r4(p)).toContainText("星河科技（深圳）有限公司");
  await expect(p.getByTestId("s001-review")).toContainText("已核查法人");
});
test("集成A：四异常同时显示，另一子公司不放行，可记录核查/驳回", async ({
  page: p,
}) => {
  await create(p);
  await f(p, "city").fill("北京");
  await f(p, "grade").selectOption("部门经理");
  await f(p, "checkOut").fill("2026-10-21");
  await f(p, "amountYuan").fill("1200");
  await f(p, "hotelAmountYuan").fill("1200");
  await inv(p, "type").selectOption("增值税电子普通发票");
  await inv(p, "code").fill("044001900111");
  await inv(p, "number").fill("12345678");
  await inv(p, "amountYuan").fill("1000");
  await inv(p, "buyerName").fill("星河科技（东莞）有限公司");
  await inv(p, "buyerTaxId").fill("DEMO-DG-001");
  await run(p);
  for (const key of [
    "lodging.limit",
    "invoice.duplicate",
    "invoice.amount-support",
    "invoice.buyer-entity",
  ])
    await expect(p.locator(`[data-rule-key="${key}"]`)).toBeVisible();
  await expect(r4(p)).toContainText("另一法人主体");
  await p.locator("#role").selectOption("财务");
  await p
    .locator("#r004-note [name=note]")
    .fill("已核对原票，需员工修改报销主体或换票");
  await p.locator('#r004-note [value="已核实信息"]').click();
  await expect(p.locator("#s001-root")).toContainText("已核对原票");
  await p
    .locator("#s001-review-form [name=reason]")
    .fill("跨法人票据不符合本次制度");
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.locator("#s001-review-error")).toContainText("不能普通放行");
  await p.locator("#s001-review-form [value=rejected]").click();
  await expect(p.getByTestId("s001-review")).toContainText("财务复核驳回");
});
test("OCR未读与票面空区别、需补材料不覆盖自动、修改原因及新旧批次", async ({
  page: p,
}) => {
  await create(p);
  await inv(p, "buyerTaxId").fill("");
  await inv(p, "recognitionStatus").selectOption("待核对");
  await run(p);
  await expect(r4(p).locator("> summary")).toContainText("信息不足");
  await p.locator("#role").selectOption("财务");
  await p.locator("#r004-note [name=note]").fill("请补充原票并确认购买方税号");
  await p.locator('#r004-note [value="需补充材料"]').click();
  await p.locator("[data-edit-s001]").click();
  await inv(p, "recognitionStatus").selectOption("已人工核对");
  await inv(p, "buyerTaxStatus").selectOption("票面确为空");
  await run(p);
  await expect(p.locator("#s001-error")).toContainText("修改原因");
  await f(p, "changeReason").fill("对照原件确认票面税号确为空");
  await run(p);
  await expect(r4(p).locator("> summary")).toContainText("拦截");
  const s = await data(p);
  expect(s.claims[0].batches).toHaveLength(2);
  expect(s.claims[0].reviewNotes[0].action).toBe("需补充材料");
  expect(s.claims[0].changes[0].before.invoices[0].recognitionStatus).toBe(
    "待核对",
  );
  expect(s.claims[0].changes[0].after.invoices[0].recognitionStatus).toBe(
    "已人工核对",
  );
});
test("三票逐张结果，BLOCK不被PASS抵消；手机可读", async ({ page: p }) => {
  await create(p);
  await f(p, "amountYuan").fill("1800");
  await f(p, "hotelAmountYuan").fill("1800");
  for (let n = 1; n < 3; n++) {
    await p.locator("#s001-add-invoice").click();
    await inv(p, "number", n).fill("9900000000000000000" + n);
    await inv(p, "date", n).fill("2026-10-22");
    await inv(p, "amountYuan", n).fill("600");
    await inv(p, "sellerName", n).fill("模拟酒店");
    await inv(p, "buyerName", n).fill(
      n === 1 ? "星河科技（深圳）有限公司" : "",
    );
    await inv(p, "buyerTaxId", n).fill(n === 1 ? "WRONG" : "");
  }
  await run(p);
  await expect(r4(p).locator("tbody tr")).toHaveCount(3);
  const text = await r4(p).innerText();
  expect(text).toContain("通过");
  expect(text).toContain("拦截");
  expect(text).toContain("信息不足");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
test("财务维护历史授权/配置版本，新审用新配置、旧批次不改", async ({
  page: p,
}) => {
  await create(p);
  await run(p);
  const before = (await data(p)).claims[0].batches[0];
  await p.locator("#role").selectOption("财务");
  await nav(p, "审核规则");
  const config = JSON.parse(
    await p.locator("#r004-config [name=config]").inputValue(),
  );
  config.companies[0].companyAliases.push({
    name: "模拟授权旧名",
    taxpayerId: "OLD-SZ",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
  });
  await p.locator("#r004-config [name=config]").fill(JSON.stringify(config));
  await p
    .locator("#r004-config [name=reason]")
    .fill("维护经确认的模拟历史名称");
  await p.locator("#r004-config button").click();
  const after = await data(p);
  expect(after.entityConfig.version).toBe(2);
  expect(after.entityConfigChanges[0].reason).toContain("模拟历史名称");
  expect(after.claims[0].batches[0]).toEqual(before);
  await nav(p, "报销单管理");
  await p.locator("[data-edit-s001]").click();
  await inv(p, "buyerName").fill("模拟授权旧名");
  await inv(p, "buyerTaxId").fill("OLD-SZ");
  await f(p, "changeReason").fill("按有效历史名称修正购买方");
  await run(p);
  await expect(r4(p)).toContainText("有效历史名称");
  await p.reload();
  await nav(p, "审核历史");
  await expect(p.locator("#s001-root tbody tr")).toHaveCount(2);
});
test("法人配置内部ID及名称作为文本显示，不执行HTML", async ({ page: p }) => {
  await create(p);
  await p.locator("#s001-draft").click();
  await p.locator("#role").selectOption("财务");
  await nav(p, "审核规则");
  const c = JSON.parse(
    await p.locator("#r004-config [name=config]").inputValue(),
  );
  c.companies[0].companyId = 'SZ"><img src=x onerror="window.__r004Xss=1">';
  c.companies[0].companyName = '<img src=x onerror="window.__r004Xss=1">';
  await p.locator("#r004-config [name=config]").fill(JSON.stringify(c));
  await p.locator("#r004-config [name=reason]").fill("隔离测试文本转义");
  await p.locator("#r004-config button").click();
  await nav(p, "报销单管理");
  await p.locator("#s001-new").click();
  expect(await p.evaluate(() => window.__r004Xss)).toBeUndefined();
  await expect(p.locator("#s001-root img")).toHaveCount(0);
  await expect(f(p, "companyId").locator("option").nth(1)).toHaveText(
    c.companies[0].companyName,
  );
});
