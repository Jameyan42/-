import { test, expect } from "@playwright/test";
const nav = (p, n) => p.locator(`[data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
async function create(page, name = "客户拜访申请") {
  await page.goto("/");
  await page.locator("#role").selectOption("员工");
  await nav(page, "费用申请");
  await page.locator("#new-request").click();
  await page.locator("#request-form [name=name]").fill(name);
  await page.locator("#request-form [name=amount]").fill("1000");
  await page.locator("#request-form [name=note]").fill("虚构业务计划");
  await page.locator("#request-form button[type=submit]").click();
}
async function approve(page, name = "客户拜访申请") {
  await page.locator("#role").selectOption("主管");
  await row(page, name).locator("[data-request]").click();
  await page.locator("[data-request-action=approve]").click();
}

test("申请审批与关联报销预留不重计，超额被拦，撤回再结束释放", async ({
  page,
}) => {
  await create(page);
  await expect(row(page, "客户拜访申请")).toContainText("待审批");
  await approve(page);
  await nav(page, "预算管理");
  await expect(
    page.locator(".budget-card").first().locator("dl"),
  ).toContainText("1,000.00");
  await nav(page, "费用申请");
  await page.locator("#role").selectOption("员工");
  await page.locator("#create").click();
  await page.locator("[name=name]").fill("申请关联报销");
  await page.locator("[name=amount]").fill("1200");
  await page.locator("[name=note]").fill("计划内支出");
  const id = await page
    .locator("[name=requestId] option")
    .nth(1)
    .getAttribute("value");
  await page.locator("[name=requestId]").selectOption(id);
  await page.locator("#expense-form button[type=submit]").click();
  await expect(page.locator(".toast")).toContainText("超过申请剩余额度");
  await page.locator("[name=amount]").fill("600");
  await page.locator("#expense-form button[type=submit]").click();
  await page.locator("[data-request]").click();
  await page.locator("#request-reason").fill("提前结束");
  await page.locator("[data-request-action=close]").click();
  await expect(page.locator(".toast")).toContainText("仍有在途");
  await page.locator("[data-close]").click();
  await nav(page, "报销管理");
  await row(page, "申请关联报销").locator("[data-detail]").click();
  await page.locator("#withdraw-reason").fill("计划调整");
  await page.locator("#withdraw").click();
  await nav(page, "费用申请");
  await row(page, "客户拜访申请").locator("[data-request]").click();
  await expect(page.locator(".modal")).toContainText("剩余额度 ¥ 1,000.00");
  await page.locator("#request-reason").fill("计划结束");
  await page.locator("[data-request-action=close]").click();
  await expect(row(page, "客户拜访申请")).toContainText("已关闭");
  await nav(page, "预算管理");
  await expect(
    page.locator(".budget-card").first().locator("dl"),
  ).toContainText("0.00");
});
test("旧备份恢复保留新申请，新备份包含申请且页面可手机使用", async ({
  page,
}) => {
  await page.goto("/");
  await nav(page, "数据管理");
  let download = page.waitForEvent("download");
  await page.locator("#backup").click();
  const old = await download;
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(await old.path(), "utf8"));
  delete data.requests;
  await create(page);
  await nav(page, "数据管理");
  page.once("dialog", (d) => d.accept());
  await page.locator("#restore").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator(".toast")).toContainText("备份已恢复");
  await nav(page, "费用申请");
  await expect(row(page, "客户拜访申请")).toContainText("待审批");
  await page.reload();
  await nav(page, "费用申请");
  await expect(row(page, "客户拜访申请")).toContainText("待审批");
  await nav(page, "数据管理");
  download = page.waitForEvent("download");
  await page.locator("#backup").click();
  const newest = await download;
  const restored = JSON.parse(await readFile(await newest.path(), "utf8"));
  expect(restored.requests).toHaveLength(1);
  expect(restored.requests[0].name).toBe("客户拜访申请");
  await nav(page, "费用申请");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("申请关联报销付款后结束释放未用余额，保留付款关联", async ({ page }) => {
  await create(page);
  await approve(page);
  await page.locator("#role").selectOption("员工");
  await page.locator("#create").click();
  await page.locator("[name=name]").fill("计划内交通");
  await page.locator("[name=amount]").fill("600");
  await page.locator("[name=note]").fill("虚构客户拜访");
  await page.locator("[name=invoice]").fill("REQUEST-PAY-001");
  await page
    .locator("[name=receipt]")
    .setInputFiles({
      name: "虚构票据.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo"),
    });
  const id = await page
    .locator("[name=requestId] option")
    .nth(1)
    .getAttribute("value");
  await page.locator("[name=requestId]").selectOption(id);
  await page.locator("#expense-form button[type=submit]").click();
  await nav(page, "报销管理");
  await page.locator("#role").selectOption("主管");
  await row(page, "计划内交通").locator("[data-detail]").click();
  await page.locator("#approve").click();
  await page.locator("#role").selectOption("财务");
  await row(page, "计划内交通").locator("[data-detail]").click();
  await page.locator("#approve").click();
  await row(page, "计划内交通").locator("[data-detail]").click();
  await page.locator("#payment-reference").fill("DEMO-REQUEST-001");
  await page.locator("#payment-confirm").check();
  await page.locator("#approve").click();
  await nav(page, "费用申请");
  await page.locator("#role").selectOption("员工");
  await row(page, "客户拜访申请").locator("[data-request]").click();
  await expect(page.locator(".modal")).toContainText("剩余额度 ¥ 400.00");
  await expect(page.locator(".modal")).toContainText("已付款");
  await page.locator("#request-reason").fill("本次计划执行完成");
  await page.locator("[data-request-action=close]").click();
  await nav(page, "预算管理");
  const card = page.locator(".budget-card").first();
  await expect(
    card.locator("dl>div").filter({ hasText: "申请剩余预留" }),
  ).toContainText("0.00");
  await expect(
    card.locator("dl>div").filter({ hasText: "已付款" }),
  ).toContainText("1,860.00");
  await page.reload();
  await nav(page, "报销管理");
  await row(page, "计划内交通").locator("[data-detail]").click();
  await expect(page.locator(".modal")).toContainText("关联费用申请");
  await expect(page.locator(".payment-summary")).toContainText(
    "DEMO-REQUEST-001",
  );
});
