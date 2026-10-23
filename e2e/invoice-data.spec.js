import { test, expect } from "@playwright/test";
import { invoiceRecord } from "../src/invoice-data.js";
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
const field = (p, k) => p.locator(`[data-invoice-field="${k}"]`);
const values = (extra = {}) => ({
  number: "32345678901234567890",
  amount: "100.00",
  buyerName: "星河科技",
  buyerTaxId: "DEMO-BUYER-001",
  sellerName: "远帆服务有限公司",
  sellerTaxId: "DEMO-SELLER-001",
  date: "2026-10-24",
  netAmount: "90.00",
  taxAmount: "10.00",
  ...extra,
});
async function add(p, data) {
  for (const [k, v] of Object.entries(data)) await field(p, k).fill(v);
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
}
async function expense(p, name = "结构化报销") {
  await p.goto("/");
  await p.locator("#role").selectOption("员工");
  await p.locator("#create").click();
  await p.locator("[name=name]").fill(name);
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=note]").fill("虚构票面核对");
}
function setupCorporate() {
  const org = enterpriseOrg(),
    who = (id) => org.people.find((p) => p.id === id),
    flows = financeDivisionFlows(defaultFlows(), org);
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "远帆服务有限公司（虚构）",
      accountName: "远帆服务有限公司（虚构）",
      creditCode: "DEMO-STRUCT",
      bankName: "虚构银行",
      bankAccount: "DEMO-STRUCT-001",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "票面采集合同",
      number: "HT-STRUCT",
      amount: 10000,
      supplierId: s.suppliers[0].id,
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
    note: "人工核对通过",
  });
  return { s, org, flows };
}
test("真实本地OCR提取抬头日期与金额，确认后保存结构化字段而不覆盖申请金额", async ({
  page: p,
  context,
}) => {
  test.setTimeout(120000);
  const requests = [];
  context.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  await expense(p);
  await p.locator("#invoice-image-sample").click();
  await expect(field(p, "number")).toHaveValue("22345678901234567890", {
    timeout: 90000,
  });
  await expect(field(p, "buyerName")).toHaveValue("星河科技");
  await expect(field(p, "amount")).toHaveValue("265.00");
  await expect(field(p, "date")).toHaveValue("2026-10-24");
  await expect(
    p.locator("#invoice-data-records .invoice-data-card"),
  ).toHaveCount(0);
  await p.locator("#invoice-data-add").click();
  await expect(p.locator("#invoice-data-status")).toContainText("勾选确认");
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
  await expect(p.locator("#invoice-data-records")).toContainText("抬头一致");
  await expect(p.locator("[name=amount]")).toHaveValue("200");
  await p.locator("#expense-form [type=submit]").click();
  await p.locator("[data-detail]").first().click();
  await expect(p.locator(".invoice-data-details")).toContainText("265.00");
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "票面合计与申请金额不同",
  );
  const d = await p.evaluate(
    () => JSON.parse(localStorage.getItem("qingbao-v1"))[0],
  );
  expect(d.invoices.records[0].capture.method).toBe("ocr-assisted");
  expect(JSON.stringify(d)).not.toContain("DEMO ONLY");
  expect(JSON.stringify(d)).not.toContain("data:image");
  expect(
    requests
      .filter((r) => r.url.startsWith("http"))
      .every(
        (r) => new URL(r.url).hostname === "127.0.0.1" && r.method === "GET",
      ),
  ).toBe(true);
});
test("多票合计、字段编辑与候选未确认保护，台账及JSON/CSV显示票面金额", async ({
  page: p,
}) => {
  await expense(p);
  await field(p, "number").fill("32345678901234567890");
  await p.locator("#expense-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("票面候选");
  await add(p, values());
  await add(p, values({ number: "32345678901234567891" }));
  await expect(p.locator("#invoice-data-summary")).toContainText("200.00");
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "发票台账");
  await expect(p.locator(".invoice-structured-ledger tbody tr")).toHaveCount(2);
  await expect(p.locator(".invoice-structured-ledger")).toContainText(
    "星河科技",
  );
  const dl = p.waitForEvent("download");
  await p.locator("#structured-invoice-export").click();
  const fs = await import("node:fs/promises");
  const csv = await fs.readFile(await (await dl).path(), "utf8");
  expect(csv).toContain("票面价税合计");
  expect(csv.trim().split("\r\n")).toHaveLength(3);
  await p.locator("[data-structured-open]").first().click();
  await expect(p.locator(".invoice-data-card")).toHaveCount(2);
  const json = p.waitForEvent("download");
  await p.locator("[data-invoice-json]").click();
  const data = JSON.parse(await fs.readFile(await (await json).path(), "utf8"));
  expect(data.records).toHaveLength(2);
});
test("财务统一抬头税号、提醒改拦截，审核人看到差异与税额勾稽", async ({
  page: p,
}) => {
  await expense(p);
  await p.locator("[name=receipt]").setInputFiles({
    name: "虚构发票.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo"),
  });
  await add(p, values({ buyerName: "错误公司", netAmount: "80.00" }));
  await p.locator("#expense-form [type=submit]").click();
  await p.locator("#role").selectOption("主管");
  await p.locator("[data-detail]").first().click();
  await p.locator("#approve").click();
  await p.locator("#role").selectOption("财务");
  await nav(p, "规则配置");
  await p.locator("[name=invoiceBuyerTaxId]").fill("DEMO-BUYER-001");
  await p.locator('[name="pc-invoice-buyer-effect"]').selectOption("block");
  await p.locator("[name=reason]").fill("统一抬头及税号核对");
  await p.locator("#policy-form [type=submit]").click();
  await nav(p, "报销管理");
  await p.locator("[data-detail]").first().click();
  await expect(p.locator(".precheck-panel").first()).toContainText("错误公司");
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "DEMO-BUYER-001",
  );
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "不含税金额加税额",
  );
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("抬头");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
});
test("对公单结构化采集与台账跳转，备份包含字段及14条规则，旧备份兼容", async ({
  page: p,
}) => {
  const seed = setupCorporate();
  await p.goto("/");
  await p.evaluate(({ s, org, flows }) => {
    localStorage.setItem("qingbao-enterprise-v1", JSON.stringify(s));
    localStorage.setItem(
      "qingbao-configuration-v1",
      JSON.stringify({ org, flows }),
    );
  }, seed);
  await p.reload();
  await p.locator("#role").selectOption("财务");
  await nav(p, "规则配置");
  await p.locator("[name=invoiceBuyerTaxId]").fill("DEMO-BUYER-001");
  await p.locator("[name=reason]").fill("票面基准与规则迁移演示");
  await p.locator("#policy-form [type=submit]").click();
  await p.locator("#role").selectOption("员工");
  await nav(p, "对公支付单");
  await p.locator("#enterprise-create").click();
  await p
    .locator("[name=contractId]")
    .selectOption({ label: "HT-STRUCT · 票面采集合同" });
  await p.locator("#enterprise-form [name=name]").fill("结构化对公单");
  await p.locator("#enterprise-form [name=amount]").fill("100");
  await p.locator("#enterprise-form [name=note]").fill("虚构付款依据");
  await add(p, values());
  await p.locator("#enterprise-form [type=submit]").click();
  await nav(p, "发票台账");
  await expect(p.locator(".invoice-structured-ledger")).toContainText(
    "结构化对公单",
  );
  await p.locator("[data-structured-kind=corporate]").click();
  await expect(p.locator(".modal")).toContainText("结构化发票");
  await p.locator("[data-close]").click();
  await nav(p, "数据管理");
  const dl = p.waitForEvent("download");
  await p.locator("#backup").click();
  const fs = await import("node:fs/promises");
  const backup = JSON.parse(await fs.readFile(await (await dl).path(), "utf8"));
  expect(backup.policy.precheck.rules).toHaveLength(14);
  expect(backup.policy.invoiceBuyer.taxId).toBe("DEMO-BUYER-001");
  expect(backup.enterprise.payments[0].invoices.records[0].buyerName).toBe(
    "星河科技",
  );
  await p.evaluate(() => localStorage.removeItem("qingbao-enterprise-v1"));
  await p.reload();
  await nav(p, "数据管理");
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "票面结构化备份.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(p.locator(".toast")).toContainText("已恢复");
  await p.locator("#role").selectOption("员工");
  await nav(p, "发票台账");
  await expect(p.locator(".invoice-structured-ledger")).toContainText(
    "结构化对公单",
  );
});
test("采集数量与坏字段保护、手机界面转义及保存失败不丢清单", async ({
  page: p,
}) => {
  await expense(p);
  await add(
    p,
    values({ buyerName: "<img src=x onerror=alert(1)>", taxAmount: "-1" }),
  );
  await expect(p.locator("#invoice-data-status")).toContainText("字段无效");
  await field(p, "taxAmount").fill("10");
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
  await expect(p.locator("#invoice-data-records img")).toHaveCount(0);
  for (let i = 1; i < 5; i++)
    await add(p, values({ number: "4234567890123456789" + i }));
  await add(p, values({ number: "52345678901234567890" }));
  await expect(p.locator("#invoice-data-status")).toContainText("最多");
  await p.locator("#invoice-data-clear").click();
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.evaluate(() => {
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-v1")
        throw new DOMException("quota", "QuotaExceededError");
      return save.call(this, k, v);
    };
  });
  await p.locator("#draft").click();
  await expect(p.locator(".toast")).toContainText("原报销未改动");
  await expect(
    p.locator("#invoice-data-records .invoice-data-card"),
  ).toHaveCount(5);
});

