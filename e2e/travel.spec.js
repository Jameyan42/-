import { test, expect } from "@playwright/test";
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
async function trip(p) {
  await p.locator("#travel-enabled").check();
  for (const [k, v] of Object.entries({
    origin: "杭州",
    destination: "上海",
    start: "2026-10-21",
    end: "2026-10-23",
  }))
    await p.locator(`[data-trip=${k}]`).fill(v);
}
async function line(p, index, category, amount, units = 1) {
  const r = p.locator(".travel-line").nth(index);
  await r.locator("[data-line=category]").selectOption(category);
  await r.locator("[data-line=date]").fill("2026-10-21");
  await r.locator("[data-line=units]").fill(String(units));
  await r.locator("[data-line=amount]").fill(String(amount));
}
async function base(p, name) {
  await p.locator("#create").click();
  await p.locator("[name=name]").fill(name);
  await p.locator("[name=note]").fill("虚构出差业务");
  await p.locator("[name=invoice]").fill(name);
  await p.locator("[name=receipt]").setInputFiles({
    name: "虚构票据.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo"),
  });
}
test.beforeEach(async ({ page: p }) => {
  await p.goto("/");
  await p.locator("#role").selectOption("员工");
});
test("行程申请批准、载入行程、多项费用合计并完成模拟付款核销", async ({
  page: p,
}) => {
  await nav(p, "费用申请");
  await p.locator("#new-request").click();
  await p.locator("[name=name]").fill("出差行程全链路");
  await p.locator("[name=month]").fill("2026-10");
  await p.locator("[name=amount]").fill("2000");
  await p.locator("[name=note]").fill("拜访虚构客户");
  await trip(p);
  await p.locator("#request-form [type=submit]").click();
  await row(p, "出差行程全链路").locator("[data-request]").click();
  await expect(p.locator(".trip-summary")).toContainText("3天 / 2晚");
  await p.locator("[data-close]").click();
  await p.locator("#role").selectOption("主管");
  await row(p, "出差行程全链路").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await p.locator("#role").selectOption("员工");
  await base(p, "差旅全链路报销");
  await p
    .locator("[name=requestId]")
    .selectOption(
      await p
        .locator("[name=requestId] option")
        .filter({ hasText: "出差行程全链路" })
        .getAttribute("value"),
    );
  await expect(p.locator("#travel-enabled")).toBeChecked();
  await expect(p.locator("[data-trip=destination]")).toHaveValue("上海");
  await line(p, 0, "住宿", 1000, 2);
  await p.locator("#travel-add-line").click();
  await line(p, 1, "餐补", 300, 3);
  await p.locator("#travel-add-line").click();
  await line(p, 2, "城际交通", 200);
  await expect(p.locator("[name=amount]")).toHaveValue("1500");
  await expect(p.locator("[name=amount]")).toHaveAttribute("readonly", "");
  await p.locator("[data-trip=destination]").fill("北京");
  await p.locator("#expense-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("行程必须与批准");
  await p.locator("[data-trip=destination]").fill("上海");
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "报销管理");
  await p.locator("#role").selectOption("主管");
  await row(p, "差旅全链路报销").locator("[data-detail]").click();
  await expect(p.locator(".travel-summary")).toContainText("住宿");
  await p.locator("#approve").click();
  await p.locator("#role").selectOption("财务");
  await row(p, "差旅全链路报销").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await row(p, "差旅全链路报销").locator("[data-detail]").click();
  await p.locator("#payment-reference").fill("TRAVEL-DEMO-015");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await expect(row(p, "差旅全链路报销")).toContainText("已付款");
  await nav(p, "费用申请");
  await expect(row(p, "出差行程全链路")).toContainText("500.00");
});
test("超标说明必填，重复住宿日期拦截，草稿编辑保留明细", async ({
  page: p,
}) => {
  await base(p, "差旅超标草稿");
  await trip(p);
  await line(p, 0, "住宿", 1100, 2);
  await expect(p.locator("#travel-checks")).toContainText("超过500元/晚");
  await p.locator("#expense-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("超标说明");
  await p.locator("#travel-exception").fill("展会期间酒店涨价，等待人工判断");
  await p.locator("#travel-add-line").click();
  await line(p, 1, "住宿", 100);
  await p.locator("#expense-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("日期重复");
  await p
    .locator(".travel-line")
    .nth(1)
    .locator("[data-travel-remove]")
    .click();
  await p.locator("#draft").click();
  await nav(p, "报销管理");
  await row(p, "差旅超标草稿").locator("[data-detail]").click();
  await p.locator("#edit").click();
  await expect(p.locator(".travel-line")).toHaveCount(1);
  await expect(p.locator("#travel-exception")).toHaveValue(
    "展会期间酒店涨价，等待人工判断",
  );
  await p.locator("#expense-form [type=submit]").click();
  await row(p, "差旅超标草稿").locator("[data-detail]").click();
  await expect(p.locator(".travel-summary")).toContainText("展会期间");
});
test("跨月行程与月份不一致被拒，旧普通报销仍可使用", async ({ page: p }) => {
  await nav(p, "费用申请");
  await p.locator("#new-request").click();
  await p.locator("[name=name]").fill("跨月行程");
  await p.locator("[name=month]").fill("2026-10");
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=note]").fill("虚构用途");
  await trip(p);
  await p.locator("[data-trip=end]").fill("2026-11-01");
  await p.locator("#request-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("跨月申请");
  await p.locator("[data-trip=end]").fill("2026-10-23");
  await p.locator("[name=month]").fill("2026-11");
  await p.locator("#request-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("计划月份");
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-close]").click();
  await base(p, "普通报销兼容");
  await p.locator("[name=amount]").fill("100");
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "报销管理");
  await expect(row(p, "普通报销兼容")).toContainText("待主管审批");
});
test("差旅备份完整导出、非法合计拒绝不覆盖存储", async ({ page: p }) => {
  await base(p, "差旅备份");
  await trip(p);
  await line(p, 0, "城际交通", 200);
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "数据管理");
  const wait = p.waitForEvent("download");
  await p.locator("#backup").click();
  const file = await wait;
  const fs = await import("node:fs/promises");
  const b = JSON.parse(await fs.readFile(await file.path(), "utf8"));
  expect(
    b.items.find((x) => x.name === "差旅备份").travel.lines[0].amount,
  ).toBe(200);
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  b.items.find((x) => x.name === "差旅备份").amount = 201;
  await p.locator("#restore").setInputFiles({
    name: "错误差旅.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("合计一致");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
});
test("手机明细增减、实时合计、标准页面与安全转义", async ({ page: p }) => {
  await p.setViewportSize({ width: 390, height: 844 });
  await base(p, "手机差旅");
  await trip(p);
  await p
    .locator("[data-trip=destination]")
    .fill("<img src=x onerror=alert(1)>");
  await line(p, 0, "城际交通", 100);
  await p.locator("#travel-add-line").click();
  await line(p, 1, "市内交通", 50);
  await expect(p.locator("[name=amount]")).toHaveValue("150");
  await p
    .locator(".travel-line")
    .nth(1)
    .locator("[data-travel-remove]")
    .click();
  await expect(p.locator("[name=amount]")).toHaveValue("100");
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "报销管理");
  await row(p, "手机差旅").locator("[data-detail]").click();
  await expect(p.locator(".trip-summary")).toContainText("<img");
  await expect(p.locator(".trip-summary img")).toHaveCount(0);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.locator("[data-close]").click();
  await nav(p, "差旅标准");
  await expect(p.locator("main")).toContainText("不代表法定标准");
  await expect(p.locator("tbody tr")).toHaveCount(4);
});
