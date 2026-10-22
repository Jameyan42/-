import { test, expect } from "@playwright/test";
const navigate = (p, name) => p.locator(`[data-page="${name}"]`).click();
const row = (p, name) => p.locator("tbody tr").filter({ hasText: name });
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});
test("正常报销完成审批付款，刷新仍保留", async ({ page }) => {
  await page.locator("#role").selectOption("员工");
  await page.locator("#create").click();
  await page.locator("[name=name]").fill("完整流程验证");
  await page.locator("[name=amount]").fill("200");
  await page.locator("[name=invoice]").fill("E2E001");
  await page
    .locator("[name=receipt]")
    .setInputFiles({
      name: "演示票据.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo"),
    });
  await page.locator("[name=note]").fill("虚构业务用途");
  await page.locator("[type=submit]").click();
  await page.locator("#role").selectOption("主管");
  await row(page, "完整流程验证").locator("[data-detail]").click();
  await page.locator("#approve").click();
  await page.locator("#role").selectOption("财务");
  await row(page, "完整流程验证").locator("[data-detail]").click();
  await page.locator("#approve").click();
  await row(page, "完整流程验证").locator("[data-detail]").click();
  await page.locator("#payment-reference").fill("E2E-PAY-001");
  await page.locator("#payment-confirm").check();
  await page.locator("#approve").click();
  await expect(row(page, "完整流程验证")).toContainText("已付款");
  await page.reload();
  await expect(row(page, "完整流程验证")).toContainText("已付款");
  await navigate(page, "操作记录");
  await expect(page.locator("tbody")).toContainText("登记付款");
});
test("保存不完整草稿，继续填写，提交后进入审批", async ({ page }) => {
  await page.locator("#role").selectOption("员工");
  await page.locator("#create").click();
  await page.locator("[name=name]").fill("出差草稿");
  await page.locator("#draft").click();
  await expect(row(page, "出差草稿")).toContainText("草稿");
  await page.reload();
  await page.locator("#role").selectOption("员工");
  await row(page, "出差草稿").locator("[data-detail]").click();
  await page.locator("#edit").click();
  await page.locator("[name=amount]").fill("180");
  await page.locator("[name=note]").fill("补全差旅信息");
  await page.locator("[type=submit]").click();
  await expect(row(page, "出差草稿")).toContainText("待主管审批");
  await expect(row(page, "出差草稿")).toContainText("1 项待核查");
});
test("风险单被财务拦截，退回修正重提后风险清除", async ({ page }) => {
  await page.locator("#role").selectOption("财务");
  await row(page, "产品共创工作坊").locator("[data-detail]").click();
  await page.locator("#approve").click();
  await expect(page.locator(".toast")).toContainText("未解决");
  await page.locator("[data-close]").click();
  await page.locator("#role").selectOption("主管");
  await row(page, "客户出行交通").locator("[data-detail]").click();
  await page.locator("#reason").fill("重复票据，请修正");
  await page.locator("#reject").click();
  await page.locator("#role").selectOption("员工");
  await row(page, "客户出行交通").locator("[data-detail]").click();
  await page.locator("#edit").click();
  await page.locator("[name=invoice]").fill("FIX001");
  await page.locator("[type=submit]").click();
  await expect(row(page, "客户出行交通")).toContainText("未发现风险");
});
test("财务规则调整改变预审提示并记录原因，其他角色只读", async ({ page }) => {
  await navigate(page, "规则配置");
  await expect(page.locator("[name=limit]")).toBeDisabled();
  await page.locator("#role").selectOption("财务");
  await page.locator("[name=limit]").fill("5000");
  await page.locator("[name=reason]").fill("调整客户活动费用标准");
  await page.locator("[type=submit]").click();
  await navigate(page, "报销管理");
  await expect(row(page, "产品共创工作坊")).toContainText("未发现风险");
  await navigate(page, "操作记录");
  await expect(page.locator("tbody")).toContainText("调整客户活动费用标准");
  await page.reload();
  await navigate(page, "规则配置");
  await expect(page.locator("[name=limit]")).toHaveValue("5000");
});
test("预算超额预警、切换月份及移动布局", async ({ page }) => {
  await page.locator("#role").selectOption("财务");
  await navigate(page, "预算管理");
  await page.locator('[data-budget="销售部"]').click();
  await page.locator("[name=limit]").fill("3000");
  await page.locator("[name=reason]").fill("测试预算软预警");
  await page.locator("[type=submit]").click();
  await expect(page.locator(".budget-card").first()).toContainText(
    "预算已耗尽",
  );
  await page.locator("#budget-month").fill("2026-09");
  await expect(page.locator(".budget-total").first()).toContainText("0.00");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("备份导出恢复，错误文件拒绝且不影响数据", async ({ page }) => {
  await navigate(page, "数据管理");
  const download = page.waitForEvent("download");
  await page.locator("#backup").click();
  const file = await download;
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.items).toHaveLength(5);
  await page
    .locator("#restore")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":900}'),
    });
  await expect(page.locator(".toast")).toContainText("导入失败");
  await navigate(page, "报销管理");
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await navigate(page, "数据管理");
  page.once("dialog", (d) => d.accept());
  await page
    .locator("#restore")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await expect(page.locator(".toast")).toContainText("备份已恢复");
  await navigate(page, "操作记录");
  await expect(page.locator("tbody")).toContainText("导入备份");
});
test("所有模块可打开，无浏览器脚本错误", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const name of [
    "工作台",
    "报销管理",
    "审批中心",
    "费用洞察",
    "预算管理",
    "规则配置",
    "操作记录",
    "数据管理",
    "产品说明",
  ]) {
    await navigate(page, name);
    await expect(page.locator("h1")).toHaveText(name);
  }
  expect(errors).toEqual([]);
});
test("员工撤回释放预算，可修改后重新提交，票据索引同步", async ({ page }) => {
  await page.locator("#role").selectOption("员工");
  await row(page, "客户出行交通").locator("[data-detail]").click();
  await page.locator("#withdraw-reason").fill("需要核对票据号码");
  await page.locator("#withdraw").click();
  await expect(row(page, "客户出行交通")).toContainText("已撤回");
  await navigate(page, "发票台账");
  await page.locator('[data-invoice-filter="重复号码"]').click();
  await expect(page.locator("tbody")).toContainText("没有符合条件");
  await navigate(page, "预算管理");
  await expect(page.locator(".budget-card").first()).toContainText("2,480.00");
  await navigate(page, "报销管理");
  await row(page, "客户出行交通").locator("[data-detail]").click();
  await page.locator("#edit").click();
  await page.locator("[name=invoice]").fill("WITHDRAW-FIX");
  await page.locator("[type=submit]").click();
  await expect(row(page, "客户出行交通")).toContainText("待主管审批");
  await expect(row(page, "客户出行交通")).toContainText("未发现风险");
});
test("付款必须确认，完成后详情保留参考信息", async ({ page }) => {
  await page.locator("#role").selectOption("财务");
  await row(page, "办公耗材采购").locator("[data-detail]").click();
  await page.locator("#approve").click();
  await expect(page.locator(".toast")).toContainText("有效付款");
  await page.locator("#payment-reference").fill("DEMO-TEST-02");
  await page.locator("#approve").click();
  await expect(page.locator(".toast")).toContainText("确认");
  await page.locator("#payment-confirm").check();
  await page.locator("#approve").click();
  await row(page, "办公耗材采购").locator("[data-detail]").click();
  await expect(page.locator(".payment-summary")).toContainText("DEMO-TEST-02");
  await page.locator("[data-close]").click();
  await page.reload();
  await row(page, "办公耗材采购").locator("[data-detail]").click();
  await expect(page.locator(".payment-summary")).toContainText("银行转账");
});
test("演示指南切换角色与目标场景，新模块移动端可用", async ({ page }) => {
  await navigate(page, "演示指南");
  await expect(page.locator(".guide-card")).toHaveCount(4);
  await page.locator('[data-guide-page="发票台账"]').click();
  await expect(page.locator("#role")).toHaveValue("财务");
  await expect(page.locator("h1")).toHaveText("发票台账");
  await page.locator("#invoice-search").fill("310026004");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["发票台账", "演示指南"]) {
    await navigate(page, name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
});
