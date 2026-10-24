import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { enterpriseOrg } from "../src/organization.js";
import { defaultFlows, financeDivisionFlows } from "../src/approval.js";
import {
  emptyEnterprise,
  saveSupplier,
  saveContract,
  reviewContract,
  submitCorporate,
  actCorporate,
} from "../src/enterprise.js";
import { demoContractText } from "../src/contract-review.js";
const org = enterpriseOrg(),
  who = (id) => org.people.find((p) => p.id === id),
  flows = financeDivisionFlows(defaultFlows(), org);
function seed(count = 1, name = "统一工作台对公单") {
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "远帆服务有限公司（虚构）",
      accountName: "远帆服务有限公司（虚构）",
      creditCode: "DEMO-WORKBENCH",
      bankName: "虚构银行",
      bankAccount: "DEMO-WORKBENCH-001",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "统一待办合同",
      number: "HT-WORKBENCH",
      supplierId: s.suppliers[0].id,
      amount: 10000,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      text: demoContractText,
    },
    who("lin"),
    org,
  );
  s = reviewContract(s, s.contracts[0].id, who("finance-zhou"), {
    approve: true,
    confirmed: true,
    note: "虚构合同人工核对",
  });
  s = submitCorporate(
    s,
    {
      name,
      contractId: s.contracts[0].id,
      amount: 100,
      date: "2026-10-24",
      note: "虚构付款依据",
    },
    who("lin"),
    org,
    flows,
  );
  if (count > 1)
    s.payments = Array.from({ length: count }, (_, i) => ({
      ...structuredClone(s.payments[0]),
      id: "DG-WB-" + i,
      name: "对公批次" + String(i).padStart(2, "0"),
    }));
  return s;
}
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const form = (p) => p.locator("#enterprise-form");
const submit = (p) => form(p).locator("[type=submit]").click();
const rows = (p) => p.locator("tbody tr");
const corporate = (p) => p.locator('[data-inbox-kind="corporate"]').click();
async function role(p, name) {
  await p.locator("#role").selectOption(name);
  if (name === "主管") await p.locator("#actor").selectOption("head-xu");
}
async function setup(p, s = seed(), published = flows) {
  await p.goto("/");
  await p.evaluate(
    ({ s, org, flows }) => {
      localStorage.setItem("qingbao-enterprise-v1", JSON.stringify(s));
      localStorage.setItem(
        "qingbao-configuration-v1",
        JSON.stringify({ org, flows }),
      );
    },
    { s, org, flows: published },
  );
  await p.reload();
  await role(p, "主管");
}
async function csv(p, selector) {
  const dl = p.waitForEvent("download");
  await p.locator(selector).click();
  return readFile(await (await dl).path(), "utf8");
}
const state = (p) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("qingbao-enterprise-v1")));

test("统一审批/消息直接办理对公全链路，已处理保留节点摘要与日期导出", async ({
  page: p,
}) => {
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await setup(p);
  await nav(p, "审批中心");
  await p.locator("#actor").selectOption("manager-zhao");
  await expect(p.locator("[data-corporate]")).toHaveCount(0);
  await p.locator("#actor").selectOption("head-xu");
  for (const r of ["主管", "财务", "总账", "付款"]) {
    await role(p, r);
    const messageRoute = ["财务", "付款"].includes(r);
    if (messageRoute) {
      await nav(p, "消息中心");
      await p.locator("#message-kind").selectOption("corporate");
      await expect(p.locator(".message-card")).toHaveCount(1);
      await p.locator("[data-message-open]").click();
    } else {
      await nav(p, "审批中心");
      await p.locator('[data-inbox-view="pending"]').click();
      await corporate(p);
      expect(await csv(p, "#inbox-export")).toContain("对公支付");
      await p.locator("[data-corporate]").click();
    }
    await expect(p.locator("main h1")).toHaveText(
      messageRoute ? "消息中心" : "审批中心",
    );
    await expect(p.locator("#overlay")).toContainText("统一工作台对公单");
    await form(p).locator("[name=note]").fill("核对虚构付款依据");
    if (r === "总账") {
      await form(p).locator("[name=account]").fill("6602服务费");
      await form(p).locator("[name=costCenter]").fill("销售部 / 项目A");
    }
    if (r === "付款") {
      await form(p).locator("[name=reference]").fill("DEMO-WORKBENCH-PAY");
      await form(p).locator("[name=confirmed]").check();
    }
    await submit(p);
    await nav(p, "审批中心");
    await p.locator('[data-inbox-view="processed"]').click();
    await corporate(p);
    await expect(rows(p)).toHaveCount(1);
    await expect(rows(p)).toContainText("对公支付");
    await p.locator('[data-date-preset="today"]').click();
    const output = await csv(p, "#processed-export");
    expect(output).toContain("对公支付");
    if (r === "总账") expect(output).toContain("6602服务费");
    if (r === "付款") {
      expect(output).toContain("DEMO-WORKBENCH-PAY");
      await expect(rows(p)).toContainText("付款登记");
    }
    await p.locator("[data-corporate]").click();
    await expect(form(p)).toHaveCount(0);
    await p.locator("[data-close]").click();
  }
  const s = await state(p);
  expect(s.payments[0].status).toBe("已付款");
  expect(s.payments[0].history.filter((h) => h.operation)).toHaveLength(4);
  await role(p, "员工");
  await nav(p, "消息中心");
  await p.locator("#message-kind").selectOption("corporate");
  await expect(p.locator(".message-card")).toContainText("已完成模拟付款登记");
  await expect(p.locator(".message-card")).toContainText("不代表银行到账");
  expect(errors).toEqual([]);
});

