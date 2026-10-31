import { addMaterials, completeBusiness } from "./r006-helpers.js";
import { test, expect } from "@playwright/test";
const key = "qingbao-s001-v1";
const nav = (p, name) => p.locator(`aside [data-page="${name}"]`).click();
const data = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const field = (p, n) => p.locator(`#s001-form [name="${n}"]`);
const inv = (p, n) => p.locator(`[data-invoice] [data-field="${n}"]`).first();
async function create(p) {
  await p.goto("/?view=claims");
  await p.locator("#role").selectOption("财务");
  await p.locator("#s001-new").click();
  await p.locator("#s001-example").click();
  await p.locator("#s001-form [name=accountCode]").selectOption("6602.01");
  await p.locator("#s001-form [name=accountStage]").selectOption("财务确认");
  await addMaterials(p);
}
async function run(p) {
  const stage = await p.locator("#role").inputValue();
  if (stage !== "财务") {
    await p.locator("#s001-form [type=submit]").click();
    return;
  }
  await p.locator("#s001-draft").click();
  if (await p.locator("#s001-form").count()) return;
  await p.locator("[data-detail-s001]").first().click();
  await completeBusiness(p);
}
async function finance(p) {
  await p.locator("#role").selectOption("财务");
}
async function decide(p, action = "approved") {
  await p
    .locator("#s001-review-form [name=reason]")
    .fill("已核实模拟业务及票面，记录财务意见");
  await p.locator(`#s001-review-form [value=${action}]`).click();
}
test("验收一/五：一张单三规则PASS→财务确认→刷新→列表与历史", async ({
  page: p,
}) => {
  await create(p);
  await run(p);
  await expect(p.locator("[data-testid=s001-business]")).toHaveText(
    "规则检查通过（待财务确认）",
  );
  for (const k of [
    "lodging.limit",
    "invoice.duplicate",
    "invoice.amount-support",
  ])
    await expect(p.locator(`[data-rule-key="${k}"] > summary`)).toContainText(
      "通过",
    );
  await finance(p);
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.locator("#s001-review-error")).toContainText("意见");
  await decide(p);
  await expect(p.getByTestId("s001-review")).toContainText("财务复核通过");
  await p.reload();
  await nav(p, "报销单管理");
  await expect(p.locator("#s001-root tbody")).toContainText("已通过");
  await nav(p, "审核历史");
  await expect(p.locator("#s001-root")).toContainText("已核实模拟业务");
});
test("验收二：三异常同时出现、BLOCK不得普通放行、可驳回", async ({
  page: p,
}) => {
  await create(p);
  await field(p, "city").fill("北京");
  await field(p, "grade").selectOption("部门经理");
  await field(p, "checkOut").fill("2026-10-21");
  await field(p, "amountYuan").fill("1200");
  await field(p, "hotelAmountYuan").fill("1200");
  await inv(p, "type").selectOption("增值税电子普通发票");
  await inv(p, "code").fill("044001900111");
  await inv(p, "number").fill("12345678");
  await inv(p, "amountYuan").fill("1000");
  await run(p);
  await expect(p.locator('[data-rule-key="lodging.limit"]')).toContainText(
    "400.00",
  );
  await expect(
    p.locator('[data-rule-key="invoice.duplicate"] > summary'),
  ).toContainText("人工复核");
  await expect(
    p.locator('[data-rule-key="invoice.amount-support"]'),
  ).toContainText("200.00");
  await finance(p);
  await decide(p);
  await expect(p.locator("#s001-review-error")).toContainText("不能普通放行");
  await decide(p, "rejected");
  await expect(p.getByTestId("s001-review")).toContainText("财务复核驳回");
});
test("验收三/六/八：部分报销→核查留痕→批准前修改失效→同单重审不自重复→旧意见保留", async ({
  page: p,
}) => {
  await create(p);
  await inv(p, "amountYuan").fill("1000");
  await field(p, "partialReason").fill("个人承担超过标准部分");
  await run(p);
  await expect(
    p.locator('[data-rule-key="invoice.amount-support"]'),
  ).toContainText("部分报销");
  await finance(p);
  await p
    .locator("#r004-note [name=note]")
    .fill("已核实部分报销，修改后重新核查");
  await p.locator('#r004-note [value="已核实信息"]').click();
  const id = (await data(p)).claims[0].id;
  await p.locator("[data-edit-s001]").click();
  await field(p, "changeReason").fill("核对后修正模拟资料");
  await field(p, "amountYuan").fill("700");
  await field(p, "hotelAmountYuan").fill("700");
  await p.locator("#s001-draft").click();
  await expect(p.locator("#s001-root tbody")).toContainText("草稿");
  await p.locator("[data-detail-s001]").click();
  await expect(p.locator("#s001-root")).toContainText("已失效");
  await p.locator("[data-edit-s001]").click();
  await field(p, "changeReason").fill("核对后修正模拟资料");
  await run(p);
  await expect(
    p.locator('[data-rule-key="invoice.duplicate"] > summary'),
  ).toContainText("通过");
  await p.locator("[data-edit-s001]").click();
  await field(p, "changeReason").fill("核对后修正模拟资料");
  await run(p);
  const d = (await data(p)).claims.find((d) => d.id === id);
  expect(d.batches.length).toBe(3);
  expect(d.batches[0].review).toBeNull();
  expect(d.reviewNotes[0].reason).toContain("已核实部分报销");
  await decide(p);
  await nav(p, "审核历史");
  await expect(p.locator("#s001-root tbody tr")).toHaveCount(3);
  await p.locator("[data-history-doc]").first().click();
  await expect(p.locator("#s001-root")).toContainText("已核实部分报销");
  await p.locator("#s001-batch").selectOption({ index: 2 });
  await expect(p.getByTestId("s001-review")).toContainText("已核实模拟业务");
});
test("验收四：金额缺失及外币均信息不足，草稿刷新保留", async ({ page: p }) => {
  await create(p);
  await inv(p, "amountYuan").fill("");
  await p.locator("#s001-draft").click();
  await p.reload();
  await p.locator("[data-edit-s001]").click();
  await field(p, "changeReason").fill("核对后修正模拟资料");
  await expect(inv(p, "amountYuan")).toHaveValue("");
  await run(p);
  await expect(
    p.locator('[data-rule-key="invoice.amount-support"] > summary'),
  ).toContainText("信息不足");
  await p.locator("[data-edit-s001]").click();
  await field(p, "changeReason").fill("核对后修正模拟资料");
  await inv(p, "amountYuan").fill("100");
  await inv(p, "currency").selectOption("USD");
  await run(p);
  await expect(
    p.locator('[data-rule-key="invoice.amount-support"] > summary'),
  ).toContainText("信息不足");
});
test("多票、跨单重复与搜索，坏标准单条ERROR不假通过", async ({ page: p }) => {
  await create(p);
  await inv(p, "amountYuan").fill("400");
  await field(p, "amountYuan").fill("700");
  await field(p, "hotelAmountYuan").fill("700");
  await p.locator("#s001-add-invoice").click();
  const row = p.locator("[data-invoice]").nth(1);
  await row.locator("[data-field=number]").fill("12300000000000000001");
  await row.locator("[data-field=amountYuan]").fill("300");
  await row.locator("[data-field=date]").fill("2026-10-22");
  await row.locator("[data-field=sellerName]").fill("模拟酒店");
  await run(p);
  await expect(
    p.locator('[data-rule-key="invoice.amount-support"] > summary'),
  ).toContainText("通过");
  const number = (await data(p)).claims[0].input.invoices[0].number;
  await nav(p, "报销单管理");
  await p.locator("#s001-new").click();
  await p.locator("#s001-example").click();
  await inv(p, "number").fill(number);
  await run(p);
  await expect(
    p.locator('[data-rule-key="invoice.duplicate"] > summary'),
  ).toContainText("人工复核");
  await p.evaluate(() => localStorage.setItem("qingbao-r001-v1", "BROKEN"));
  await p.locator("[data-edit-s001]").click();
  await field(p, "changeReason").fill("核对后修正模拟资料");
  await run(p);
  await expect(
    p.locator('[data-rule-key="lodging.limit"] > summary'),
  ).toContainText("执行失败");
  await expect(
    p.locator('[data-rule-key="invoice.amount-support"] > summary'),
  ).toContainText("通过");
  await expect(p.getByTestId("s001-business")).toHaveText("审核失败");
});
test("存储损坏不覆盖、配额失败保留表单、手机无页面溢出", async ({
  page: p,
}) => {
  await create(p);
  await p.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw Error("quota");
    };
  });
  await p.locator("#s001-draft").click();
  await expect(p.locator("#s001-error")).toContainText("保存失败");
  await expect(field(p, "amountYuan")).toHaveValue("600");
  await p.reload();
  await p.evaluate(() => localStorage.setItem("qingbao-s001-v1", "BROKEN"));
  await p.reload();
  await expect(p.locator("#s001-root")).toContainText("已暂停保存");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-s001-v1"))).toBe(
    "BROKEN",
  );
});
test("复用OCR及附件来源，图片识别后保存刷新；手机表单无溢出", async ({
  page: p,
}) => {
  test.setTimeout(120000);
  await create(p);
  await p
    .locator("[data-file]")
    .setInputFiles("public/samples/structured-invoice.png");
  await expect(p.locator("[data-invoice]")).toContainText(
    "structured-invoice.png",
  );
  await p.locator("[data-ocr]").click();
  await expect(inv(p, "amountYuan")).toHaveValue("265.00", { timeout: 90000 });
  await expect(p.locator("[data-invoice]")).toContainText("OCR辅助");
  await p.locator("#s001-draft").click();
  await p.reload();
  await p.locator("[data-edit-s001]").click();
  await field(p, "changeReason").fill("核对后修正模拟资料");
  await expect(inv(p, "number")).toHaveValue("22345678901234567890");
  await expect(p.locator("[data-invoice]")).toContainText(
    "structured-invoice.png",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