test("票号跨报销及对公查重，两个审核详情均显示关联，配置拦截有效", async ({
  page: p,
}) => {
  const seed = setupCorporate(),
    who = (id) => seed.org.people.find((p) => p.id === id);
  seed.s = submitCorporate(
    seed.s,
    {
      name: "已有对公票据",
      contractId: seed.s.contracts[0].id,
      amount: 100,
      date: "2026-10-24",
      note: "虚构付款",
      invoices: { schema: 1, records: [invoiceRecord(values())] },
    },
    who("lin"),
    seed.org,
    seed.flows,
  );
  seed.s = actCorporate(
    seed.s,
    seed.s.payments[0].id,
    who("head-xu"),
    "approve",
  );
  await p.goto("/");
  await p.evaluate(({ s, org, flows }) => {
    localStorage.setItem("qingbao-enterprise-v1", JSON.stringify(s));
    localStorage.setItem(
      "qingbao-configuration-v1",
      JSON.stringify({ org, flows }),
    );
  }, seed);
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await p.locator("#create").click();
  await p.locator("[name=name]").fill("同票号报销");
  await p.locator("[name=amount]").fill("100");
  await p.locator("[name=note]").fill("虚构重复票据");
  await p.locator("[name=receipt]").setInputFiles({
    name: "虚构.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo"),
  });
  await add(p, values());
  await p.locator("#expense-form [type=submit]").click();
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("head-xu");
  await p
    .locator("tbody tr")
    .filter({ hasText: "同票号报销" })
    .locator("[data-detail]")
    .click();
  await p.locator("#approve").click();
  await p.locator("#role").selectOption("财务");
  await nav(p, "规则配置");
  await p.locator('[name="pc-invoice-duplicate-effect"]').selectOption("block");
  await p.locator("[name=reason]").fill("跨业务重复检查");
  await p.locator("#policy-form [type=submit]").click();
  await nav(p, "报销管理");
  await p
    .locator("tbody tr")
    .filter({ hasText: "同票号报销" })
    .locator("[data-detail]")
    .click();
  await expect(p.locator(".precheck-panel").first()).toContainText("对公 DG");
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("重复线索");
  await p.locator("[data-close]").click();
  await nav(p, "对公支付单");
  await p.locator("[data-enterprise-open]").click();
  await expect(p.locator(".precheck-panel").first()).toContainText("报销 BX");
});

