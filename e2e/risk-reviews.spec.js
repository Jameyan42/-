import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { enterpriseOrg } from "../src/organization.js";
import { financeDivisionFlows, defaultFlows } from "../src/approval.js";
import {
  emptyEnterprise,
  saveSupplier,
  saveContract,
  reviewContract,
  submitCorporate,
} from "../src/enterprise.js";
import { defaultPrecheck, basePolicy } from "../src/precheck.js";
import { demoContractText } from "../src/contract-review.js";
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
const panel = (p) => p.locator(".risk-review-panel");
const state = (p) => panel(p).locator("[data-risk-state]");
async function record(
  p,
  {
    rule = "legacy-receipt",
    decision = "已核对",
    note = "已查看虚构证明，仍需补充发票原文件",
    evidence,
  } = {},
) {
  await expect(panel(p).locator("[data-risk-save]")).toBeVisible();
  await p.locator("[data-risk-rule]").selectOption(rule);
  await p.locator("[data-risk-decision]").selectOption(decision);
  await p.locator("[data-risk-note]").fill(note);
  if (evidence) await p.locator("[data-risk-evidence]").selectOption(evidence);
  await p.locator("[data-risk-save]").click();
  await expect(state(p)).toContainText("已保存一条");
}
const pdf = {
  name: "虚构住宿证明.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\nfictional evidence\n%%EOF"),
};
async function expense(p, name = "报销风险核对") {
  await p.goto("/");
  await p.locator("#role").selectOption("员工");
  await p.locator("#create").click();
  await p.locator("[name=name]").fill(name);
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=invoice]").fill("12345678901234567890");
  await p.locator("[name=note]").fill("虚构费用用途");
  await p.locator("#attachments-upload").setInputFiles(pdf);
  await expect(p.locator("#attachments-status")).toContainText("已添加");
  await p.locator("#expense-form [type=submit]").click();
  await p.locator("#role").selectOption("主管");
  await nav(p, "报销管理");
  await row(p, name).locator("[data-detail]").click();
  await expect(p.locator("[data-risk-save]")).toBeVisible();
}
const expenseRaw = (p) => p.evaluate(() => localStorage.getItem("qingbao-v1"));
async function download(p, selector) {
  const wait = p.waitForEvent("download");
  await p.locator(selector).click();
  return readFile(await (await wait).path(), "utf8");
}

test("报销逐项核对、材料关联及CSV，后续节点可读但已核对不豁免拦截", async ({
  page: p,
}) => {
  await expense(p);
  const before = JSON.parse(await expenseRaw(p)).find(
    (d) => d.name === "报销风险核对",
  );
  await record(p, {
    evidence: before.attachments[0].id,
    note: "=HYPERLINK(虚构内容仅作为核对说明)",
  });
  const after = JSON.parse(await expenseRaw(p)).find((d) => d.id === before.id);
  expect(after.status).toBe(before.status);
  expect(after.approval).toEqual(before.approval);
  expect(after.history).toEqual(before.history);
  expect(after.riskReviews).toHaveLength(1);
  await expect(panel(p).locator("[data-risk-current]")).toContainText(
    "当前依据一致",
  );
  const csv = await download(p, "[data-risk-export]");
  expect(csv).toContain("虚构住宿证明.pdf");
  expect(csv).toContain("'=HYPERLINK");
  await p.locator("#approve").click();
  await p.locator("#role").selectOption("财务");
  await row(p, "报销风险核对").locator("[data-detail]").click();
  await expect(panel(p).locator("[data-risk-current]")).toContainText("赵航");
  await record(p, { note: "财务已核对现有证明，原始发票仍未提供" });
  const raw = await expenseRaw(p);
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("缺少票据");
  expect(await expenseRaw(p)).toBe(raw);
  await p.locator("#reason").fill("请提供发票原文件后重提");
  await p.locator("#reject").click();
  await p.locator("#role").selectOption("员工");
  await row(p, "报销风险核对").locator("[data-detail]").click();
  await expect(panel(p).locator("[data-risk-save]")).toHaveCount(0);
  await p.locator(".risk-review-history summary").first().click();
  await expect(p.locator(".risk-review-record")).toHaveCount(2);
});