test("对公已读不改业务、消息退回重提产生新未读，已处理及已读备份往返", async ({
  page: p,
}) => {
  await setup(p);
  await nav(p, "消息中心");
  await p.locator("#message-kind").selectOption("corporate");
  const before = await state(p);
  await p.locator("[data-message-read]").click();
  expect(await state(p)).toEqual(before);
  await expect(p.locator(".message-card")).toContainText("已读");
  await p.locator("[data-message-open]").click();
  await form(p).locator("[name=note]").fill("补充验收材料");
  await form(p).locator("[name=action]").selectOption("reject");
  await submit(p);
  await role(p, "员工");
  await p.locator("#message-kind").selectOption("corporate");
  await expect(p.locator(".message-card")).toContainText("补充验收材料");
  await p.locator("[data-message-open]").click();
  await p.locator("#corporate-edit").click();
  await form(p).locator("[name=name]").fill("对公重提事项");
  await form(p).locator("[name=amount]").fill("200");
  await submit(p);
  await role(p, "主管");
  await p.locator("#message-kind").selectOption("corporate");
  await expect(p.locator(".message-card")).toContainText("未读");
  await expect(p.locator(".message-card")).toContainText("对公重提事项");
  await p.locator("[data-message-open]").click();
  await form(p).locator("[name=note]").fill("补齐已核对");
  await submit(p);
  await nav(p, "审批中心");
  await p.locator('[data-inbox-view="processed"]').click();
  await corporate(p);
  await expect(rows(p)).toHaveCount(2);
  await expect(rows(p).filter({ hasText: "退回/驳回" })).toContainText(
    "100.00",
  );
  await expect(rows(p).filter({ hasText: "通过" })).toContainText("200.00");
  await nav(p, "数据管理");
  const backup = JSON.parse(await csv(p, "#backup"));
  const bad = structuredClone(backup);
  bad.enterprise.payments[0].history.at(-1).operation.kind = "expense";
  const original = await state(p);
  await p.locator("#restore").setInputFiles({
    name: "坏操作.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(p.locator(".toast")).toContainText("具名");
  expect(await state(p)).toEqual(original);
  await p.evaluate(() => {
    localStorage.removeItem("qingbao-enterprise-v1");
    localStorage.removeItem("qingbao-message-read-v1");
  });
  await p.reload();
  await nav(p, "数据管理");
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "工作台备份.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  await role(p, "主管");
  await nav(p, "审批中心");
  await p.locator('[data-inbox-view="processed"]').click();
  await corporate(p);
  await expect(rows(p)).toHaveCount(2);
  expect(
    await p.evaluate(() =>
      JSON.parse(localStorage.getItem("qingbao-message-read-v1")),
    ),
  ).toEqual(backup.messageRead);
});

test("对公待办分页全筛选导出、类型筛选与跨页已读，手机无横向溢出", async ({
  page: p,
}) => {
  await p.setViewportSize({ width: 390, height: 844 });
  await setup(p, seed(25));
  await nav(p, "审批中心");
  await corporate(p);
  await expect(rows(p)).toHaveCount(20);
  await expect(p.locator("[data-inbox-count=corporate]")).toHaveText("25");
  const output = await csv(p, "#inbox-export");
  expect(output.trim().split("\r\n")).toHaveLength(26);
  await p.locator('[data-inbox-page="1"]').click();
  await expect(rows(p)).toHaveCount(5);
  await p.locator("#inbox-search").fill("对公批次24");
  await expect(rows(p)).toHaveCount(1);
  await expect(rows(p)).toContainText("对公批次24");
  await expect(p.locator("[data-inbox-page]")).toHaveCount(0);
  await nav(p, "消息中心");
  await p.locator("#message-kind").selectOption("corporate");
  await expect(p.locator(".message-card")).toHaveCount(20);
  await p.locator("#message-read-filtered").click();
  const read = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("qingbao-message-read-v1")),
  );
  expect(read.byActor["head-xu"]).toHaveLength(25);
  expect(
    read.byActor["head-xu"].every((k) => JSON.parse(k)[0] === "corporate"),
  ).toBe(true);
  await p.locator('[data-message-page="1"]').click();
  await expect(p.locator(".message-card")).toHaveCount(5);
  await expect(p.locator("[data-message-read]")).toHaveCount(0);
  await p.locator("#message-unread").selectOption("unread");
  await expect(p.locator(".message-card")).toHaveCount(0);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("已读及业务写入失败保留原值可重试，对公损坏明确不完整并禁止假完整导出", async ({
  page: p,
}) => {
  await setup(p);
  await nav(p, "消息中心");
  await p.locator("#message-kind").selectOption("corporate");
  const before = await state(p);
  await p.evaluate(() => {
    window.realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (["qingbao-message-read-v1", "qingbao-enterprise-v1"].includes(k))
        throw Error("quota");
      return window.realSet.call(this, k, v);
    };
  });
  await p.locator("[data-message-open]").click();
  await expect(p.locator(".toast")).toContainText("已读保存失败");
  await expect(form(p)).toBeVisible();
  await form(p).locator("[name=note]").fill("保留表单重试");
  await submit(p);
  await expect(p.locator("#enterprise-error")).toContainText("原数据未改动");
  expect(await state(p)).toEqual(before);
  await p.evaluate(() => (Storage.prototype.setItem = window.realSet));
  await submit(p);
  expect(
    (await state(p)).payments[0].history.filter((h) => h.operation),
  ).toHaveLength(1);
  await p.evaluate(() =>
    localStorage.setItem("qingbao-enterprise-v1", "{broken"),
  );
  await p.reload();
  await nav(p, "审批中心");
  await expect(p.locator("[role=alert]")).toContainText("对公业务存储无法读取");
  await expect(p.locator('aside [data-page="审批中心"] em')).toHaveText("?");
  await p.locator("#inbox-export").click();
  await expect(p.locator(".toast")).toContainText("不能导出完整统一待办");
  await p.locator('[data-inbox-view="processed"]').click();
  await p.locator("#processed-export").click();
  await expect(p.locator(".toast")).toContainText("不能导出完整处理记录");
  await nav(p, "消息中心");
  await expect(p.locator("[role=alert]")).toContainText("不含对公消息");
  await expect(p.locator('aside [data-page="消息中心"] em')).toHaveText("?");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-enterprise-v1")),
  ).toBe("{broken");
  // A different broken collection must not hide still-readable corporate work.
  await p.evaluate((s) => {
    localStorage.setItem("qingbao-enterprise-v1", JSON.stringify(s));
    localStorage.setItem("qingbao-requests-v1", "{broken-request");
  }, seed());
  await p.reload();
  await role(p, "主管");
  await nav(p, "审批中心");
  await corporate(p);
  await expect(p.locator("[data-corporate]")).toHaveCount(1);
  await expect(p.locator("[role=alert]")).toContainText("不是完整待办总数");
});

