import { test, expect } from "@playwright/test";
async function openForm(page) {
  await page.goto("/");
  await page.locator("#role").selectOption("员工");
  await page.locator("#create").click();
}
test("真实本地OCR识别样票，核对前不覆盖，确认后保存来源", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const requests = [];
  context.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openForm(page);
  await page.locator("[name=name]").fill("OCR场景验证");
  await page.locator("[name=amount]").fill("12.34");
  await page.locator("[name=invoice]").fill("KEEP001");
  await page.locator("#ocr-sample").click();
  await expect(page.locator("#ocr-invoice")).toHaveValue(
    "12345678901234567890",
    { timeout: 90000 },
  );
  await expect(page.locator("#ocr-amount")).toHaveValue("268.50");
  await expect(page.locator("[name=amount]")).toHaveValue("12.34");
  await expect(page.locator("[name=invoice]")).toHaveValue("KEEP001");
  await page.locator("#ocr-apply").click();
  await expect(page.locator("#ocr-status")).toContainText("勾选确认");
  await page.locator("#ocr-confirm").check();
  await page.locator("#ocr-apply").click();
  await expect(page.locator("[name=amount]")).toHaveValue("268.50");
  await expect(page.locator("[name=invoice]")).toHaveValue(
    "12345678901234567890",
  );
  await page.locator("[name=note]").fill("使用公开虚构样票进行测试");
  await page.locator("button[type=submit]").click();
  const row = page.locator("tbody tr").filter({ hasText: "OCR场景验证" });
  await expect(row).toContainText("268.50");
  await row.locator("[data-detail]").click();
  await expect(page.locator(".modal")).toContainText("曾使用浏览器 OCR");
  const stored = await page.evaluate(() => localStorage.getItem("qingbao-v1"));
  expect(stored).not.toContain("data:image");
  expect(stored).not.toContain("DEMO ONLY");
  expect(JSON.parse(stored)[0].ocr.confirmed).toBe(true);
  expect(
    requests
      .filter((r) => r.url.startsWith("http"))
      .every(
        (r) => new URL(r.url).hostname === "127.0.0.1" && r.method === "GET",
      ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("不支持PDF和损坏图片时可继续手工报销", async ({ page }) => {
  await openForm(page);
  await page
    .locator("[name=receipt]")
    .setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo"),
    });
  await page.locator("#ocr-start").click();
  await expect(page.locator("#ocr-status")).toContainText("PDF");
  await page
    .locator("[name=receipt]")
    .setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not-an-image"),
    });
  await page.locator("#ocr-start").click();
  await expect(page.locator("#ocr-status")).toContainText("识别未完成");
  await expect(page.locator("#ocr-start")).toBeEnabled();
  await page.locator("[name=name]").fill("失败后的手工报销");
  await page.locator("[name=amount]").fill("100");
  await page.locator("[name=note]").fill("手工录入仍可正常进行");
  await page.locator("button[type=submit]").click();
  await expect(page.locator("tbody")).toContainText("失败后的手工报销");
});
test("识别加载中可取消，未保存关闭需要确认", async ({ page }) => {
  await openForm(page);
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  await page.route("**/ocr/worker.min.js", async (route) => {
    await gate;
    await route.abort();
  });
  await page.locator("[name=amount]").fill("88");
  await page.locator("#ocr-sample").click();
  await expect(page.locator("#ocr-cancel")).toBeVisible();
  await page.locator("#ocr-cancel").click();
  release();
  await expect(page.locator("#ocr-status")).toContainText("已取消");
  await expect(page.locator("[name=amount]")).toHaveValue("88");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("项目案例支持打印并跳转演示，手机表单无整页溢出", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="项目案例"]').click();
  await expect(page.locator(".case-study")).toContainText("待验证假设");
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  await page.locator("#print-case").click();
  expect(await page.evaluate(() => window.__printed)).toBe(true);
  await page.locator("#case-to-guide").click();
  await expect(page.locator("h1")).toHaveText("演示指南");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#role").selectOption("员工");
  await page.locator("#create").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#ocr-sample")).toBeVisible();
});