test("报销重提和规则版本变化使核对失效，旧记录保留且可重新核对", async ({
  page: p,
}) => {
  await expense(p, "重提风险核对");
  await record(p, { rule: "expense-file", decision: "待补充" });
  await p.locator("#reason").fill("补充原文件并核对金额");
  await p.locator("#reject").click();
  await p.locator("#role").selectOption("员工");
  await row(p, "重提风险核对").locator("[data-detail]").click();
  await p.locator("#edit").click();
  await p.locator("[name=amount]").fill("201");
  await p.locator("#expense-form [type=submit]").click();
  await p.locator("#role").selectOption("主管");
  await row(p, "重提风险核对").locator("[data-detail]").click();
  await expect(panel(p).locator("[data-risk-current]")).toContainText(
    "需重新核对",
  );
  await record(p, {
    rule: "expense-file",
    note: "已重新核对201元申请，原件仍待补充",
  });
  await expect(panel(p).locator("[data-risk-current]")).toContainText(
    "当前依据一致",
  );
  await p.locator("[data-close]").click();
  await p.locator("#role").selectOption("财务");
  await nav(p, "规则配置");
  await p.locator('[name="pc-expense-age-threshold"]').fill("91");
  await p.locator("[name=reason]").fill("虚构制度版本更新");
  await p.locator("#policy-form [type=submit]").click();
  await p.locator("#role").selectOption("主管");
  await nav(p, "报销管理");
  await row(p, "重提风险核对").locator("[data-detail]").click();
  await expect(panel(p).locator("[data-risk-current]")).toContainText(
    "需重新核对",
  );
  await p.locator(".risk-review-history summary").first().click();
  await expect(p.locator(".risk-review-record")).toHaveCount(2);
});

