import { test, expect } from "@playwright/test";
import { defaultOrg } from "../src/organization.js";
import { compileApproval, defaultFlows } from "../src/approval.js";
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const card = (p, n) => p.locator(".message-card").filter({ hasText: n });
function doc(id = "消息报销", status = "待主管审批") {
  return {
    id,
    name: id,
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 200,
    date: "2026-10-23",
    status,
    receipt: "虚构.pdf",
    invoice: id,
    note: "虚构消息验证",
    history: [],
  };
}
function submitted(id) {
  const d = doc(id);
  return {
    ...d,
    approval: compileApproval(d, "expense", defaultOrg(), defaultFlows()),
  };
}
async function setup(p, items, role = "主管") {
  await p.goto("/");
  await p.evaluate(
    (d) => localStorage.setItem("qingbao-v1", JSON.stringify(d)),
    items,
  );
  await p.reload();
  await p.locator("#role").selectOption(role);
  await nav(p, "消息中心");
}
test("待办消息跳转审批，员工退回提示改为新待办，阅读不改变业务", async ({
  page: p,
}) => {
  await setup(p, [submitted("消息审批闭环")]);
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await card(p, "消息审批闭环").locator("[data-message-read]").click();
  await expect(card(p, "消息审批闭环")).toContainText("已读");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await card(p, "消息审批闭环").locator("[data-message-open]").click();
  await p.locator("#reason").fill("请补充酒店水单");
  await p.locator("#reject").click();
  await expect(p.locator(".message-card")).toHaveCount(0);
  await p.locator("#role").selectOption("员工");
  await expect(card(p, "消息审批闭环")).toContainText("请补充酒店水单");
  await card(p, "消息审批闭环").locator("[data-message-open]").click();
  await p.locator("#edit").click();
  await p.locator("[name=note]").fill("补充用途后重新提交");
  await p.locator("#expense-form [type=submit]").click();
  await p.locator("#role").selectOption("主管");
  await expect(card(p, "消息审批闭环")).toContainText("未读");
});
test("跨页筛选标记覆盖全部，换人隔离、刷新保留和无业务写入", async ({
  page: p,
}) => {
  await setup(
    p,
    Array.from({ length: 25 }, (_, i) => doc("分页消息" + i)),
  );
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await expect(p.locator(".message-card")).toHaveCount(20);
  await p.locator('[data-message-page="1"]').click();
  await expect(p.locator(".message-card")).toHaveCount(5);
  await p.locator("#message-unread").selectOption("unread");
  await p.locator("#message-read-filtered").click();
  await expect(p.locator(".message-card")).toHaveCount(0);
  await p.reload();
  await nav(p, "消息中心");
  await p.locator("#message-unread").selectOption("unread");
  await expect(p.locator(".message-card")).toHaveCount(0);
  await p.locator("#actor").selectOption("head-xu");
  await expect(p.locator("#message-unread")).toHaveValue("all");
  await expect(p.locator(".message-is-unread")).toHaveCount(20);
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
});
test("已读备份恢复与旧备份保留现有状态，坏已读格式不覆盖", async ({
  page: p,
}) => {
  await setup(p, [submitted("备份消息")]);
  await p.locator("[data-message-read]").click();
  await nav(p, "数据管理");
  const wait = p.waitForEvent("download");
  await p.locator("#backup").click();
  const fs = await import("node:fs/promises");
  const b = JSON.parse(await fs.readFile(await (await wait).path(), "utf8"));
  expect(b.messageRead.byActor["manager-zhao"].length).toBe(1);
  const before = await p.evaluate(() =>
    localStorage.getItem("qingbao-message-read-v1"),
  );
  const bad = structuredClone(b);
  bad.messageRead.schema = 2;
  await p.locator("#restore").setInputFiles({
    name: "坏消息.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(p.locator(".toast")).toContainText("已读记录格式无效");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-message-read-v1")),
  ).toBe(before);
  const withRead = structuredClone(b);
  delete b.messageRead;
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "旧备份.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-message-read-v1")),
  ).toBe(before);
  await p.evaluate(() => localStorage.removeItem("qingbao-message-read-v1"));
  await p.reload();
  await nav(p, "数据管理");
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "新消息备份.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(withRead)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-message-read-v1")),
  ).toBe(before);
  await nav(p, "消息中心");
  await expect(card(p, "备份消息")).toContainText("已读");
});
test("损坏与容量错误不覆盖已读，业务仍可查看，申请损坏提示部分结果", async ({
  page: p,
}) => {
  await setup(p, [submitted("容量消息")]);
  await p.evaluate(() => {
    window.oldSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-message-read-v1") throw Error("quota");
      return window.oldSet.call(this, k, v);
    };
  });
  await p.locator("[data-message-read]").click();
  await expect(p.locator(".toast")).toContainText("未改动已读状态");
  await expect(card(p, "容量消息")).toContainText("未读");
  await p.evaluate(() => {
    Storage.prototype.setItem = window.oldSet;
    localStorage.setItem("qingbao-message-read-v1", "broken");
    localStorage.setItem("qingbao-requests-v1", "broken-requests");
  });
  await p.reload();
  await nav(p, "消息中心");
  await expect(p.locator("[role=alert]")).toHaveCount(2);
  await expect(p.locator("#message-read-filtered")).toBeDisabled();
  await p.locator("[data-message-open]").click();
  await expect(p.locator("#approve")).toBeVisible();
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-message-read-v1")),
  ).toBe("broken");
});
test("手机结果通知、关键词类别空态、名称安全转义", async ({ page: p }) => {
  await setup(
    p,
    [doc("<img src=x onerror=alert(1)>", "已付款"), doc("退回消息", "已退回")],
    "员工",
  );
  await p.setViewportSize({ width: 1280, height: 720 });
  await nav(p, "产品说明");
  expect(await p.locator("aside").evaluate((e) => e.scrollTop)).toBeGreaterThan(
    0,
  );
  await nav(p, "消息中心");
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(p.locator(".message-card img")).toHaveCount(0);
  await expect(card(p, "<img")).toContainText("不代表银行到账");
  await p.locator("#message-search").fill("退回");
  await expect(p.locator(".message-card")).toHaveCount(1);
  await p.locator("#message-type").selectOption("todo");
  await expect(p.locator(".messages-panel")).toContainText("没有符合条件");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