test("关联留存原件真实OCR、审核下载字节及引用备份恢复保护", async ({
  page: p,
  context,
}) => {
  test.setTimeout(120000);
  const fs = await import("node:fs/promises"),
    bytes = await fs.readFile("public/samples/structured-invoice.png");
  const external = [];
  context.on("request", (r) => {
    if (r.url().startsWith("http") && new URL(r.url()).hostname !== "127.0.0.1")
      external.push(r.url());
  });
  await expense(p, "原件关联OCR");
  await p.locator("#attachment-kind").selectOption("发票");
  await p.locator("#attachments-upload").setInputFiles({
    name: "虚构原件.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(p.locator("#attachments-status")).toContainText("已添加");
  await p
    .locator("#invoice-attachment")
    .selectOption({ label: "虚构原件.png" });
  await p.locator("#invoice-attachment-read").click();
  await expect(field(p, "number")).toHaveValue("22345678901234567890", {
    timeout: 90000,
  });
  await expect(p.locator("#invoice-attachment option:checked")).toHaveText(
    "虚构原件.png",
  );
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
  await p.locator("[data-attachment-remove]").click();
  await expect(p.locator("#attachments-status")).toContainText(
    "先编辑票面解除关联",
  );
  await p.locator("[data-attachment-kind]").selectOption("其他材料");
  await expect(p.locator("[data-attachment-kind]")).toHaveValue("发票");
  await p.locator("#expense-form [type=submit]").click();
  await p.reload();
  await p.locator("#role").selectOption("主管");
  await nav(p, "报销管理");
  await p
    .locator("tbody tr")
    .filter({ hasText: "原件关联OCR" })
    .locator("[data-detail]")
    .click();
  await p.locator(".invoice-original details summary").click();
  await expect(p.locator(".invoice-original img")).toBeVisible();
  const dl = p.waitForEvent("download");
  await p.locator(".invoice-original [data-attachment-download]").click();
  expect(await fs.readFile(await (await dl).path())).toEqual(bytes);
  await p.locator("[data-close]").click();
  await p.locator("#role").selectOption("员工");
  await nav(p, "数据管理");
  const bdl = p.waitForEvent("download");
  await p.locator("#backup").click();
  const b = JSON.parse(await fs.readFile(await (await bdl).path(), "utf8"));
  const x = b.items.find((x) => x.name === "原件关联OCR");
  expect(x.invoices.records[0].attachmentId).toBe(x.attachments[0].id);
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  x.invoices.records[0].attachmentId = "dangling";
  await p.locator("#restore").setInputFiles({
    name: "坏引用.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("原件");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  x.invoices.records[0].attachmentId = x.attachments[0].id;
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "原件备份.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  expect(external).toEqual([]);
});

test("对公发票与验收材料、PDF关联和容量失败重试，审核人只读下载", async ({
  page: p,
}) => {
  const seed = setupCorporate(),
    fs = await import("node:fs/promises"),
    bytes = Buffer.from("%PDF-1.4\nfictional acceptance\n%%EOF");
  await p.goto("/");
  await p.evaluate(({ s, org, flows }) => {
    localStorage.setItem("qingbao-enterprise-v1", JSON.stringify(s));
    localStorage.setItem(
      "qingbao-configuration-v1",
      JSON.stringify({ org, flows }),
    );
  }, seed);
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "对公支付单");
  await p.locator("#enterprise-create").click();
  await p.locator("[name=contractId]").selectOption(seed.s.contracts[0].id);
  await p.locator("[name=name]").fill("对公原件闭环");
  await p.locator("[name=amount]").fill("100");
  await p.locator("[name=note]").fill("虚构材料");
  for (const kind of ["发票", "验收单"]) {
    await p.locator("#attachment-kind").selectOption(kind);
    await p.locator("#attachments-upload").setInputFiles({
      name: kind + ".pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
    await expect(p.locator("#attachments-status")).toContainText("已添加");
  }
  await p.locator("#invoice-attachment").selectOption({ label: "发票.pdf" });
  await p.locator("#invoice-attachment-read").click();
  await expect(p.locator("#invoice-data-status")).toContainText(
    "PDF请下载核对",
  );
  await add(p, values());
  const before = await p.evaluate(() =>
    localStorage.getItem("qingbao-enterprise-v1"),
  );
  await p.evaluate(() => {
    window.originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-enterprise-v1") throw Error("quota");
      return window.originalSet.call(this, k, v);
    };
  });
  await p.locator("#enterprise-form [type=submit]").click();
  await expect(p.locator("#enterprise-error")).toContainText("原数据未改动");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-enterprise-v1")),
  ).toBe(before);
  await expect(p.locator(".attachment-card")).toHaveCount(2);
  await p.evaluate(() => (Storage.prototype.setItem = window.originalSet));
  await p.locator("#enterprise-form [type=submit]").click();
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("head-xu");
  await p.locator("[data-enterprise-open]").first().click();
  await expect(p.locator(".attachment-details")).toContainText("验收单");
  await expect(p.locator("[data-attachment-remove]")).toHaveCount(0);
  const dl = p.waitForEvent("download");
  await p.locator(".invoice-original [data-attachment-download]").click();
  expect(await fs.readFile(await (await dl).path())).toEqual(bytes);
  await p.locator("#enterprise-form [name=note]").fill("核对原件与验收单");
  await p.locator("#enterprise-form [type=submit]").click();
  const s = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("qingbao-enterprise-v1")),
  );
  expect(s.payments[0].attachments).toHaveLength(2);
  expect(s.payments[0].invoices.records[0].attachmentId).toBe(
    s.payments[0].attachments[0].id,
  );
});

test("手机明确解除票面关联后才能移除或改类，移除字段不删除原件", async ({
  page: p,
}) => {
  await p.setViewportSize({ width: 390, height: 844 });
  await expense(p, "手机解除原件");
  await p.locator("#attachment-kind").selectOption("发票");
  await p.locator("#attachments-upload").setInputFiles({
    name: "发票.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nfake\n%%EOF"),
  });
  await expect(p.locator("#attachments-status")).toContainText("已添加");
  await p.locator("#invoice-attachment").selectOption({ label: "发票.pdf" });
  await add(p, values());
  await p.locator("[data-invoice-edit]").click();
  await p.locator("#invoice-attachment").selectOption("");
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
  await p.locator("[data-attachment-kind]").selectOption("合同附件");
  await expect(p.locator("[data-attachment-kind]")).toHaveValue("合同附件");
  await p.locator("[data-invoice-remove]").click();
  await expect(p.locator(".attachment-card")).toHaveCount(1);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.locator("#draft").click();
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-v1"))[0].attachments[0].kind,
    ),
  ).toBe("合同附件");
});