function corporateSeed() {
  const org = enterpriseOrg(),
    who = (id) => org.people.find((p) => p.id === id),
    flows = financeDivisionFlows(defaultFlows(), org);
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "远帆服务有限公司（虚构）",
      accountName: "远帆服务有限公司（虚构）",
      creditCode: "DEMO-RISK",
      bankName: "演示银行",
      bankAccount: "DEMO-RISK-001",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "核对演示",
      number: "HT-RISK",
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
    note: "人工核对虚构合同",
  });
  s = submitCorporate(
    s,
    {
      contractId: s.contracts[0].id,
      name: "对公风险核对",
      amount: 100,
      date: "2026-10-24",
      note: "虚构用途",
    },
    who("lin"),
    org,
    flows,
  );
  const policy = { ...basePolicy, precheck: defaultPrecheck() };
  const r = policy.precheck.rules.find((r) => r.id === "corporate-amount");
  r.threshold = 50;
  r.effect = "block";
  return { s, org, flows, policy };
}
test("统一入口对公核对与拦截保持，核对快照备份恢复及坏记录拒绝", async ({
  page: p,
}) => {
  const seed = corporateSeed();
  await p.goto("/");
  await p.evaluate(({ s, org, flows, policy }) => {
    localStorage.setItem("qingbao-enterprise-v1", JSON.stringify(s));
    localStorage.setItem(
      "qingbao-configuration-v1",
      JSON.stringify({ org, flows }),
    );
    localStorage.setItem("qingbao-policy", JSON.stringify(policy));
  }, seed);
  await p.reload();
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("head-xu");
  await nav(p, "审批中心");
  await p.locator('[data-inbox-kind="corporate"]').click();
  await p.locator("[data-corporate]").click();
  await record(p, {
    rule: "corporate-amount",
    note: "业务核对100元用途，需财务核对付款依据",
  });
  await p.locator("#enterprise-form [name=note]").fill("业务用途通过");
  await p.locator("#enterprise-form [type=submit]").click();
  await p.locator("#role").selectOption("财务");
  await nav(p, "消息中心");
  await p.locator("#message-kind").selectOption("corporate");
  await p.locator("[data-message-open]").click();
  await expect(panel(p).locator("[data-risk-current]")).toContainText("许明");
  await record(p, {
    rule: "corporate-amount",
    note: "已核对合同与付款金额，但阈值拦截仍需处理",
  });
  const before = await p.evaluate(() =>
    localStorage.getItem("qingbao-enterprise-v1"),
  );
  await p.locator("#enterprise-form [type=submit]").click();
  await expect(p.locator("#enterprise-error")).toContainText("不能通过");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-enterprise-v1")),
  ).toBe(before);
  await p.locator("#enterprise-form [name=note]").fill("退回确认付款依据");
  await p.locator("#enterprise-form [name=action]").selectOption("reject");
  await p.locator("#enterprise-form [type=submit]").click();
  await nav(p, "数据管理");
  const b = JSON.parse(await download(p, "#backup"));
  expect(b.enterprise.payments[0].riskReviews).toHaveLength(2);
  const bad = structuredClone(b);
  bad.enterprise.payments[0].riskReviews[0].report.docId = "other";
  await p.locator("#restore").setInputFiles({
    name: "坏核对.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(p.locator(".toast")).toContainText("快照");
  await p.evaluate(() => localStorage.removeItem("qingbao-enterprise-v1"));
  await p.reload();
  await nav(p, "数据管理");
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "风险核对备份.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  await p.locator("#role").selectOption("员工");
  await nav(p, "对公支付单");
  await p.locator("[data-enterprise-open]").click();
  await expect(p.locator("[data-risk-save]")).toHaveCount(0);
  await p.locator(".risk-review-history summary").first().click();
  await expect(p.locator(".risk-review-record")).toHaveCount(2);
});

test("未保存核对保护、写入失败保留表单与原值可重试，手机说明转义", async ({
  page: p,
}) => {
  await p.setViewportSize({ width: 390, height: 844 });
  await expense(p, "手机核对保护");
  await p
    .locator("[data-risk-note]")
    .fill("<img src=x onerror=alert(1)>核对示例");
  p.once("dialog", (d) => d.dismiss());
  await p.locator("[data-close]").click();
  await expect(panel(p)).toBeVisible();
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("请先保存风险核对");
  const before = await expenseRaw(p);
  await p.evaluate(() => {
    window.realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-v1") throw Error("quota");
      return window.realSet.call(this, k, v);
    };
  });
  await p.locator("[data-risk-save]").click();
  await expect(state(p)).toContainText("原报销未改动");
  expect(await expenseRaw(p)).toBe(before);
  await expect(p.locator("[data-risk-note]")).toHaveValue(/核对示例/);
  await p.evaluate(() => (Storage.prototype.setItem = window.realSet));
  await p.locator("[data-risk-save]").click();
  await expect(state(p)).toContainText("已保存一条");
  await expect(panel(p).locator("[data-risk-current]")).toContainText("<img");
  await expect(panel(p).locator("img")).toHaveCount(0);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p
    .locator("[data-risk-note]")
    .fill("这条说明尚未保存，不应影响前条记录");
  await p.locator("[data-risk-clear]").click();
  await expect(state(p)).toContainText("已保存核对记录保留");
  await p.locator("#approve").click();
  const d = JSON.parse(await expenseRaw(p)).find(
    (d) => d.name === "手机核对保护",
  );
  expect(d.riskReviews).toHaveLength(1);
  expect(d.status).toBe("待财务审核");
});

test("坏核对记录保留原值，暂停追加且审批保存失败不覆盖", async ({
  page: p,
}) => {
  await expense(p, "坏核对数据");
  await p.locator("[data-close]").click();
  await p.evaluate(() => {
    const docs = JSON.parse(localStorage.getItem("qingbao-v1"));
    docs.find((d) => d.name === "坏核对数据").riskReviews = [
      { schema: 1, id: "bad" },
    ];
    localStorage.setItem("qingbao-v1", JSON.stringify(docs));
  });
  await p.reload();
  await p.locator("#role").selectOption("主管");
  await nav(p, "报销管理");
  await row(p, "坏核对数据").locator("[data-detail]").click();
  await expect(state(p)).toContainText("原始数据未改动");
  await expect(p.locator("[data-risk-save]")).toHaveCount(0);
  const before = await expenseRaw(p);
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("风险核对记录");
  expect(await expenseRaw(p)).toBe(before);
});
