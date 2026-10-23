import { test, expect } from "@playwright/test";
import { enterpriseOrg } from "../src/organization.js";
import {
  compileApproval,
  defaultFlows,
  financeDivisionFlows,
} from "../src/approval.js";
const org = enterpriseOrg(),
  nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
function doc(id) {
  const d = {
    id,
    name: id,
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 200,
    date: "2026-10-23",
    status: "待付款",
    invoice: id,
    receipt: "虚构.pdf",
    note: "虚构批量付款",
    history: [],
  };
  const a = compileApproval(
    d,
    "expense",
    org,
    financeDivisionFlows(defaultFlows(), org),
  );
  return {
    ...d,
    approval: { ...a, cursor: a.nodes.length },
    ledgerReview: {
      account: "6602",
      costCenter: "销售部",
      reviewedBy: "ledger-gao",
      at: "2026-10-23T00:00:00Z",
    },
  };
}
async function setup(p, docs = [doc("批量A"), doc("批量B")]) {
  await p.goto("/");
  await p.evaluate(
    (ds) => localStorage.setItem("qingbao-v1", JSON.stringify(ds)),
    docs,
  );
  await p.reload();
  await p.locator("#role").selectOption("付款");
  await nav(p, "付款工作台");
}
async function open(p, prefix = "DEMO-BATCH") {
  await p.locator("#payment-select-all").click();
  await p.locator("#payment-batch").click();
  await p.locator("#batch-payment-form [name=prefix]").fill(prefix);
}
test("批量核对后付款，每笔独立参考号与处理记录、刷新保留并可导出", async ({
  page: p,
}) => {
  await setup(p);
  await open(p);
  await expect(p.locator("#batch-preview")).toContainText("DEMO-BATCH-001");
  await expect(p.locator("#batch-preview")).toContainText("DEMO-BATCH-002");
  await expect(p.locator("#batch-payment-form [type=submit]")).toBeVisible();
  await p.locator("#batch-payment-form [name=confirmed]").check();
  await p.locator("#batch-payment-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("已登记 2 笔");
  await p.locator("[data-payment-filter=已付款]").click();
  await expect(row(p, "批量A")).toContainText("DEMO-BATCH-001");
  await expect(row(p, "批量B")).toContainText("DEMO-BATCH-002");
  await nav(p, "审批中心");
  await p.locator("[data-inbox-view=processed]").click();
  await expect(p.locator("tbody tr")).toHaveCount(2);
  await p.reload();
  await p.locator("#role").selectOption("付款");
  await nav(p, "付款工作台");
  await p.locator("[data-payment-filter=已付款]").click();
  const wait = p.waitForEvent("download");
  await p.locator("#payment-export").click();
  const fs = await import("node:fs/promises");
  const text = await fs.readFile(await (await wait).path(), "utf8");
  expect(text).toContain("DEMO-BATCH-002");
  expect(text).toContain("杜川");
});
test("单笔及批量重复参考号被拦，任何失败不部分付款", async ({ page: p }) => {
  const old = {
    ...doc("已登记"),
    status: "已付款",
    payment: {
      reference: " demo-dupe-002 ",
      date: "2026-10-22",
      method: "银行转账",
      confirmed: true,
    },
  };
  await setup(p, [doc("批量A"), doc("批量B"), old]);
  await open(p, "DEMO-DUPE");
  await p.locator("#batch-payment-form [name=confirmed]").check();
  await p.locator("#batch-payment-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("已使用");
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-v1")).filter(
          (d) => d.status === "待付款",
        ).length,
    ),
  ).toBe(2);
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-close]").click();
  await row(p, "批量A").locator("[data-detail]").click();
  await p.locator("#payment-reference").fill("DEMO-DUPE-002");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("已使用");
  await expect(p.locator("#approve")).toBeVisible();
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-v1")).find(
          (d) => d.id === "批量A",
        ).status,
    ),
  ).toBe("待付款");
});
test("容量失败保留全部单据和确认表单，可重试一次性成功", async ({
  page: p,
}) => {
  await setup(p);
  await open(p);
  await p.locator("#batch-payment-form [name=confirmed]").check();
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.evaluate(() => {
    window.originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-v1")
        throw new DOMException("quota", "QuotaExceededError");
      return window.originalSet.call(this, k, v);
    };
  });
  await p.locator("#batch-payment-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("原报销未改动");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await p.evaluate(() => (Storage.prototype.setItem = window.originalSet));
  await p.locator("#batch-payment-form [type=submit]").click();
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-v1")).filter(
          (d) => d.status === "已付款",
        ).length,
    ),
  ).toBe(2);
});
test("管理员只读、总账未完成不出现，筛选和换身份清空勾选，手机核对", async ({
  page: p,
}) => {
  const early = doc("待总账");
  early.status = "待总账复核";
  early.approval.cursor -= 1;
  delete early.ledgerReview;
  await setup(p, [doc("批量A"), doc("批量B"), early]);
  await expect(row(p, "待总账")).toHaveCount(0);
  await p.locator("#payment-select-all").click();
  await expect(p.locator(".payment-selection")).toContainText("已勾选 2 笔");
  await p.locator("#payment-search").fill("批量A");
  await expect(p.locator("#payment-batch")).toBeDisabled();
  await p.locator("#payment-select-all").click();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("#payment-batch").click();
  await expect(p.locator("#batch-preview")).toContainText("批量A");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.locator("[data-close]").click();
  await p.locator("#role").selectOption("管理员");
  await expect(p.locator("[data-payment-select]")).toHaveCount(0);
  await expect(p.locator("#payment-batch")).toBeDisabled();
});
