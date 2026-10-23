import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const nav = (p, n) => p.locator(`aside [data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
const pdf = {
  name: "虚构酒店水单.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n虚构附件测试\n%%EOF"),
};
async function base(p, name) {
  await p.locator("#create").click();
  await p.locator("[name=name]").fill(name);
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=note]").fill("虚构酒店住宿证明");
}
async function upload(p, files) {
  await p.locator("#attachments-upload").setInputFiles(files);
  await expect(p.locator("#attachments-status")).not.toContainText("正在读取");
}
async function backup(p) {
  await nav(p, "数据管理");
  const wait = p.waitForEvent("download");
  await p.locator("#backup").click();
  const f = await wait;
  return JSON.parse(await readFile(await f.path(), "utf8"));
}
test.beforeEach(async ({ page: p }) => {
  await p.goto("/");
  await p.locator("#role").selectOption("员工");
});
test("多附件分类、草稿持久化、审核人图片预览和原文件下载", async ({
  page: p,
}) => {
  await base(p, "酒店多附件");
  await upload(p, [
    pdf,
    {
      name: "虚构行程.png",
      mimeType: "image/png",
      buffer: await readFile("public/samples/demo-invoice.png"),
    },
  ]);
  await expect(p.locator(".attachment-card")).toHaveCount(2);
  await p.locator("[data-attachment-kind]").nth(1).selectOption("行程单");
  await p.locator("#draft").click();
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "报销管理");
  await row(p, "酒店多附件").locator("[data-detail]").click();
  await expect(p.locator(".attachment-details")).toContainText("酒店水单");
  await p.locator("#edit").click();
  await expect(p.locator(".attachment-card")).toHaveCount(2);
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "发票台账");
  await expect(row(p, "酒店多附件")).toContainText("虚构行程.png");
  await nav(p, "报销管理");
  await p.locator("#role").selectOption("主管");
  await row(p, "酒店多附件").locator("[data-detail]").click();
  await p.locator(".attachment-details details summary").click();
  await expect(p.locator(".attachment-image")).toBeVisible();
  expect(
    await p.locator(".attachment-image").evaluate((e) => e.naturalWidth),
  ).toBeGreaterThan(0);
  const wait = p.waitForEvent("download");
  await p
    .locator(".attachment-details [data-attachment-download]")
    .first()
    .click();
  const f = await wait;
  expect(await readFile(await f.path())).toEqual(pdf.buffer);
  await expect(p.locator("[data-attachment-remove]")).toHaveCount(0);
});
test("完整备份含实际文件，恢复可下载；坏附件拒绝不覆盖", async ({
  page: p,
}) => {
  await base(p, "附件备份");
  await upload(p, pdf);
  await p.locator("#expense-form [type=submit]").click();
  const b = await backup(p);
  const x = b.items.find((x) => x.name === "附件备份");
  expect(x.attachments[0].data).toContain("data:application/pdf;base64,");
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  x.attachments[0].size += 1;
  await p.locator("#restore").setInputFiles({
    name: "坏附件.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("大小");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  x.attachments[0].size -= 1;
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "正确附件.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  await nav(p, "报销管理");
  await row(p, "附件备份").locator("[data-detail]").click();
  const wait = p.waitForEvent("download");
  await p.locator(".attachment-details [data-attachment-download]").click();
  expect(await readFile(await (await wait).path())).toEqual(pdf.buffer);
});
test("超限、伪装文件和重复上传提示，移除仅在保存后生效", async ({
  page: p,
}) => {
  await base(p, "附件异常");
  await upload(p, {
    name: "大文件.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(1024 * 1024 + 1),
  });
  await expect(p.locator("#attachments-status")).toContainText("1 MB");
  await upload(p, {
    name: "伪装.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<script>bad</script>"),
  });
  await expect(p.locator("#attachments-status")).toContainText("所声明");
  await upload(p, pdf);
  await upload(p, pdf);
  await expect(p.locator("#attachments-status")).toContainText("重复上传");
  await expect(p.locator(".attachment-card")).toHaveCount(1);
  await p.locator("#draft").click();
  await nav(p, "报销管理");
  await row(p, "附件异常").locator("[data-detail]").click();
  await p.locator("#edit").click();
  p.once("dialog", (d) => d.dismiss());
  await p.locator("[data-attachment-remove]").click();
  await expect(p.locator(".attachment-card")).toHaveCount(1);
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-attachment-remove]").click();
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-v1")).find(
          (x) => x.name === "附件异常",
        ).attachments.length,
    ),
  ).toBe(1);
  await p.locator("#draft").click();
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-v1")).find(
          (x) => x.name === "附件异常",
        ).attachments.length,
    ),
  ).toBe(0);
});
test("附件保存和备份恢复容量失败均保留原业务数据，表单可重试", async ({
  page: p,
}) => {
  await base(p, "附件容量");
  await upload(p, pdf);
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.evaluate(() => {
    window.originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-v1")
        throw new DOMException("quota", "QuotaExceededError");
      return window.originalSet.call(this, k, v);
    };
  });
  await p.locator("#draft").click();
  await expect(p.locator(".toast")).toContainText("原报销未改动");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await expect(p.locator(".attachment-card")).toHaveCount(1);
  await p.evaluate(() => (Storage.prototype.setItem = window.originalSet));
  await p.locator("#draft").click();
  const b = await backup(p);
  b.items.find((x) => x.name === "附件容量").name = "不应覆盖";
  const state = await p.evaluate(() => JSON.stringify({ ...localStorage }));
  await p.evaluate(() => {
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-policy")
        throw new DOMException("quota", "QuotaExceededError");
      return window.originalSet.call(this, k, v);
    };
  });
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "容量测试.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(p.locator(".toast")).toContainText("已回退原数据");
  expect(
    await p.evaluate(() =>
      JSON.stringify(
        Object.fromEntries(Object.entries({ ...localStorage }).sort()),
      ),
    ),
  ).toBe(
    await p.evaluate(
      (s) =>
        JSON.stringify(
          Object.fromEntries(Object.entries(JSON.parse(s)).sort()),
        ),
      state,
    ),
  );
  await p.evaluate(() => (Storage.prototype.setItem = window.originalSet));
});
test("手机附件名称转义与发票分类预审，关闭未保存编辑保留提醒", async ({
  page: p,
}) => {
  await p.setViewportSize({ width: 390, height: 844 });
  await base(p, "手机附件");
  await upload(p, { ...pdf, name: "<img src=x onerror=alert(1)>.pdf" });
  await expect(p.locator("#form-review")).toContainText("缺少票据");
  await p.locator("[data-attachment-kind]").selectOption("发票");
  await expect(p.locator("#form-review")).not.toContainText("缺少票据");
  await expect(p.locator(".attachment-card img")).toHaveCount(0);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  p.once("dialog", (d) => d.dismiss());
  await p.locator("[data-close]").click();
  await expect(p.locator("#expense-form")).toBeVisible();
  await p.locator("#draft").click();
  await nav(p, "报销管理");
  await row(p, "手机附件").locator("[data-detail]").click();
  await expect(p.locator(".attachment-details")).toContainText("<img");
});
