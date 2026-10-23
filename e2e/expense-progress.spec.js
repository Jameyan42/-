import { test, expect } from "@playwright/test";
import { enterpriseOrg } from "../src/organization.js";
import {
  compileApproval,
  defaultFlows,
  financeDivisionFlows,
} from "../src/approval.js";
const org = enterpriseOrg();
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const card = (p, n) => p.locator(".progress-card").filter({ hasText: n });
function doc(id, status = "待主管审批", extra = {}) {
  return {
    id,
    name: id,
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 200,
    date: "2026-10-23",
    invoice: id,
    receipt: "虚构.pdf",
    note: "虚构进度验收",
    status,
    history: [],
    ...extra,
  };
}
async function setup(p, docs) {
  await p.goto("/");
  await p.evaluate(
    (d) => localStorage.setItem("qingbao-v1", JSON.stringify(d)),
    docs,
  );
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "报销进度");
}
test("本人归属与旧角色提示、筛选搜索不改数据，切身份清空", async ({
  page: p,
}) => {
  const d = doc("本人快照");
  d.approval = compileApproval(d, "expense", org, defaultFlows());
  await setup(p, [
    d,
    doc("旧角色记录"),
    doc("他人单据", "待主管审批", { employee: "陈嘉", department: "产品部" }),
  ]);
  await expect(p.locator(".progress-card")).toHaveCount(2);
  await expect(card(p, "本人快照")).toContainText("赵航");
  await expect(card(p, "旧角色记录")).toContainText("按原角色处理");
  await expect(p.locator(".expense-progress")).not.toContainText("他人单据");
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.locator("#progress-search").fill("赵航");
  await expect(p.locator(".progress-card")).toHaveCount(1);
  await p.locator("#actor").selectOption("chen");
  await expect(p.locator("#progress-search")).toHaveValue("");
  await expect(card(p, "他人单据")).toBeVisible();
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await p.locator("#role").selectOption("主管");
  await expect(p.locator(".progress-card")).toHaveCount(0);
  await expect(p.locator("main")).toContainText("请选择员工角色");
});
test("退回说明可查看修改并重新提交，新快照回到流转中", async ({ page: p }) => {
  await setup(p, [
    doc("退回进度", "已退回", {
      history: [{ text: "主管退回：请补充用途", time: "2026/10/23" }],
    }),
  ]);
  await p.locator(".tabs [data-progress-group=action]").click();
  await expect(card(p, "退回进度")).toContainText("请补充用途");
  await card(p, "退回进度").locator("[data-detail]").click();
  await p.locator("#edit").click();
  await p.locator("[name=note]").fill("已补充虚构业务用途");
  await p.locator("#expense-form [type=submit]").click();
  await p.locator(".tabs [data-progress-group=active]").click();
  await expect(card(p, "退回进度")).toContainText("赵航");
  await expect(card(p, "退回进度").locator("[aria-current=step]")).toHaveCount(
    1,
  );
  await expect(card(p, "退回进度")).not.toContainText("退回说明");
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "报销进度");
  await expect(card(p, "退回进度")).toContainText("待主管审批");
});
test("独立付款总账、已付不显示待处理人且不表示到账", async ({ page: p }) => {
  const d = doc("总账中", "待总账复核", {
    employee: "叶禾",
    department: "法报中心",
  });
  const a = compileApproval(
    d,
    "expense",
    org,
    financeDivisionFlows(defaultFlows(), org),
  );
  await setup(p, [
    { ...d, approval: { ...a, cursor: 2 } },
    {
      ...d,
      id: "付款中",
      name: "付款中",
      status: "待付款",
      approval: { ...a, cursor: 3 },
    },
    {
      ...d,
      id: "已付款进度",
      name: "已付款进度",
      status: "已付款",
      approval: { ...a, cursor: 3 },
    },
  ]);
  await p.locator("#actor").selectOption("staff-reporting");
  await expect(card(p, "总账中")).toContainText("当前待处理人：高璇");
  await expect(card(p, "付款中")).toContainText("当前待处理人：杜川");
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(card(p, "总账中").locator("[aria-current=step]")).toContainText(
    "高璇",
  );
  const bounds = await card(p, "总账中")
    .locator(".progress-steps")
    .boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await p.locator(".tabs [data-progress-group=paid]").click();
  await expect(card(p, "已付款进度")).toContainText("不代表银行到账");
  await expect(card(p, "已付款进度")).not.toContainText("当前待处理人");
});
test("多页记录搜索及分组重置页码，手机空态与转义", async ({ page: p }) => {
  await setup(p, [
    ...Array.from({ length: 12 }, (_, i) =>
      doc("分页" + String(i).padStart(2, "0")),
    ),
    doc("<img src=x onerror=alert(1)>", "草稿"),
  ]);
  await expect(p.locator(".progress-card")).toHaveCount(10);
  await p.locator('[data-progress-page="1"]').click();
  await expect(p.locator(".progress-card")).toHaveCount(3);
  await p.locator("#progress-search").fill("分页00");
  await expect(p.locator(".progress-card")).toHaveCount(1);
  await p.locator("#progress-clear").click();
  await p.locator(".tabs [data-progress-group=action]").click();
  await expect(p.locator(".progress-card img")).toHaveCount(0);
  await expect(p.locator(".progress-card")).toContainText("<img");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("#progress-search").fill("无匹配");
  await expect(p.locator(".expense-progress")).toContainText("没有符合条件");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