test("重提后改审批路径，原处理人从已处理只读回看，新人员才有待办", async ({
  page: p,
}) => {
  let s = seed();
  s = actCorporate(s, s.payments[0].id, who("head-xu"), "reject", {
    note: "补全付款说明",
  });
  const published = structuredClone(flows);
  published.version++;
  published.expense.low = [{ selector: "person", personId: "manager-zhao" }];
  s = submitCorporate(
    s,
    {
      contractId: s.contracts[0].id,
      name: "新路径对公单",
      amount: 200,
      date: "2026-10-24",
      note: "虚构修订",
    },
    who("lin"),
    org,
    published,
    s.payments[0].id,
  );
  await setup(p, s, published);
  await nav(p, "审批中心");
  await p.locator('[data-inbox-view="pending"]').click();
  await corporate(p);
  await expect(p.locator("[data-corporate]")).toHaveCount(0);
  await p.locator('[data-inbox-view="processed"]').click();
  await corporate(p);
  await expect(rows(p)).toContainText("统一工作台对公单");
  await p.locator("[data-corporate]").click();
  await expect(p.locator("#overlay")).toContainText("新路径对公单");
  await expect(form(p)).toHaveCount(0);
  await p.locator("[data-close]").click();
  await p.locator("#actor").selectOption("manager-zhao");
  await p.locator('[data-inbox-view="pending"]').click();
  await corporate(p);
  await expect(p.locator("[data-corporate]")).toHaveCount(1);
  await p.locator("[data-corporate]").click();
  await expect(form(p)).toBeVisible();
});
