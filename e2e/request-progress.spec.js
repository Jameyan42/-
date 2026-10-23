import { test, expect } from "@playwright/test";
import { defaultOrg } from "../src/organization.js";
import { defaultFlows, compileApproval } from "../src/approval.js";
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const card = (p, n) => p.locator(".progress-card").filter({ hasText: n });
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
function req(id, status = "已批准", extra = {}) {
  return {
    id,
    name: id,
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    month: "2026-10",
    amount: 1000,
    note: "虚构申请进度",
    history: [],
    status,
    ...extra,
  };
}
async function setup(p, requests) {
  await p.goto("/");
  await p.evaluate(
    (rs) => localStorage.setItem("qingbao-requests-v1", JSON.stringify(rs)),
    requests,
  );
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "申请进度");
}
async function csv(p) {
  const wait = p.waitForEvent("download");
  await p.locator("#request-progress-export").click();
  const f = await wait;
  const fs = await import("node:fs/promises");
  return fs.readFile(await f.path(), "utf8");
}
test("真实申请批准、关联报销在途、撤回回补与结束不再预留", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.locator("#role").selectOption("员工");
  await nav(p, "费用申请");
  await p.locator("#new-request").click();
  await p.locator("[name=name]").fill("申请进度闭环");
  await p.locator("[name=amount]").fill("1000");
  await p.locator("[name=note]").fill("虚构客户拜访");
  await p.locator("#request-form [type=submit]").click();
  await nav(p, "申请进度");
  await expect(card(p, "申请进度闭环")).toContainText("赵航");
  await p.locator("#role").selectOption("主管");
  await nav(p, "费用申请");
  await row(p, "申请进度闭环").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await p.locator("#role").selectOption("员工");
  await p.locator("#create").click();
  await p.locator("[name=name]").fill("进度关联报销");
  await p.locator("[name=amount]").fill("600");
  await p.locator("[name=note]").fill("虚构交通用途");
  await p.locator("[name=invoice]").fill("REQ-PROGRESS");
  await p
    .locator("[name=receipt]")
    .setInputFiles({
      name: "虚构.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo"),
    });
  await p
    .locator("[name=requestId]")
    .selectOption(
      await p
        .locator("[name=requestId] option")
        .filter({ hasText: "申请进度闭环" })
        .getAttribute("value"),
    );
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "申请进度");
  await expect(
    card(p, "申请进度闭环").locator(".request-amounts"),
  ).toContainText("400.00");
  await expect(card(p, "申请进度闭环")).toContainText("当前不能结束");
  await card(p, "申请进度闭环").locator("summary").click();
  await card(p, "申请进度闭环").locator("[data-detail]").click();
  await p.locator("#withdraw-reason").fill("行程调整");
  await p.locator("#withdraw").click();
  await expect(
    card(p, "申请进度闭环").locator(".request-amounts"),
  ).toContainText("1,000.00");
  await card(p, "申请进度闭环").locator("[data-request]").click();
  await p.locator("#request-reason").fill("不再出差");
  await p.locator("[data-request-action=close]").click();
  await expect(card(p, "申请进度闭环")).toContainText("已关闭");
  await expect(card(p, "申请进度闭环")).toContainText("不能再关联");
});
test("分页全量导出、联合状态月份目的地搜索、重置与存储不变", async ({
  page: p,
}) => {
  await setup(p, [
    ...Array.from({ length: 12 }, (_, i) =>
      req("进度分页" + String(i).padStart(2, "0")),
    ),
    req("其他月", "已关闭", { month: "2026-11" }),
    req("目的地", "已批准", {
      trip: {
        origin: "杭州",
        destination: "上海",
        start: "2026-10-21",
        end: "2026-10-23",
        cityLevel: "重点城市",
        grade: "普通员工",
      },
    }),
  ]);
  const before = await p.evaluate(() =>
    localStorage.getItem("qingbao-requests-v1"),
  );
  await p.locator('[data-request-progress-page="1"]').click();
  await expect(p.locator(".progress-card")).toHaveCount(4);
  await p.locator("#request-progress-status").selectOption("已批准");
  await p.locator("#request-progress-month").fill("2026-10");
  await expect(p.locator(".processed-pagination")).toContainText("第 1 / 2");
  const text = await csv(p);
  expect(text).toContain("进度分页11");
  expect(text).not.toContain("其他月");
  await p.locator("#request-progress-search").fill("上海");
  await expect(p.locator(".progress-card")).toHaveCount(1);
  await p.locator("#request-progress-clear").click();
  await expect(p.locator("#request-progress-month")).toHaveValue("");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-requests-v1")),
  ).toBe(before);
});
test("本人快照归属、当前审批路径、旧角色提示和换身份清空", async ({
  page: p,
}) => {
  const r = req("具名进度", "待审批");
  r.approval = compileApproval(r, "request", defaultOrg(), defaultFlows());
  await setup(p, [
    r,
    req("旧申请", "待审批"),
    req("他人申请", "已批准", { employee: "陈嘉", department: "产品部" }),
  ]);
  await expect(p.locator(".progress-card")).toHaveCount(2);
  await expect(
    card(p, "具名进度").locator("[aria-current=step]"),
  ).toContainText("赵航");
  await expect(card(p, "旧申请")).toContainText("按原角色处理");
  await p.locator("#request-progress-search").fill("赵航");
  await p.locator("#actor").selectOption("chen");
  await expect(p.locator("#request-progress-search")).toHaveValue("");
  await expect(card(p, "他人申请")).toBeVisible();
  await p.locator("#role").selectOption("主管");
  await expect(p.locator(".progress-card")).toHaveCount(0);
  await expect(p.locator("#request-progress-export")).toHaveCount(0);
});
test("驳回关闭口径、手机路径及空态、文本转义", async ({ page: p }) => {
  const r = req("手机待审", "待审批");
  r.approval = compileApproval(r, "request", defaultOrg(), defaultFlows());
  await setup(p, [
    r,
    req("<img src=x onerror=alert(1)>", "已驳回", {
      history: [{ text: "主管驳回：请明确用途", time: "2026/10/23" }],
    }),
    req("已关闭未用", "已关闭"),
  ]);
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(
    card(p, "手机待审").locator("[aria-current=step]"),
  ).toBeVisible();
  const bounds = await card(p, "手机待审").boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await p.locator("#request-progress-status").selectOption("已驳回");
  await expect(p.locator(".progress-card")).toContainText("请明确用途");
  await expect(p.locator(".progress-card img")).toHaveCount(0);
  await p.locator("#request-progress-search").fill("不存在");
  await expect(p.locator(".request-progress")).toContainText("没有符合条件");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
test("申请存储损坏明确提示，禁止假完整导出且保留原始内容", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.evaluate(() =>
    localStorage.setItem("qingbao-requests-v1", "broken-raw"),
  );
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "申请进度");
  await expect(p.locator("[role=alert]")).toContainText("无法完整读取");
  await expect(p.locator("#request-progress-export")).toHaveCount(0);
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-requests-v1")),
  ).toBe("broken-raw");
});
