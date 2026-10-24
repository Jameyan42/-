import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { enterpriseOrg } from "../src/organization.js";
import { financeDivisionFlows, defaultFlows } from "../src/approval.js";
import {
  emptyEnterprise,
  saveSupplier,
  saveContract,
  reviewContract,
} from "../src/enterprise.js";
import { demoContractText } from "../src/contract-review.js";

const scanned = "public/samples/demo-invoice.pdf";
const field = (p, key) => p.locator(`[data-invoice-field="${key}"]`);
async function expense(p) {
  await p.goto("/");
  await p.locator("#role").selectOption("员工");
  await p.locator("#create").click();
}
test("对公支付单从留存PDF原件真实识别并保存人工核对字段", async ({
  page: p,
}) => {
  test.setTimeout(120000);
  const org = enterpriseOrg(),
    who = (id) => org.people.find((x) => x.id === id),
    flows = financeDivisionFlows(defaultFlows(), org);
  let s = saveSupplier(
    emptyEnterprise(),
    {
      name: "PDF虚构供应商",
      accountName: "PDF虚构供应商",
      creditCode: "DEMO-PDF",
      bankName: "虚构银行",
      bankAccount: "DEMO-PDF-001",
      active: true,
    },
    who("admin-gu"),
  );
  s = saveContract(
    s,
    {
      title: "PDF票面合同",
      number: "HT-PDF",
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
    note: "人工核对虚构合同",
  });
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
  await p.locator("#role").selectOption("员工");
  await p.locator('aside [data-page="对公支付单"]').click();
  await p.locator("#enterprise-create").click();
  await p.locator("[name=contractId]").selectOption(s.contracts[0].id);
  await p.locator("[name=name]").fill("PDF对公付款");
  await p.locator("[name=amount]").fill("106");
  await p.locator("[name=note]").fill("虚构合同与PDF票面验证");
  await p.locator("#attachment-kind").selectOption("发票");
  await p
    .locator("#attachments-upload")
    .setInputFiles("e2e/fixtures/electronic-invoice.pdf");
  await expect(p.locator("#attachments-status")).toContainText("已添加");
  await p
    .locator("#invoice-attachment")
    .selectOption({ label: "electronic-invoice.pdf" });
  await expect(p.locator("#invoice-pdf-canvas")).toBeVisible();
  await p.locator("#invoice-attachment-read").click();
  await expect(field(p, "amount")).toHaveValue("106.00", { timeout: 90000 });
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
  await p.locator("#enterprise-form [type=submit]").click();
  const saved = await p.evaluate(
    () => JSON.parse(localStorage.getItem("qingbao-enterprise-v1")).payments[0],
  );
  expect(saved.name).toBe("PDF对公付款");
  expect(saved.invoices.records[0].attachmentId).toBe(saved.attachments[0].id);
  expect(saved.invoices.records[0].capture.sourceName).toContain("PDF第1页");
  expect(saved.invoices.records[0].amount).toBe(106);
});
test("扫描PDF逐页预览及真实OCR，换页清候选、不自动覆盖、保留页码来源", async ({
  page: p,
  context,
}) => {
  test.setTimeout(120000);
  const requests = [],
    errors = [];
  context.on("request", (r) => requests.push([r.url(), r.method()]));
  p.on("pageerror", (e) => errors.push(e.message));
  await expense(p);
  await p.locator("[name=amount]").fill("99");
  await p.locator("[name=receipt]").setInputFiles(scanned);
  await expect(p.locator("#ocr-pdf-info")).toContainText("共2页");
  await p.locator("#ocr-pdf-page").fill("2");
  await expect(p.locator("#ocr-pdf-info")).toContainText("当前第2页");
  await p.locator("#ocr-start").click();
  await expect(p.locator("#ocr-invoice")).toHaveValue("22345678901234567890", {
    timeout: 90000,
  });
  await expect(p.locator("#ocr-amount")).toHaveValue("265.00");
  await expect(p.locator("[name=amount]")).toHaveValue("99");
  await p.locator("#ocr-pdf-page").fill("1");
  await expect(p.locator("#ocr-invoice")).toHaveCount(0);
  await p.locator("#ocr-pdf-page").fill("2");
  await expect(p.locator("#ocr-pdf-info")).toContainText("当前第2页");
  await p.locator("#ocr-start").click();
  await expect(p.locator("#ocr-amount")).toHaveValue("265.00", {
    timeout: 90000,
  });
  await p.locator("#ocr-apply").click();
  await expect(p.locator("[name=amount]")).toHaveValue("99");
  await p.locator("#ocr-confirm").check();
  await p.locator("#ocr-apply").click();
  await expect(p.locator("[name=amount]")).toHaveValue("265.00");
  await p.locator("[name=name]").fill("PDF扫描样票报销");
  await p.locator("[name=note]").fill("仅虚构样票的本地识别测试");
  await p.locator("#draft").click();
  const stored = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("qingbao-v1")).find(
      (x) => x.name === "PDF扫描样票报销",
    ),
  );
  expect(stored.invoices.records[0].capture.sourceName).toContain("PDF第2页");
  expect(stored.amount).toBe(265);
  expect(
    requests
      .filter(([u]) => u.startsWith("http"))
      .every(
        ([u, m]) =>
          new URL(u).origin === "http://127.0.0.1:5173" && m === "GET",
      ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("电子PDF结构化识别，字段确认后加入而不改申请金额，手机预览不溢出", async ({
  page: p,
}) => {
  test.setTimeout(120000);
  await expense(p);
  await p.locator("[name=amount]").fill("50");
  await p
    .locator("#invoice-image-input")
    .setInputFiles("e2e/fixtures/electronic-invoice.pdf");
  await expect(p.locator("#invoice-pdf-canvas")).toBeVisible();
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.locator("#invoice-image-read").click();
  await expect(field(p, "number")).toHaveValue("32345678901234567890", {
    timeout: 90000,
  });
  await expect(field(p, "amount")).toHaveValue("106.00");
  await expect(p.locator("[name=amount]")).toHaveValue("50");
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
  await expect(p.locator("#invoice-data-records")).toContainText("PDF第1页");
  await expect(p.locator("#invoice-data-records")).toContainText("106.00");
});

test("报销从已保留PDF原件识别，保存及备份保留原字节和引用", async ({
  page: p,
}) => {
  test.setTimeout(120000);
  await expense(p);
  await p.locator("[name=name]").fill("PDF原件保留");
  await p.locator("[name=amount]").fill("265");
  await p.locator("[name=note]").fill("虚构PDF原件和结构化数据");
  await p.locator("#attachment-kind").selectOption("发票");
  await p.locator("#attachments-upload").setInputFiles(scanned);
  await expect(p.locator("#attachments-status")).toContainText("已添加");
  await p
    .locator("#invoice-attachment")
    .selectOption({ label: "demo-invoice.pdf" });
  await expect(p.locator("#invoice-pdf-info")).toContainText("共2页");
  await p.locator("#invoice-pdf-page").fill("2");
  await expect(p.locator("#invoice-pdf-info")).toContainText("当前第2页");
  await p.locator("#invoice-attachment-read").click();
  await expect(field(p, "amount")).toHaveValue("265.00", { timeout: 90000 });
  await expect(field(p, "buyerName")).toHaveValue("星河科技");
  await p.locator("#invoice-data-confirm").check();
  await p.locator("#invoice-data-add").click();
  await p.locator("#draft").click();
  await p.locator('[data-page="数据管理"]').click();
  const download = p.waitForEvent("download");
  await p.locator("#backup").click();
  const backup = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  const x = backup.items.find((x) => x.name === "PDF原件保留");
  expect(Buffer.from(x.attachments[0].data.split(",")[1], "base64")).toEqual(
    await readFile(scanned),
  );
  expect(x.invoices.records[0].attachmentId).toBe(x.attachments[0].id);
  expect(x.invoices.records[0].capture.sourceName).toContain("第2页");
});

test("PDF加密、损坏、超页数、非法页码和资源失败均回退且保留手工字段", async ({
  page: p,
}) => {
  await expense(p);
  await p.locator("[name=amount]").fill("88");
  for (const [path, message] of [
    ["e2e/fixtures/encrypted-invoice.pdf", "已加密"],
    ["e2e/fixtures/over-page-limit.pdf", "最多支持20页"],
  ]) {
    await p.locator("[name=receipt]").setInputFiles(path);
    await expect(p.locator("#ocr-status")).toContainText(message);
    await expect(p.locator("[name=amount]")).toHaveValue("88");
  }
  await p.locator("[name=receipt]").setInputFiles(scanned);
  await expect(p.locator("#ocr-pdf-info")).toContainText("共2页");
  await p.locator("#ocr-pdf-page").fill("3");
  await expect(p.locator("#ocr-status")).toContainText("只有2页");
  await p.route("**/ocr/pdfjs/pdf.worker.mjs", (route) => route.abort());
  await p.locator("[name=receipt]").setInputFiles(scanned);
  await p.locator("#ocr-start").click();
  await expect(p.locator("#ocr-status")).toContainText("识别未完成");
  await expect(p.locator("[name=amount]")).toHaveValue("88");
  await expect(p.locator("#ocr-start")).toBeEnabled();
});

test("PDF读取可取消，迟到结果不回填且关闭后新表单保持空白", async ({
  page: p,
}) => {
  await expense(p);
  await p.locator("[name=amount]").fill("77");
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  await p.route("**/ocr/pdfjs/pdf.mjs", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await p.locator("[name=receipt]").setInputFiles(scanned);
    await p.locator("#ocr-start").click();
    await expect(p.locator("#ocr-cancel")).toBeVisible();
    await p.locator("#ocr-cancel").click();
    await expect(p.locator("#ocr-status")).toContainText("已取消");
    await expect(p.locator("[name=amount]")).toHaveValue("77");
    p.once("dialog", (d) => d.accept());
    await p.keyboard.press("Escape");
    await p.locator("#create").click();
    release();
    await expect(p.locator("[name=amount]")).toHaveValue("");
    await expect(p.locator("#ocr-invoice")).toHaveCount(0);
  } finally {
    release();
  }
});
