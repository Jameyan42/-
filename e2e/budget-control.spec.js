import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const card = (p, d) =>
  p.locator(".budget-card").filter({ has: p.locator("h3", { hasText: d }) });
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
async function config(
  p,
  {
    department = "产品部",
    limit = 4860,
    month = "2026-10",
    mode = "block",
  } = {},
) {
  await p.locator("#role").selectOption("财务");
  await nav(p, "预算管理");
  await p.locator("#budget-month").fill(month);
  await p.locator(`[data-budget="${department}"]`).click();
  await p.locator("#budget-form [name=limit]").fill(String(limit));
  await p.locator("#budget-form [name=mode]").selectOption(mode);
  await p.locator("#budget-form [name=reason]").fill("演示本月预算管控调整");
  await p.locator("#budget-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("本月预算已更新");
}
async function employee(p) {
  await p.locator("#role").selectOption("员工");
  await p.locator("#actor").selectOption("chen");
}
async function createRequest(p, name = "预算核销申请", amount = "1000") {
  await employee(p);
  await nav(p, "费用申请");
  await p.locator("#new-request").click();
  await p.locator("#request-form [name=name]").fill(name);
  await p.locator("#request-form [name=amount]").fill(amount);
  await p.locator("#request-form [name=note]").fill("虚构差旅预算计划");
  await p.locator("#request-form [type=submit]").click();
}
async function approveRequest(p, name = "预算核销申请") {
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("manager-sun");
  await row(p, name).locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
}
async function claim(p, name = "预算内报销", amount = "265") {
  await employee(p);
  await nav(p, "报销管理");
  await p.locator("#create").click();
  await p.locator("#expense-form [name=name]").fill(name);
  await p.locator("#expense-form [name=amount]").fill(amount);
  await p.locator("#expense-form [name=note]").fill("虚构费用核销说明");
  await p.locator("#expense-form [name=invoice]").fill("42345678901234567890");
}
const submit = (p) => p.locator("#expense-form [type=submit]").click();
async function download(p, id) {
  const wait = p.waitForEvent("download");
  await p.locator(id).click();
  return readFile(await (await wait).path(), "utf8");
}

test("按月额度独立、财务具名调整记录及只读身份，失败保存不覆盖", async ({
  page: p,
}) => {
  await p.goto("/");
  await config(p);
  await expect(card(p, "产品部")).toContainText("4,860.00");
  await expect(card(p, "产品部")).toContainText("拦截新增占用");
  await p.locator("#budget-month").fill("2026-11");
  await expect(card(p, "产品部")).toContainText("15,000.00");
  await expect(card(p, "产品部")).toContainText("继承旧默认额度");
  await p.locator("#budget-month").fill("2026-10");
  await p.locator("#budget-history").click();
  await expect(p.locator("#overlay")).toContainText("周宁");
  await expect(p.locator("#overlay")).toContainText("15,000.00");
  await p.locator("[data-close]").click();
  const before = await p.evaluate(() =>
    localStorage.getItem("qingbao-budget-control-v1"),
  );
  await p.locator('[data-budget="产品部"]').click();
  await p.locator("#budget-form [name=limit]").fill("5000");
  await p.locator("#budget-form [name=reason]").fill("模拟配额失败重试");
  await p.evaluate(() => {
    window.realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-budget-control-v1") throw Error("quota");
      return window.realSet.call(this, k, v);
    };
  });
  await p.locator("#budget-form [type=submit]").click();
  await expect(p.locator("[data-budget-error]")).toContainText("原预算未改动");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-budget-control-v1")),
  ).toBe(before);
  await expect(p.locator("#budget-form [name=limit]")).toHaveValue("5000");
  await p.evaluate(() => (Storage.prototype.setItem = window.realSet));
  await p.locator("#budget-form [type=submit]").click();
  await expect(card(p, "产品部")).toContainText("5,000.00");
  await employee(p);
  await expect(p.locator("[data-budget]")).toHaveCount(0);
});

