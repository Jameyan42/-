import { test, expect } from "@playwright/test";
const nav = (p, name) => p.locator(`[data-page="${name}"]`).click();
const row = (p, name) => p.locator("tbody tr").filter({ hasText: name });
const processed = (p) => p.locator("[data-inbox-view=processed]").click();
async function request(p, name) {
  await p.locator("#role").selectOption("员工");
  await nav(p, "费用申请");
  await p.locator("#new-request").click();
  await p.locator("#request-form [name=name]").fill(name);
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=note]").fill("虚构记录申请");
  await p.locator("#request-form button[type=submit]").click();
}
async function claim(p, name, employee = "lin") {
  await p.locator("#role").selectOption("员工");
  await p.locator("#actor").selectOption(employee);
  await p.locator("#create").click();
  await p.locator("[name=name]").fill(name);
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=note]").fill("虚构处理记录");
  await p.locator("[name=invoice]").fill("PROCESSED-001");
  await p.locator("[name=receipt]").setInputFiles({
    name: "虚构票据.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo"),
  });
  await p.locator("#expense-form button[type=submit]").click();
}
async function pending(p, role = "主管", actor = "manager-zhao") {
  await p.locator("#role").selectOption(role);
  await p.locator("#actor").selectOption(actor);
  await nav(p, "审批中心");
  await p.locator("[data-inbox-view=pending]").click();
}
test("本人申请处理可回看，同角色其他人员无记录，刷新仍保留", async ({
  page: p,
}) => {
  await p.goto("/");
  await request(p, "处理记录申请");
  await pending(p);
  await row(p, "处理记录申请").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await expect(row(p, "处理记录申请")).toHaveCount(0);
  const count = await p.locator('[data-page="审批中心"] em').innerText();
  await processed(p);
  await expect(row(p, "处理记录申请")).toContainText("当时：已批准");
  await expect(p.locator("[data-processed-count=all]")).toHaveText("1");
  await expect(p.locator('[data-page="审批中心"] em')).toHaveText(count);
  await p.locator("#actor").selectOption("head-xu");
  await expect(row(p, "处理记录申请")).toHaveCount(0);
  await expect(p.locator(".empty")).toContainText("尚无可归属");
  await p.locator("#actor").selectOption("manager-zhao");
  await expect(row(p, "处理记录申请")).toBeVisible();
  await p.reload();
  await nav(p, "审批中心");
  await processed(p);
  await expect(row(p, "处理记录申请")).toBeVisible();
});
test("退回重提两次操作保留原金额事项，按结果导出只含筛选范围", async ({
  page: p,
}) => {
  await p.goto("/");
  await claim(p, "记录原事项");
  await pending(p);
  await row(p, "记录原事项").locator("[data-detail]").click();
  await p.locator("#reason").fill("补充用途");
  await p.locator("#reject").click();
  await processed(p);
  await expect(row(p, "记录原事项")).toContainText("200.00");
  await p.locator("#role").selectOption("员工");
  await nav(p, "报销管理");
  await row(p, "记录原事项").locator("[data-detail]").click();
  await p.locator("#edit").click();
  await p.locator("[name=name]").fill("记录更新事项");
  await p.locator("[name=amount]").fill("600");
  await p.locator("[name=note]").fill("已补充用途");
  await p.locator("#expense-form button[type=submit]").click();
  await pending(p);
  await row(p, "记录更新事项").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await processed(p);
  await expect(p.locator("[data-processed-count=all]")).toHaveText("2");
  await expect(row(p, "记录原事项")).toContainText("200.00");
  await expect(row(p, "记录原事项")).toContainText("当时：已退回");
  await expect(row(p, "记录原事项")).toContainText("当前：待财务审核");
  await expect(row(p, "记录更新事项")).toContainText("600.00");
  await p.locator("#processed-result").selectOption("reject");
  await expect(row(p, "记录更新事项")).toHaveCount(0);
  const wait = p.waitForEvent("download");
  await p.locator("#processed-export").click();
  const f = await wait;
  const { readFile } = await import("node:fs/promises");
  const csv = await readFile(await f.path(), "utf8");
  expect(csv).toContain("记录原事项");
  expect(csv).not.toContain("记录更新事项");
  expect(csv).toContain("补充用途");
  await row(p, "记录原事项").locator("[data-detail]").click();
  await expect(p.locator(".modal")).toContainText("记录更新事项");
  await p.locator("[data-close]").click();
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
test("总账与付款记录分别归属，保留当时核算与付款摘要", async ({ page: p }) => {
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "审批流程");
  await p.locator("#finance-flow-template").click();
  await p.locator("[name=publishReason]").fill("验证分工处理记录");
  await p.locator("#publish-flow").click();
  await claim(p, "完整处理记录", "staff-reporting");
  for (const [role, actor] of [
    ["主管", "head-reporting"],
    ["财务", "finance-zhou"],
    ["总账", "ledger-gao"],
  ]) {
    await pending(p, role, actor);
    await row(p, "完整处理记录").locator("[data-detail]").click();
    if (role === "总账") {
      await p.locator("#ledger-account").fill("6602");
      await p.locator("#ledger-costcenter").fill("法报中心 / 记录项目");
    }
    await p.locator("#approve").click();
  }
  await processed(p);
  await expect(row(p, "完整处理记录")).toContainText("科目 6602");
  await expect(row(p, "完整处理记录")).toContainText("法报中心 / 记录项目");
  await pending(p, "付款", "payer-du");
  await row(p, "完整处理记录").locator("[data-detail]").click();
  await p.locator("#payment-reference").fill("DEMO-RECORD-PAY");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await processed(p);
  await expect(row(p, "完整处理记录")).toContainText("付款登记");
  await expect(row(p, "完整处理记录")).toContainText("DEMO-RECORD-PAY");
  await expect(p.locator("[data-processed-count=all]")).toHaveText("1");
  await p.locator("#role").selectOption("总账");
  await expect(row(p, "完整处理记录")).toContainText("科目 6602");
  await expect(row(p, "完整处理记录")).not.toContainText("DEMO-RECORD-PAY");
  await expect(row(p, "完整处理记录")).toContainText("当前：已付款");
});
test("处理记录备份往返并拒绝非法元数据，损坏申请存储不能假完整导出", async ({
  page: p,
}) => {
  await p.goto("/");
  await request(p, "备份具名记录");
  await pending(p);
  await row(p, "备份具名记录").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await nav(p, "数据管理");
  const wait = p.waitForEvent("download");
  await p.locator("#backup").click();
  const f = await wait;
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(await f.path(), "utf8"));
  expect(data.requests[0].history.at(-1).operation.actorId).toBe(
    "manager-zhao",
  );
  const bad = structuredClone(data);
  bad.requests[0].history.at(-1).operation.actorId = "";
  const restore = (d) =>
    p.locator("#restore").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(d)),
    });
  await restore(bad);
  await expect(p.locator(".toast")).toContainText("处理记录格式无效");
  p.once("dialog", (d) => d.accept());
  await restore(data);
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  await nav(p, "审批中心");
  await processed(p);
  await expect(row(p, "备份具名记录")).toBeVisible();
  await p.evaluate(() =>
    localStorage.setItem("qingbao-requests-v1", "{broken"),
  );
  await p.reload();
  await nav(p, "审批中心");
  await processed(p);
  await expect(p.locator("[role=alert]")).toContainText("不完整");
  await p.locator("#processed-export").click();
  await expect(p.locator(".toast")).toContainText("不能导出完整处理记录");
});
test("仅具名旧文本不猜归属，升级后处理旧单据可开始留痕", async ({
  page: p,
}) => {
  await p.goto("/");
  await nav(p, "数据管理");
  const download = p.waitForEvent("download");
  await p.locator("#backup").click();
  const f = await download;
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(await f.path(), "utf8"));
  data.items[0].history.push({ text: "赵航审批通过", time: "旧日志" });
  await p.evaluate(
    (items) => localStorage.setItem("qingbao-v1", JSON.stringify(items)),
    data.items,
  );
  await p.reload();
  await nav(p, "审批中心");
  await processed(p);
  await expect(p.locator("[data-processed-count=all]")).toHaveText("0");
  await p.locator("[data-inbox-view=pending]").click();
  await row(p, "上海客户拜访差旅").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await processed(p);
  await expect(row(p, "上海客户拜访差旅")).toContainText("历史固定流程");
  await expect(p.locator("[data-processed-count=all]")).toHaveText("1");
});
test("处理记录分页且筛选导出包含所有匹配页", async ({ page: p }) => {
  const { makeOperation } = await import("../src/operations.js");
  const { defaultOrg } = await import("../src/organization.js");
  const actor = defaultOrg().people.find((p) => p.id === "manager-zhao");
  const items = Array.from({ length: 25 }, (_, i) => {
    const d = {
      id: "PAGE-" + String(i).padStart(2, "0"),
      name: "分页记录" + String(i).padStart(2, "0"),
      employee: "林晓",
      department: "销售部",
      type: "差旅交通",
      amount: 200,
      date: "2026-10-23",
      invoice: "PAGE-" + i,
      receipt: "虚构.pdf",
      note: "分页验证",
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
    operation.at = `2026-10-23T01:${String(i).padStart(2, "0")}:00.000Z`;
    return {
      ...d,
      status: "待财务审核",
      history: [{ text: "主管通过", time: "2026/10/23", operation }],
    };
  });
  await p.goto("/");
  await p.evaluate(
    (items) => localStorage.setItem("qingbao-v1", JSON.stringify(items)),
    items,
  );
  await p.reload();
  await nav(p, "审批中心");
  await processed(p);
  await expect(p.locator("tbody tr")).toHaveCount(20);
  await expect(p.locator(".processed-pagination")).toContainText("第 1 / 2 页");
  await p.locator('[data-processed-page="1"]').click();
  await expect(p.locator("tbody tr")).toHaveCount(5);
  const wait = p.waitForEvent("download");
  await p.locator("#processed-export").click();
  const f = await wait;
  const { readFile } = await import("node:fs/promises");
  const csv = await readFile(await f.path(), "utf8");
  expect(csv).toContain("分页记录00");
  expect(csv).toContain("分页记录24");
  await p.locator("#inbox-search").fill("分页记录24");
  await expect(p.locator("tbody tr")).toHaveCount(1);
  await expect(p.locator(".processed-pagination")).toHaveCount(0);
  await expect(p.locator("tbody tr")).toContainText("分页记录24");
});
