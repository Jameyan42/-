import { test, expect } from "@playwright/test";
const nav = (p, name) => p.locator(`[data-page="${name}"]`).click();
const row = (p, name) => p.locator("tbody tr").filter({ hasText: name });
const badge = (p) => p.locator('[data-page="审批中心"] em');
async function request(p, name, amount = "200") {
  await p.locator("#role").selectOption("员工");
  await nav(p, "费用申请");
  await p.locator("#new-request").click();
  await p.locator("#request-form [name=name]").fill(name);
  await p.locator("[name=amount]").fill(amount);
  await p.locator("[name=note]").fill("虚构待办申请");
  await p.locator("#request-form button[type=submit]").click();
}
async function expense(p, name) {
  await p.locator("#role").selectOption("员工");
  await p.locator("#create").click();
  await p.locator("[name=name]").fill(name);
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=note]").fill("虚构待办报销");
  await p.locator("[name=invoice]").fill("INBOX-001");
  await p
    .locator("[name=receipt]")
    .setInputFiles({
      name: "虚构附件.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo"),
    });
  await p.locator("#expense-form button[type=submit]").click();
}
test("报销申请统一出现，类型搜索导出及处理后角标同步", async ({ page: p }) => {
  await p.goto("/");
  const baseline = Number(await badge(p).innerText());
  await request(p, "统一待办申请");
  await expense(p, "统一待办报销");
  await p.locator("#role").selectOption("主管");
  await nav(p, "审批中心");
  await expect(badge(p)).toHaveText(String(baseline + 2));
  await expect(row(p, "统一待办申请")).toContainText("费用申请");
  await expect(row(p, "统一待办报销")).toContainText("报销");
  await p.locator("[data-inbox-kind=request]").click();
  await expect(row(p, "统一待办报销")).toHaveCount(0);
  await expect(row(p, "统一待办申请")).toBeVisible();
  await p.locator("#inbox-search").fill("统一待办");
  const wait = p.waitForEvent("download");
  await p.locator("#inbox-export").click();
  const file = await wait;
  const { readFile } = await import("node:fs/promises");
  const csv = await readFile(await file.path(), "utf8");
  expect(csv).toContain("统一待办申请");
  expect(csv).not.toContain("统一待办报销");
  await row(p, "统一待办申请").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await expect(row(p, "统一待办申请")).toHaveCount(0);
  await expect(badge(p)).toHaveText(String(baseline + 1));
  await expect(p.locator(".empty")).toContainText("筛选");
  await p.locator("#inbox-clear").click();
  await row(p, "统一待办报销").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await expect(badge(p)).toHaveText(String(baseline));
});
test("多级申请只在当前人员列表，切身份清除筛选，员工无审批待办", async ({
  page: p,
}) => {
  await p.goto("/");
  await request(p, "多级统一申请", "4000");
  await p.locator("#role").selectOption("主管");
  await nav(p, "审批中心");
  await p.locator("#actor").selectOption("head-xu");
  await expect(row(p, "多级统一申请")).toHaveCount(0);
  await p.locator("#inbox-search").fill("不存在");
  await p.locator("#actor").selectOption("manager-zhao");
  await expect(p.locator("#inbox-search")).toHaveValue("");
  await row(p, "多级统一申请").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await expect(row(p, "多级统一申请")).toHaveCount(0);
  await p.locator("#actor").selectOption("head-xu");
  await expect(row(p, "多级统一申请")).toContainText("1/2 节点已通过");
  await row(p, "多级统一申请").locator("[data-request]").click();
  await p.locator("[data-request-action=reject]").click();
  await expect(p.locator(".toast")).toContainText("原因");
  await p.locator("#request-reason").fill("虚构计划需要补充");
  await p.locator("[data-request-action=reject]").click();
  await expect(row(p, "多级统一申请")).toHaveCount(0);
  await p.locator("#role").selectOption("员工");
  await expect(p.locator(".empty")).toContainText("员工身份没有审批任务");
  await expect(badge(p)).toHaveText("0");
});
test("财务审核通过后保留付款任务，登记后移出并刷新仍一致", async ({
  page: p,
}) => {
  await p.goto("/");
  await expense(p, "统一付款验证");
  await p.locator("#role").selectOption("主管");
  await nav(p, "审批中心");
  await row(p, "统一付款验证").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await p.locator("#role").selectOption("财务");
  const count = await badge(p).innerText();
  await row(p, "统一付款验证").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await expect(row(p, "统一付款验证")).toContainText("付款登记");
  await expect(badge(p)).toHaveText(count);
  await row(p, "统一付款验证").locator("[data-detail]").click();
  await p.locator("#payment-reference").fill("DEMO-INBOX-PAY");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await expect(row(p, "统一付款验证")).toHaveCount(0);
  await expect(badge(p)).toHaveText(String(Number(count) - 1));
  await p.reload();
  await p.locator("#role").selectOption("财务");
  await nav(p, "审批中心");
  await expect(row(p, "统一付款验证")).toHaveCount(0);
});
test("提交时间排序、旧流程提示及手机布局", async ({ page: p }) => {
  await p.goto("/");
  await request(p, "排序申请甲");
  await request(p, "排序申请乙");
  await p.locator("#role").selectOption("主管");
  await nav(p, "审批中心");
  await expect(row(p, "客户出行交通")).toContainText("历史记录未提供");
  await expect(row(p, "客户出行交通")).toContainText("历史固定流程");
  await p.locator("#inbox-search").fill("排序申请");
  await expect(p.locator("tbody tr").first()).toContainText("排序申请甲");
  await p.locator("#inbox-order").selectOption("newest");
  await expect(p.locator("tbody tr").first()).toContainText("排序申请乙");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await row(p, "排序申请乙").locator("[data-request]").click();
  await expect(p.locator(".snapshot")).toBeVisible();
});
test("申请存储损坏显示不完整提示并阻止假完整导出", async ({ page: p }) => {
  await p.goto("/");
  await p.evaluate(() =>
    localStorage.setItem("qingbao-requests-v1", "{broken"),
  );
  await p.reload();
  await nav(p, "审批中心");
  await expect(p.locator("[role=alert]")).toContainText("不是完整待办总数");
  await p.locator("#inbox-export").click();
  await expect(p.locator(".toast")).toContainText("不能导出完整统一待办");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-requests-v1")),
  ).toBe("{broken");
});