test("普通报销新增超额拦截、草稿可保存，调整额度后恢复提交", async ({
  page: p,
}) => {
  await p.goto("/");
  await config(p, { limit: 3960 });
  await claim(p, "新增预算拦截", "200");
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await submit(p);
  await expect(p.locator(".toast")).toContainText("新增占用超预算");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await expect(p.locator("[name=amount]")).toHaveValue("200");
  await p.locator("#draft").click();
  await expect(row(p, "新增预算拦截")).toContainText("草稿");
  await config(p, { limit: 4160 });
  await employee(p);
  await nav(p, "报销管理");
  await row(p, "新增预算拦截").locator("[data-detail]").click();
  await p.locator("#edit").click();
  await submit(p);
  await expect(row(p, "新增预算拦截")).toContainText("待主管审批");
});

test("申请最终批准预算不足不产生审批记录，调整后可批准", async ({
  page: p,
}) => {
  await p.goto("/");
  await config(p, { limit: 4360 });
  await createRequest(p);
  const before = await p.evaluate(() =>
    localStorage.getItem("qingbao-requests-v1"),
  );
  await approveRequest(p);
  await expect(p.locator(".toast")).toContainText("新增占用超预算");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-requests-v1")),
  ).toBe(before);
  await p.locator("[data-close]").click();
  await config(p, { limit: 4860 });
  await nav(p, "费用申请");
  await approveRequest(p);
  await expect(row(p, "预算核销申请")).toContainText("已批准");
});

test("申请预留转报销/总账/付款不重复扣预算，降额仍允许核销并结束释放", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "审批流程");
  await p.locator("#finance-flow-template").click();
  await p.locator("[name=publishReason]").fill("演示预算与独立财务分工");
  await p.locator("#publish-flow").click();
  await config(p);
  await createRequest(p);
  await approveRequest(p);
  await expect(row(p, "预算核销申请")).toContainText("已批准");
  await config(p, { limit: 3970 });
  await claim(p);
  const requestId = await p
    .locator("[name=requestId] option")
    .nth(1)
    .getAttribute("value");
  await p.locator("[name=requestId]").selectOption(requestId);
  await p.locator("#attachment-kind").selectOption("发票");
  await p
    .locator("#attachments-upload")
    .setInputFiles("public/samples/structured-invoice.png");
  await expect(p.locator("#attachments-status")).toContainText("已添加");
  await submit(p);
  await expect(row(p, "预算内报销")).toContainText("待主管审批");
  for (const [role, actor] of [
    ["主管", "head-liang"],
    ["财务", "finance-zhou"],
    ["总账", "ledger-gao"],
    ["付款", "payer-du"],
  ]) {
    await p.locator("#role").selectOption(role);
    await p.locator("#actor").selectOption(actor);
    await row(p, "预算内报销").locator("[data-detail]").click();
    if (role === "总账") {
      await p.locator("#ledger-account").fill("6602差旅费");
      await p.locator("#ledger-costcenter").fill("产品部");
    }
    if (role === "付款") {
      await p.locator("#payment-reference").fill("DEMO-BUDGET-026");
      await p.locator("#payment-confirm").check();
    }
    await p.locator("#approve").click();
  }
  await expect(row(p, "预算内报销")).toContainText("已付款");
  await nav(p, "预算管理");
  await expect(card(p, "产品部").locator("dl")).toContainText("735.00");
  await expect(card(p, "产品部").locator("dl")).toContainText("265.00");
  await employee(p);
  await nav(p, "费用申请");
  await row(p, "预算核销申请").locator("[data-request]").click();
  await p.locator("#request-reason").fill("实际支出完成，释放未使用预留");
  await p.locator("[data-request-action=close]").click();
  await nav(p, "预算管理");
  await p.locator('[data-budget-ledger="产品部"]').click();
  await expect(p.locator("#overlay")).toContainText("4,125.00");
  await expect(p.locator("#overlay")).not.toContainText("申请剩余预留");
  const csv = await download(p, "[data-budget-ledger-export]");
  expect(csv).toContain("预算内报销");
  expect(csv.trim().split("\r\n")).toHaveLength(3);
  await row(p, "预算内报销").locator("[data-budget-open]").click();
  await expect(p.locator("#overlay")).toContainText("DEMO-BUDGET-026");
});

