import { test, expect } from "@playwright/test";
const key = "qingbao-r001-v1";
const nav = (p, view) => p.locator(`nav [data-page=${view}]`).click();
const stored = (p) => p.evaluate((k) => localStorage.getItem(k), key);
async function open(p) {
  await p.goto("/r001.html");
}
async function t03(p) {
  await p.locator("#r001-load-t03").click();
}
async function run(p) {
  await p.locator("#r001-entry-form [type=submit]").click();
}
async function modifyShenzhen(p, value) {
  await nav(p, "standards");
  await p
    .locator("tbody tr")
    .filter({ hasText: "深圳" })
    .filter({ hasText: "普通员工" })
    .getByRole("button", { name: "修改" })
    .click();
  await p.locator("[name=nightlyYuan]").fill(value);
  await p.locator("#r001-standard-form [type=submit]").click();
}
test("R001 T03录入→自动超标300→必须填原因→人工通过→刷新保留原始结果", async ({
  page: p,
  context,
}) => {
  const errors = [],
    requests = [];
  p.on("pageerror", (e) => errors.push(e.message));
  context.on("request", (r) => requests.push([r.url(), r.method()]));
  await open(p);
  await t03(p);
  await expect(p.locator("#r001-nights")).toContainText("3");
  await run(p);
  await expect(p.getByTestId("auto-result")).toContainText("需要人工复核");
  await expect(p.getByTestId("limit")).toHaveText("¥ 1,500.00");
  await expect(p.getByTestId("excess")).toHaveText("¥ 300.00");
  const data = JSON.parse(await stored(p)),
    id = data.records[0].id,
    auto = JSON.stringify(data.records[0].automatic);
  await nav(p, "review");
  await p.getByRole("button", { name: "人工通过", exact: true }).click();
  await expect(p.locator("#r001-review-error")).toContainText("复核原因");
  expect(await stored(p)).toBe(JSON.stringify(data));
  await p
    .locator("[name=reason]")
    .fill("展会期间涨价，经核对批准此次例外（虚构）");
  await p.getByRole("button", { name: "人工通过", exact: true }).click();
  await expect(p.getByTestId("human-result")).toContainText("人工通过");
  await expect(p.getByTestId("auto-result")).toContainText("需要人工复核");
  await p.reload();
  await nav(p, "results");
  await p.locator("#r001-record-select").selectOption(id);
  await expect(p.getByTestId("human-result")).toContainText("展会期间涨价");
  const saved = JSON.parse(await stored(p)).records.find((r) => r.id === id);
  expect(JSON.stringify(saved.automatic)).toBe(auto);
  expect(saved.humanReview.decision).toBe("approved");
  expect(saved.humanReview.at).toMatch(/Z$/);
  expect(errors).toEqual([]);
  expect(
    requests
      .filter(([u]) => u.startsWith("http"))
      .every(([u, m]) => new URL(u).hostname === "127.0.0.1" && m === "GET"),
  ).toBe(true);
});
test("人工驳回也显示原因时间，自动结果不覆盖，禁止第二次复核", async ({
  page: p,
}) => {
  await open(p);
  await t03(p);
  await run(p);
  await nav(p, "review");
  await p
    .locator("[name=reason]")
    .fill("住宿超出公司标准，请调整后重新申请（虚构）");
  await p.getByRole("button", { name: "人工驳回", exact: true }).click();
  await expect(p.getByTestId("human-result")).toContainText("人工驳回");
  await expect(p.getByTestId("auto-result")).toContainText("¥ 300.00");
  await expect(p.locator("#r001-review-form")).toHaveCount(0);
  await nav(p, "results");
  await expect(p.getByTestId("human-result")).toContainText("请调整后重新申请");
});
test("修改标准后新审核使用700元，旧单保留500元快照及1500元限额", async ({
  page: p,
}) => {
  await open(p);
  await t03(p);
  await run(p);
  const original = JSON.parse(await stored(p)).records[0];
  await modifyShenzhen(p, "700.00");
  await expect(p.locator(".feedback")).toContainText("v2");
  await nav(p, "results");
  await expect(p.getByTestId("nightly-rate")).toContainText("500.00");
  await expect(p.getByTestId("limit")).toContainText("1,500.00");
  await p.locator("#r001-copy").click();
  await run(p);
  await expect(p.getByTestId("auto-result")).toContainText("通过本项审核");
  await expect(p.getByTestId("limit")).toContainText("2,100.00");
  const current = JSON.parse(await stored(p));
  expect(current.records.find((r) => r.id === original.id)).toEqual(original);
  await p.reload();
  await nav(p, "results");
  await p.locator("#r001-record-select").selectOption(original.id);
  await expect(p.getByTestId("excess")).toContainText("300.00");
});
test("未配置城市不虚构限额，新增标准后历史仍缺失、新单可通过", async ({
  page: p,
}) => {
  await open(p);
  await t03(p);
  await p.locator("[name=city]").fill("杭州");
  await p.locator("[name=checkOut]").fill("2026-10-22");
  await p.locator("[name=amountYuan]").fill("800");
  await run(p);
  await expect(p.getByTestId("nightly-rate")).toContainText("未配置标准");
  await expect(p.getByTestId("limit")).toHaveText("无法计算");
  await expect(p.getByTestId("excess")).toHaveText("无法计算");
  await nav(p, "standards");
  await p.locator("#r001-standard-form [name=city]").fill("杭州");
  await p.locator("[name=nightlyYuan]").fill("400");
  await p.locator("#r001-standard-form [type=submit]").click();
  await expect(p.locator("tbody tr")).toHaveCount(16);
  await nav(p, "results");
  await expect(p.getByTestId("excess")).toHaveText("无法计算");
  await p.locator("#r001-copy").click();
  await run(p);
  await expect(p.getByTestId("auto-result")).toContainText("通过本项审核");
  await expect(p.getByTestId("limit")).toContainText("800.00");
});
test("必填缺失、零晚、负数和过多小数返回问题；0元提示确认且不超标", async ({
  page: p,
}) => {
  await open(p);
  for (const [field, value, expected] of [
    ["employeeName", "", "待补充资料"],
    ["checkOut", "2026-10-20", "数据错误"],
    ["amountYuan", "-1", "数据错误"],
    ["amountYuan", "1.001", "数据错误"],
    ["amountYuan", "0", "0元申请"],
  ]) {
    if (await p.locator("#r001-new").count())
      await p.locator("#r001-new").click();
    await t03(p);
    await p.locator(`[name=${field}]`).fill(value);
    await run(p);
    await expect(p.getByTestId("auto-result")).toContainText(expected);
    if (value !== "0") {
      await expect(p.getByTestId("limit")).toHaveText("无法计算");
      await expect(p.getByTestId("excess")).toHaveText("无法计算");
    } else {
      await expect(p.getByTestId("excess")).toHaveText("¥ 0.00");
      await expect(p.locator(".zero-warning")).toContainText("不判为超标");
    }
  }
});
test("0.10元标准乘3晚精确为0.30元，0.31元仅超标0.01元", async ({ page: p }) => {
  await open(p);
  await modifyShenzhen(p, "0.10");
  await nav(p, "entry");
  await t03(p);
  await p.locator("[name=amountYuan]").fill("0.31");
  await run(p);
  await expect(p.getByTestId("limit")).toHaveText("¥ 0.30");
  await expect(p.getByTestId("excess")).toHaveText("¥ 0.01");
  const saved = JSON.parse(await stored(p)).records[0];
  expect(saved.automatic.amountCents).toBe(31);
  expect(saved.automatic.limitCents).toBe(30);
  expect(saved.automatic.excessCents).toBe(1);
});
test("恢复模拟数据可取消，仅重置R001，其他轻报数据不受影响", async ({
  page: p,
}) => {
  await open(p);
  await p.evaluate(() =>
    localStorage.setItem("qingbao-v1", "KEEP-EXISTING-DATA"),
  );
  await t03(p);
  await run(p);
  await modifyShenzhen(p, "750");
  const before = await stored(p);
  p.once("dialog", (d) => d.dismiss());
  await p.locator("#r001-reset").click();
  expect(await stored(p)).toBe(before);
  p.once("dialog", (d) => d.accept());
  await p.locator("#r001-reset").click();
  const after = JSON.parse(await stored(p));
  expect(after.standards.version).toBe(1);
  expect(after.standards.rows).toHaveLength(15);
  expect(after.records).toHaveLength(2);
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    "KEEP-EXISTING-DATA",
  );
});
test("写入失败保留录入、复核原因与旧值，重试不重复审核", async ({
  page: p,
}) => {
  await open(p);
  await t03(p);
  await p.evaluate(() => {
    window.r001Set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-r001-v1") throw Error("quota");
      return window.r001Set.call(this, k, v);
    };
  });
  await run(p);
  await expect(p.locator("#r001-entry-error")).toContainText("当前填写仍保留");
  await expect(p.locator("[name=amountYuan]")).toHaveValue("1800.00");
  expect(await stored(p)).toBe(null);
  await p.evaluate(() => {
    Storage.prototype.setItem = window.r001Set;
  });
  await run(p);
  expect(JSON.parse(await stored(p)).records).toHaveLength(3);
  await nav(p, "review");
  await p.locator("[name=reason]").fill("重试保存人工复核依据");
  const before = await stored(p);
  await p.evaluate(() => {
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-r001-v1") throw Error("quota");
      return window.r001Set.call(this, k, v);
    };
  });
  await p.getByRole("button", { name: "人工通过", exact: true }).click();
  await expect(p.locator("#r001-review-error")).toContainText("原记录未改动");
  expect(await stored(p)).toBe(before);
  await expect(p.locator("[name=reason]")).toHaveValue("重试保存人工复核依据");
  await p.evaluate(() => {
    Storage.prototype.setItem = window.r001Set;
  });
  await p.getByRole("button", { name: "人工通过", exact: true }).click();
  await expect(p.getByTestId("human-result")).toContainText("人工通过");
});
test("破损数据不被覆盖，标准保存失败保留填写与原版本", async ({ page: p }) => {
  await open(p);
  await p.evaluate((k) => localStorage.setItem(k, "{broken"), key);
  await p.reload();
  await expect(p.locator("main")).toContainText("原值已保留");
  await expect(p.locator("#r001-entry-form")).toHaveCount(0);
  expect(await stored(p)).toBe("{broken");
  p.once("dialog", (d) => d.accept());
  await p.locator("#r001-recover").click();
  await nav(p, "standards");
  await p.locator("#r001-standard-form [name=city]").fill("杭州");
  await p.locator("[name=nightlyYuan]").fill("450.50");
  const before = await stored(p);
  await p.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-r001-v1") throw Error("quota");
      return set.call(this, k, v);
    };
  });
  await p.locator("#r001-standard-form [type=submit]").click();
  await expect(p.locator("#r001-standard-error")).toContainText(
    "当前填写仍保留",
  );
  await expect(p.locator("[name=nightlyYuan]")).toHaveValue("450.50");
  expect(await stored(p)).toBe(before);
});
test("390px四页面无整页溢出，文本转义且未保存复核/标准切换可取消", async ({
  page: p,
}) => {
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewportSize({ width: 390, height: 844 });
  await open(p);
  await t03(p);
  await p.locator("[name=employeeName]").fill("<img src=x onerror=alert(1)>");
  await run(p);
  await expect(p.locator("main img")).toHaveCount(0);
  for (const view of ["entry", "results", "review", "standards"]) {
    await nav(p, view);
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await p.locator("#r001-standard-form [name=city]").fill("未保存城市");
  p.once("dialog", (d) => d.dismiss());
  await nav(p, "entry");
  await expect(p.locator("#r001-standard-form [name=city]")).toHaveValue(
    "未保存城市",
  );
  p.once("dialog", (d) => d.accept());
  await nav(p, "review");
  await p.locator("[name=reason]").fill("复核填写未保存");
  p.once("dialog", (d) => d.dismiss());
  await nav(p, "results");
  await expect(p.locator("[name=reason]")).toHaveValue("复核填写未保存");
  expect(errors).toEqual([]);
});
test("另一个页面更新后拒绝用旧状态覆盖审核记录", async ({
  page: p,
  context,
}) => {
  await open(p);
  const other = await context.newPage();
  await open(other);
  await t03(other);
  await t03(p);
  await run(p);
  const before = await stored(p);
  await run(other);
  await expect(other.locator("#r001-entry-error")).toContainText(
    "其他页面更新",
  );
  expect(await stored(p)).toBe(before);
  await expect(other.locator("[name=amountYuan]")).toHaveValue("1800.00");
  await other.close();
});
