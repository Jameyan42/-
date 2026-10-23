import { test, expect } from "@playwright/test";
import { enterpriseOrg } from "../src/organization.js";
import { financeDivisionFlows, defaultFlows } from "../src/approval.js";
import {
  emptyEnterprise,
  saveSupplier,
  saveContract,
  reviewContract,
  submitCorporate,
  actCorporate,
} from "../src/enterprise.js";
import { demoContractText } from "../src/contract-review.js";
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
async function config(p, id, { effect, threshold, enabled = true } = {}) {
  await p.locator("#role").selectOption("财务");
  await nav(p, "规则配置");
  const rule = p.locator(`[data-rule-id="${id}"]`);
  await rule.locator(`[name="pc-${id}-enabled"]`).setChecked(enabled);
  if (effect) await rule.locator("select").selectOption(effect);
  if (threshold !== undefined)
    await rule.locator("[type=number]").fill(String(threshold));
  await p.locator("[name=reason]").fill("虚构规则预审演示调整");
  await p.locator("#policy-form [type=submit]").click();
}
const org = enterpriseOrg(),
  flows = financeDivisionFlows(defaultFlows(), org),
  who = (id) => org.people.find((p) => p.id === id);
function corporate() {
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "远帆服务有限公司（虚构）",
      creditCode: "DEMO-CHECK",
      accountName: "远帆服务有限公司（虚构）",
      bankName: "虚构银行",
      bankAccount: "DEMO-CHECK-001",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "虚构服务合同",
      number: "HT-PRECHECK",
      amount: 10000,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      supplierId: s.suppliers[0].id,
      text: demoContractText,
    },
    who("lin"),
    org,
  );
  s = reviewContract(s, s.contracts[0].id, who("finance-zhou"), {
    approve: true,
    confirmed: true,
    note: "人工核对通过",
  });
  s = submitCorporate(
    s,
    {
      name: "规则预审对公单",
      contractId: s.contracts[0].id,
      amount: 4000,
      date: "2026-10-24",
      note: "虚构业务",
    },
    who("lin"),
    org,
    flows,
  );
  return actCorporate(s, s.payments[0].id, who("head-xu"), "approve");
}
async function corporateSetup(p, s = corporate()) {
  await p.goto("/");
  await p.evaluate(
    ({ s, org, flows }) => {
      localStorage.setItem("qingbao-enterprise-v1", JSON.stringify(s));
      localStorage.setItem(
        "qingbao-configuration-v1",
        JSON.stringify({ org, flows }),
      );
    },
    { s, org, flows },
  );
  await p.reload();
  await p.locator("#role").selectOption("财务");
}
test("报销风险展示依据和建议，规则可提醒或拦截，处理保存版本快照", async ({
  page: p,
}) => {
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("/");
  await p.locator("#role").selectOption("财务");
  await row(p, "办公耗材采购").locator("[data-detail]").click();
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "未留存发票原文件",
  );
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "仅记录旧票据名称",
  );
  await p.locator("[data-close]").click();
  await config(p, "expense-file", { effect: "block" });
  await nav(p, "报销管理");
  await row(p, "办公耗材采购").locator("[data-detail]").click();
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.locator("#payment-reference").fill("DEMO-CHECK-PAY");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("预审风险");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await p.locator("[data-close]").click();
  await config(p, "expense-file", { effect: "warn" });
  await nav(p, "报销管理");
  await row(p, "办公耗材采购").locator("[data-detail]").click();
  await p.locator("#payment-reference").fill("DEMO-CHECK-PAY");
  await p.locator("#payment-confirm").check();
  await p.locator("#reason").fill("已在线下核对虚构票据，仅做演示");
  await p.locator("#approve").click();
  await expect(row(p, "办公耗材采购")).toContainText("已付款");
  const d = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("qingbao-v1")).find(
      (x) => x.id === "BX202610003",
    ),
  );
  expect(d.history.at(-1).precheck.policy.precheck.version).toBe(3);
  expect(
    d.history
      .at(-1)
      .precheck.findings.some(
        (f) => f.id === "expense-file" && f.effect === "warn",
      ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("对公大额拦截和账户变更提醒，后续修改配置不改处理时结果", async ({
  page: p,
}) => {
  await corporateSetup(p);
  await config(p, "corporate-amount", { effect: "block", threshold: 2000 });
  await nav(p, "对公支付单");
  await expect(p.locator("tbody")).toContainText("1 项拦截");
  await p.locator("[data-enterprise-open]").click();
  await p.locator("#enterprise-form [type=submit]").click();
  await expect(p.locator("#enterprise-error")).toContainText("金额");
  await p.locator("[data-close]").click();
  await config(p, "corporate-amount", { effect: "warn", threshold: 2000 });
  await nav(p, "对公支付单");
  await p.locator("[data-enterprise-open]").click();
  await p.locator("#enterprise-form [name=note]").fill("核对合同分期付款依据");
  await p.locator("#enterprise-form [type=submit]").click();
  const saved = await p.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("qingbao-enterprise-v1"),
      ).payments[0].history.at(-1).precheck,
  );
  expect(saved.findings.some((f) => f.id === "corporate-amount")).toBe(true);
  await config(p, "corporate-amount", { effect: "warn", threshold: 9000 });
  await p.locator("#role").selectOption("总账");
  await nav(p, "对公支付单");
  await p.locator("[data-enterprise-open]").click();
  await expect(p.locator(".precheck-panel").first()).not.toContainText(
    "对公单笔金额超过配置阈值",
  );
  await p.locator(".precheck-history > summary").click();
  await p
    .locator(".precheck-history > details")
    .first()
    .locator(":scope > summary")
    .click();
  await expect(p.locator(".precheck-history")).toContainText("阈值 2000");
  expect(
    await p.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("qingbao-enterprise-v1"),
        ).payments[0].history.at(-1).precheck,
    ),
  ).toEqual(saved);
});
test("规则只读权限、写入失败保持原规则和表单、配置随备份恢复", async ({
  page: p,
}) => {
  await p.goto("/");
  await nav(p, "规则配置");
  await expect(p.locator('[name="pc-corporate-amount-effect"]')).toBeDisabled();
  await p.locator("#role").selectOption("财务");
  await p.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-policy")
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, k, v);
    };
  });
  await p.locator('[name="pc-corporate-amount-threshold"]').fill("1500");
  await p.locator("[name=reason]").fill("模拟容量不足");
  await p.locator("#policy-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("原规则未改动");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-policy")),
  ).toBeNull();
  await expect(p.locator('[name="pc-corporate-amount-threshold"]')).toHaveValue(
    "1500",
  );
  await p.reload();
  await config(p, "corporate-amount", { effect: "block", threshold: 1500 });
  await nav(p, "数据管理");
  const wait = p.waitForEvent("download");
  await p.locator("#backup").click();
  const fs = await import("node:fs/promises");
  const backup = JSON.parse(
    await fs.readFile(await (await wait).path(), "utf8"),
  );
  expect(
    backup.policy.precheck.rules.find((r) => r.id === "corporate-amount")
      .threshold,
  ).toBe(1500);
  await p.evaluate(() => localStorage.removeItem("qingbao-policy"));
  await p.reload();
  await nav(p, "数据管理");
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "rules.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(p.locator(".toast")).toContainText("已恢复");
  await p.locator("#role").selectOption("财务");
  await nav(p, "规则配置");
  await expect(p.locator('[name="pc-corporate-amount-threshold"]')).toHaveValue(
    "1500",
  );
  await expect(p.locator('[name="pc-corporate-amount-effect"]')).toHaveValue(
    "block",
  );
});
test("损坏规则保留原值并暂停财务通过，仍可退回，不生成假完整备份", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.evaluate(() => localStorage.setItem("qingbao-policy", "{bad-policy"));
  await p.reload();
  await p.locator("#role").selectOption("财务");
  await row(p, "产品共创工作坊").locator("[data-detail]").click();
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "规则存储异常",
  );
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("规则存储异常");
  await p.locator("#reason").fill("先核对原始制度再处理");
  await p.locator("#reject").click();
  await expect(row(p, "产品共创工作坊")).toContainText("已退回");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-policy"))).toBe(
    "{bad-policy",
  );
  await nav(p, "数据管理");
  await p.locator("#backup").click();
  await expect(p.locator(".toast")).toContainText("不能生成完整备份");
});
test("疑似重复与收款档案变更证据、风险文本转义，390px规则和详情布局", async ({
  page: p,
}) => {
  const s = corporate();
  s.suppliers[0].bankAccount = "DEMO-NEW-ACCOUNT";
  s.payments[0].name = "<img src=x onerror=alert(1)>风险单";
  s.payments.push({
    ...structuredClone(s.payments[0]),
    id: "DG-DUPLICATE",
    history: [],
  });
  await corporateSetup(p, s);
  await nav(p, "对公支付单");
  await p.locator("[data-enterprise-open]").first().click();
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "供应商当前档案与本单收款快照不一致",
  );
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "DEMO-NEW-ACCOUNT",
  );
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "同合同同期望日同金额",
  );
  await expect(p.locator(".modal img")).toHaveCount(0);
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.locator("[data-close]").click();
  await nav(p, "规则配置");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