test("预算新旧备份往返、坏月度记录拒绝、损坏配置暂停新增且保留原值", async ({
  page: p,
}) => {
  await p.goto("/");
  await config(p);
  await nav(p, "数据管理");
  const backup = JSON.parse(await download(p, "#backup"));
  expect(backup.budgetControl.periods[0].limit).toBe(4860);
  const bad = structuredClone(backup);
  bad.budgetControl.periods.push(bad.budgetControl.periods[0]);
  await p.locator("#restore").setInputFiles({
    name: "坏预算.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(p.locator(".toast")).toContainText("月度预算");
  const old = structuredClone(backup);
  delete old.budgetControl;
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "旧预算.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-budget-control-v1")).periods[0]
          .limit,
    ),
  ).toBe(4860);
  await p.evaluate(() =>
    localStorage.setItem("qingbao-budget-control-v1", "{broken"),
  );
  await p.reload();
  await nav(p, "预算管理");
  await expect(p.locator(".risk[role=alert]")).toContainText("统计不完整");
  await expect(p.locator("#budget-export")).toBeDisabled();
  await claim(p, "未知预算不能提交", "200");
  await submit(p);
  await expect(p.locator(".toast")).toContainText("不能确认新增占用");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-budget-control-v1")),
  ).toBe("{broken");
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-close]").click();
  const originalOrg = await p.evaluate(() =>
    localStorage.getItem("qingbao-configuration-v1"),
  );
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
  await p.locator('[data-org-select="person:head-reporting"]').click();
  await p
    .locator("#org-inspector-form [name=title]")
    .fill("预算异常时不保存修改");
  await p.locator("#org-inspector-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("预算配置异常");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-configuration-v1")),
  ).toBe(originalOrg);
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-budget-control-v1")),
  ).toBe("{broken");
  p.once("dialog", (d) => d.accept());
  await nav(p, "数据管理");
  await p.locator("#restore").setInputFiles({
    name: "缺少预算配置.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect(p.locator(".toast")).toContainText("旧备份不含月度预算");
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "完整预算.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
});

test("预算占用明细20条分页及全量导出，面试准备导航和手册下载不改业务", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.evaluate(() => {
    localStorage.setItem(
      "qingbao-v1",
      JSON.stringify(
        Array.from({ length: 25 }, (_, i) => ({
          id: "BUDGET-" + i,
          name: "预算明细" + i,
          employee: "陈嘉",
          department: "产品部",
          amount: 100,
          date: "2026-10-24",
          type: "差旅交通",
          status: "待主管审批",
          invoice: "423456789012345" + String(i).padStart(2, "0"),
          receipt: "虚构.pdf",
          note: "虚构明细",
          history: [],
        })),
      ),
    );
  });
  await p.reload();
  await nav(p, "预算管理");
  await p.locator('[data-budget-ledger="产品部"]').click();
  await expect(p.locator("#overlay tbody tr")).toHaveCount(20);
  expect(
    (await download(p, "[data-budget-ledger-export]")).trim().split("\r\n"),
  ).toHaveLength(26);
  await p.locator('[data-budget-page="1"]').click();
  await expect(p.locator("#overlay tbody tr")).toHaveCount(5);
  await p.locator("[data-close]").click();
  const before = await p.evaluate(() => JSON.stringify({ ...localStorage }));
  await p.goto("/?view=interview");
  await expect(p.locator("main h1")).toHaveText("面试准备");
  await expect(p.locator(".interview-prep")).toContainText("12个高频问题");
  const md = await download(p, "#interview-download");
  expect(md).toBe(await readFile("docs/面试演示与答辩手册.md", "utf8"));
  await p.locator('[data-practice-page="预算管理"]').first().click();
  await expect(p.locator("#role")).toHaveValue("财务");
  expect(await p.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(
    before,
  );
  await nav(p, "面试准备");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
