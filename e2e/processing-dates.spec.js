import { test, expect } from "@playwright/test";
import { makeOperation } from "../src/operations.js";
import { defaultOrg } from "../src/organization.js";
test.use({ timezoneId: "Asia/Shanghai" });
const nav = (p, n) => p.locator(`[data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
const actor = defaultOrg().people.find((p) => p.id === "manager-zhao");
function expense(name, at) {
  const d = {
    id: "DATE-" + name,
    name,
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 200,
    date: "2026-10-23",
    invoice: "DATE-" + name,
    receipt: "虚构.pdf",
    note: "日期验证",
    status: "待主管审批",
    history: [],
  };
  const operation = makeOperation({
    doc: d,
    kind: "expense",
    actor,
    action: "approve",
    stage: "business",
    label: "主管审批",
    toStatus: "待财务审核",
  });
  operation.at = at;
  return {
    ...d,
    status: "待财务审核",
    history: [{ text: "主管通过", time: "2026/10/23", operation }],
  };
}
async function setup(p, docs) {
  await p.clock.install({ time: new Date("2026-10-23T12:00:00Z") });
  await p.goto("/");
  await p.evaluate(
    (items) => localStorage.setItem("qingbao-v1", JSON.stringify(items)),
    docs,
  );
  await p.reload();
  await nav(p, "审批中心");
  await p.locator("[data-inbox-view=processed]").click();
}
async function exportCsv(p) {
  const wait = p.waitForEvent("download");
  await p.locator("#processed-export").click();
  const f = await wait;
  const { readFile } = await import("node:fs/promises");
  return readFile(await f.path(), "utf8");
}
test("本地日边界包含起止两端，页面与导出同范围且概览仍为全部", async ({
  page: p,
}) => {
  await setup(p, [
    expense("日前", "2026-10-22T15:59:59.999Z"),
    expense("日初", "2026-10-22T16:00:00Z"),
    expense("日末", "2026-10-23T15:59:59.999Z"),
    expense("日后", "2026-10-23T16:00:00Z"),
  ]);
  await p.locator("#processed-from").fill("2026-10-23");
  await p.locator("#processed-to").fill("2026-10-23");
  await expect(p.locator("tbody tr")).toHaveCount(2);
  await expect(row(p, "日初")).toBeVisible();
  await expect(row(p, "日末")).toBeVisible();
  await expect(p.locator(".table-footer")).toContainText("筛选共 2");
  await expect(p.locator("[data-processed-count=all]")).toHaveText("4");
  await expect(p.locator("#processed-date-help")).toContainText(
    "Asia/Shanghai",
  );
  const csv = await exportCsv(p);
  expect(csv).toContain("日初");
  expect(csv).toContain("日末");
  expect(csv).not.toContain("日前");
  expect(csv).not.toContain("日后");
  expect(csv).toContain("Asia/Shanghai");
  expect(csv).toContain("本地处理日期");
});
test("日期倒置明确报错禁导出，可纠正和清除所有筛选", async ({ page: p }) => {
  await setup(p, [expense("日期记录", "2026-10-23T04:00:00Z")]);
  await p.locator("#processed-from").fill("2026-10-24");
  await p.locator("#processed-to").fill("2026-10-23");
  await expect(p.locator("#processed-date-error")).toContainText(
    "开始日期不能晚于结束日期",
  );
  await expect(p.locator("#processed-export")).toBeDisabled();
  await expect(p.locator(".table-footer")).toContainText("筛选结果未计算");
  await expect(p.locator(".empty")).toContainText("日期范围无效");
  await p.locator("#processed-from").fill("2026-10-23");
  await expect(p.locator("#processed-date-error")).toHaveCount(0);
  await expect(p.locator("#processed-export")).toBeEnabled();
  await expect(row(p, "日期记录")).toBeVisible();
  await p.locator("#inbox-clear").click();
  await expect(p.locator("#processed-from")).toHaveValue("");
  await expect(p.locator("#processed-to")).toHaveValue("");
  await expect(p.locator("[data-date-preset=all]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("常用时间段按浏览器时钟生成，支持仅填一端和角色切换清空", async ({
  page: p,
}) => {
  await setup(p, [
    expense("今天记录", "2026-10-23T04:00:00Z"),
    expense("上月记录", "2026-09-15T04:00:00Z"),
  ]);
  await p.locator("[data-date-preset=today]").click();
  await expect(p.locator("#processed-from")).toHaveValue("2026-10-23");
  await expect(p.locator("#processed-to")).toHaveValue("2026-10-23");
  await expect(row(p, "今天记录")).toBeVisible();
  await expect(row(p, "上月记录")).toHaveCount(0);
  await p.locator("[data-date-preset=last7]").click();
  await expect(p.locator("#processed-from")).toHaveValue("2026-10-17");
  await p.locator("[data-date-preset=month]").click();
  await expect(p.locator("#processed-from")).toHaveValue("2026-10-01");
  await p.locator("[data-date-preset=lastMonth]").click();
  await expect(p.locator("#processed-from")).toHaveValue("2026-09-01");
  await expect(p.locator("#processed-to")).toHaveValue("2026-09-30");
  await expect(row(p, "上月记录")).toBeVisible();
  await p.locator("#processed-to").fill("");
  await expect(p.locator("tbody tr")).toHaveCount(2);
  await p.locator("#actor").selectOption("head-xu");
  await expect(p.locator("#processed-from")).toHaveValue("");
  await expect(p.locator("#processed-to")).toHaveValue("");
});
test("日期变化重置分页，导出覆盖日期内所有页，其他筛选同时生效", async ({
  page: p,
}) => {
  const docs = Array.from({ length: 25 }, (_, i) =>
    expense(
      "月内" + String(i).padStart(2, "0"),
      `2026-10-23T04:${String(i).padStart(2, "0")}:00Z`,
    ),
  );
  docs.push(expense("月外", "2026-09-23T04:00:00Z"));
  await setup(p, docs);
  await p.locator('[data-processed-page="1"]').click();
  await expect(p.locator(".processed-pagination")).toContainText("第 2");
  await p.locator("[data-date-preset=month]").click();
  await expect(p.locator(".processed-pagination")).toContainText("第 1 / 2");
  await expect(p.locator("tbody tr")).toHaveCount(20);
  const csv = await exportCsv(p);
  expect(csv).toContain("月内00");
  expect(csv).toContain("月内24");
  expect(csv).not.toContain("月外");
  await p.locator("#processed-result").selectOption("reject");
  await expect(p.locator(".empty")).toContainText("当前筛选");
  await p.locator("#processed-result").selectOption("approve");
  await p.locator("#inbox-search").fill("月内24");
  await expect(p.locator("tbody tr")).toHaveCount(1);
  await expect(row(p, "月内24")).toBeVisible();
});
test("手机日期控件和空结果无整页溢出，日期为视图状态不写入业务数据", async ({
  page: p,
}) => {
  await setup(p, [expense("旧月份", "2026-09-01T04:00:00Z")]);
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("[data-date-preset=today]").click();
  await expect(p.locator(".empty")).toContainText("当前筛选");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await p.reload();
  await nav(p, "审批中心");
  await p.locator("[data-inbox-view=processed]").click();
  await expect(p.locator("#processed-from")).toHaveValue("");
  await expect(row(p, "旧月份")).toBeVisible();
});
