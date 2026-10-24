import { test, expect } from "@playwright/test";
const key = "qingbao-r002-v1";
const nav = (p, name) => p.locator(`nav [data-page=${name}]`).click();
const data = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const raw = (p) => p.evaluate((k) => localStorage.getItem(k), key);
async function open(p) {
  await p.goto("/r002.html");
}
async function t02(p) {
  await p.locator("#r002-load-t02").click();
}
async function run(p) {
  await p.locator("#r002-entry-form [type=submit]").click();
}
async function fields(p, values, form = "#r002-entry-form") {
  for (const [name, value] of Object.entries(values)) {
    const el = p.locator(`${form} [name=${name}]`);
    if (name === "invoiceType") await el.selectOption(value);
    else await el.fill(value);
  }
}
async function reviewer(
  p,
  decision = "rejected",
  reason = "经核对与BX-H001为同一发票，驳回重复提交（模拟）",
) {
  await p.locator("[name=reviewer]").fill("周宁（模拟）");
  await p.locator("[name=reviewReason]").fill(reason);
  await p.locator(`#r002-review-form [value=${decision}]`).click();
}
async function editH001(p, changes) {
  await nav(p, "library");
  await p
    .locator("#r002-history-table tbody tr")
    .filter({ hasText: "BX-H001" })
    .getByRole("button", { name: "编辑模拟记录" })
    .click();
  await fields(p, changes, "#r002-history-form");
  await p.locator("#r002-history-form [type=submit]").click();
  await expect(p.locator(".feedback")).toContainText("模拟历史已保存");
}

test("T02全流程：同代码号码命中已通过BX-H001，人员原因必填，驳回后原结论仍可看并刷新保留", async ({
  page: p,
  context,
}) => {
  const errors = [],
    requests = [];
  p.on("pageerror", (e) => errors.push(e.message));
  context.on("request", (r) => requests.push([r.url(), r.method()]));
  await open(p);
  await t02(p);
  await run(p);
  await expect(p.getByTestId("r002-auto-result")).toContainText("需要人工复核");
  await expect(p.getByTestId("r002-match-count")).toHaveText("1");
  await expect(p.getByTestId("r002-matches")).toContainText("BX-H001");
  await expect(p.getByTestId("r002-matches")).toContainText("已通过");
  const initial = await data(p),
    id = initial.documents[0].id,
    automatic = JSON.stringify(initial.documents[0].audits[0].automatic);
  await nav(p, "review");
  await p.locator("#r002-review-form [value=rejected]").click();
  await expect(p.locator("#r002-review-error")).toContainText("复核原因");
  await p.locator("[name=reviewReason]").fill("先填写原因验证人员必填");
  await p.locator("#r002-review-form [value=rejected]").click();
  await expect(p.locator("#r002-review-error")).toContainText("人员姓名");
  await reviewer(p);
  await expect(p.getByTestId("human-result")).toContainText("人工驳回");
  await expect(p.getByTestId("r002-auto-result")).toContainText("需要人工复核");
  await expect(p.getByTestId("r002-business-status")).toHaveText("已驳回");
  await expect(p.locator("#r002-review-form")).toHaveCount(0);
  await p.reload();
  await nav(p, "results");
  await p.locator("#r002-document-select").selectOption(id);
  await expect(p.getByTestId("human-result")).toContainText("周宁（模拟）");
  const saved = (await data(p)).documents[0];
  expect(JSON.stringify(saved.audits[0].automatic)).toBe(automatic);
  expect(saved.audits[0].humanReview.at).toMatch(/Z$/);
  expect(errors).toEqual([]);
  expect(
    requests
      .filter(([u]) => u.startsWith("http"))
      .every(([u, m]) => new URL(u).hostname === "127.0.0.1" && m === "GET"),
  ).toBe(true);
});
test("人工通过与自动查重结论分开，重审生成新版本，旧版及复核仍可查看且只读", async ({
  page: p,
}) => {
  await open(p);
  await t02(p);
  await run(p);
  await nav(p, "review");
  await reviewer(p, "approved", "确认允许历史驳回后的补充提交（模拟例外）");
  await expect(p.getByTestId("human-result")).toContainText("人工通过");
  const old = (await data(p)).documents[0].audits[0];
  await p.locator("#r002-reaudit").click();
  await expect(p.locator("#r002-version-select")).toContainText("v2");
  expect((await data(p)).documents[0].audits).toHaveLength(2);
  await p.locator("#r002-version-select").selectOption(old.id);
  await expect(p.getByTestId("human-result")).toContainText("人工通过");
  await nav(p, "review");
  await expect(p.locator("#r002-review-form")).toHaveCount(0);
  expect((await data(p)).documents[0].audits[0]).toEqual(old);
});
test("传统发票缺代码在字段附近报错，保存数据问题版本，补齐后同单生成新审核", async ({
  page: p,
}) => {
  await open(p);
  await t02(p);
  await fields(p, { invoiceCode: "" });
  await run(p);
  await expect(p.locator("#entry-invoiceCode-error")).toContainText(
    "需补充发票代码",
  );
  expect((await data(p)).documents[0].businessStatus).toBe("待补充");
  await nav(p, "results");
  await expect(p.getByTestId("r002-match-count")).toHaveText("未执行");
  await expect(p.getByTestId("r002-auto-result")).toContainText("待补充");
  await p.locator("#r002-edit-document").click();
  await fields(p, { invoiceCode: "044001900111" });
  await run(p);
  await expect(p.getByTestId("r002-match-count")).toHaveText("1");
  const saved = (await data(p)).documents[0];
  expect(saved.audits).toHaveLength(2);
  expect(saved.audits[0].automatic.searchPerformed).toBe(false);
  expect(saved.audits[1].automatic.searchPerformed).toBe(true);
});
test("跨类型同号只提示潜在冲突；金额0单独人工确认，不误当重复", async ({
  page: p,
}) => {
  await open(p);
  await t02(p);
  await fields(p, { invoiceType: "数电发票", invoiceCode: "" });
  await run(p);
  await expect(p.getByTestId("r002-exact-count")).toHaveText("0");
  await expect(p.getByTestId("r002-potential-count")).toHaveText("1");
  await expect(p.getByTestId("r002-matches")).toContainText("潜在冲突");
  await p.locator("#r002-new").click();
  await t02(p);
  await fields(p, { invoiceNumber: "90000012", amountYuan: "0" });
  await run(p);
  await expect(p.getByTestId("r002-auto-result")).toContainText("金额为0");
  await expect(p.getByTestId("r002-match-count")).toHaveText("0");
  await expect(p.getByTestId("r002-auto-result")).toContainText("需要人工复核");
});
test("修改模拟历史后新审用新数据，旧匹配证据和业务状态不被改写", async ({
  page: p,
}) => {
  await open(p);
  await t02(p);
  await run(p);
  const old = (await data(p)).documents[0].audits[0];
  await editH001(p, { invoiceCode: "044001999999" });
  await nav(p, "results");
  await expect(p.getByTestId("r002-matches")).toContainText("044001900111");
  await p.locator("#r002-reaudit").click();
  await expect(p.getByTestId("r002-auto-result")).toContainText(
    "通过 R002 查重",
  );
  await expect(p.getByTestId("r002-match-count")).toHaveText("0");
  const saved = (await data(p)).documents[0];
  expect(saved.audits[0]).toEqual(old);
  expect(saved.audits[1].automatic.evidence.excludedSelfCount).toBe(1);
  await p.locator("#r002-version-select").selectOption(old.id);
  await expect(p.getByTestId("r002-matches")).toContainText("BX-H001");
  await p.reload();
  await nav(p, "library");
  await expect(p.locator("#r002-history-table")).toContainText("044001999999");
});
test("添加模拟历史、号码/单号搜索和状态筛选，返回全部命中及驳回/撤回说明", async ({
  page: p,
}) => {
  await open(p);
  await nav(p, "library");
  for (const [documentId, status] of [
    ["BX-H006", "已撤回"],
    ["BX-H007", "已驳回"],
  ]) {
    const form = "#r002-history-form";
    await p.locator(`${form} [name=historyDocumentId]`).fill(documentId);
    await p
      .locator(`${form} [name=historyBusinessStatus]`)
      .selectOption(status);
    await fields(
      p,
      {
        employeeName: "模拟新增员工",
        department: "模拟业务部",
        invoiceType: "增值税电子普通发票",
        invoiceCode: "044001900111",
        invoiceNumber: "12345678",
        issueDate: "2026-10-01",
        sellerName: "深圳星河服务有限公司（模拟）",
        amountYuan: "500.00",
      },
      form,
    );
    await p.locator(`${form} [type=submit]`).click();
    await expect(p.locator(".feedback")).toContainText("模拟历史已保存");
  }
  await p.locator("#r002-history-search").fill("BX-H006");
  await expect(p.locator("#r002-history-table tbody tr")).toHaveCount(1);
  await expect(p.locator("#r002-history-table")).toContainText("已撤回");
  await p.locator("#r002-history-search").fill("12345678");
  await expect(p.locator("#r002-history-table tbody tr")).toHaveCount(4);
  await expect(p.locator("#r002-history-table")).toContainText("BX-H004");
  await p.locator("#r002-history-status").selectOption("已驳回");
  await expect(p.locator("#r002-history-table tbody tr")).toHaveCount(1);
  await nav(p, "entry");
  await t02(p);
  await run(p);
  await expect(p.getByTestId("r002-match-count")).toHaveText("3");
  await expect(p.locator('[data-testid="r002-matches"] tbody tr')).toHaveCount(
    3,
  );
  await expect(p.getByTestId("r002-matches")).toContainText("已撤回，需确认");
  await expect(p.getByTestId("r002-matches")).toContainText("已驳回，需确认");
});
test("20位前导零号码完整显示和持久保存，小数为整数分，负数及超两位小数就地报错", async ({
  page: p,
}) => {
  await open(p);
  await t02(p);
  const number = "00123456789012345678";
  await fields(p, {
    invoiceType: "数电发票",
    invoiceCode: "",
    invoiceNumber: number,
    amountYuan: "100.01",
  });
  await expect(p.locator("[name=invoiceNumber]")).toHaveValue(number);
  expect(
    await p
      .locator("[name=invoiceNumber]")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
  ).toBe(true);
  await run(p);
  await expect(p.getByTestId("r002-invoice-number")).toHaveText(number);
  expect((await data(p)).documents[0].invoice.amountCents).toBe(10001);
  await p.reload();
  await nav(p, "results");
  await expect(p.getByTestId("r002-invoice-number")).toHaveText(number);
  for (const amount of ["-1", "100.001"]) {
    await p.locator("#r002-edit-document").click();
    await fields(p, { amountYuan: amount });
    await run(p);
    await expect(p.locator("#entry-amountYuan-error")).not.toBeEmpty();
    await nav(p, "results");
    await expect(p.getByTestId("r002-auto-result")).toContainText("数据错误");
    await expect(p.getByTestId("r002-match-count")).toHaveText("未执行");
  }
  await nav(p, "library");
  await expect(p.locator("#r002-history-table")).toContainText(number);
  const local = p
    .locator("#r002-history-table tbody tr")
    .filter({ hasText: number });
  await expect(local).toContainText("100.01");
  await expect(local).toContainText("有效v1");
});
test("R001入口及住宿审核保持可用，恢复R002库不清除R001或已审核证据", async ({
  page: p,
}) => {
  await p.goto("/r001.html");
  await p.locator("#r001-load-t03").click();
  await p.locator("#r001-entry-form [type=submit]").click();
  await expect(p.getByTestId("excess")).toHaveText("¥ 300.00");
  const r001 = await p.evaluate(() => localStorage.getItem("qingbao-r001-v1"));
  await p.locator("[data-rule=R002]").click();
  await t02(p);
  await run(p);
  await nav(p, "review");
  await reviewer(p);
  const before = (await data(p)).documents;
  await nav(p, "library");
  p.once("dialog", (d) => d.dismiss());
  await p.locator("#r002-restore-library").click();
  expect((await data(p)).documents).toEqual(before);
  p.once("dialog", (d) => d.accept());
  await p.locator("#r002-restore-library").click();
  expect((await data(p)).documents).toEqual(before);
  expect(await p.evaluate(() => localStorage.getItem("qingbao-r001-v1"))).toBe(
    r001,
  );
  await nav(p, "results");
  await expect(p.getByTestId("human-result")).toContainText("人工驳回");
  await p.locator("[data-rule=R001]").click();
  await p.locator("nav [data-page=results]").click();
  await expect(p.getByTestId("excess")).toHaveText("¥ 300.00");
});
test("审核、复核和历史保存配额失败不覆盖，输入和复核理由保留，重试不丢版本", async ({
  page: p,
}) => {
  await open(p);
  await t02(p);
  await p.evaluate(() => {
    window.r002Set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-r002-v1") throw Error("quota");
      return window.r002Set.call(this, k, v);
    };
  });
  await run(p);
  await expect(p.locator("#r002-entry-error")).toContainText("填写内容保留");
  await expect(p.locator("[name=invoiceNumber]")).toHaveValue("12345678");
  expect(await raw(p)).toBe(null);
  await p.evaluate(() => {
    Storage.prototype.setItem = window.r002Set;
  });
  await run(p);
  await nav(p, "review");
  const before = await raw(p);
  await p.evaluate(() => {
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-r002-v1") throw Error("quota");
      return window.r002Set.call(this, k, v);
    };
  });
  await reviewer(p);
  await expect(p.locator("#r002-review-error")).toContainText("原数据未改动");
  await expect(p.locator("[name=reviewReason]")).toHaveValue(/驳回重复提交/);
  expect(await raw(p)).toBe(before);
  await p.evaluate(() => {
    Storage.prototype.setItem = window.r002Set;
  });
  await p.locator("#r002-review-form [value=rejected]").click();
  await expect(p.getByTestId("human-result")).toContainText("人工驳回");
  await nav(p, "library");
  await p
    .locator("#r002-history-table tbody tr")
    .filter({ hasText: "BX-H001" })
    .getByRole("button", { name: "编辑模拟记录" })
    .click();
  await fields(p, { employeeName: "配额失败保留姓名" }, "#r002-history-form");
  const libraryBefore = await raw(p);
  await p.evaluate(() => {
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-r002-v1") throw Error("quota");
      return window.r002Set.call(this, k, v);
    };
  });
  await p.locator("#r002-history-form [type=submit]").click();
  await expect(p.locator("#r002-history-error")).toContainText("填写内容保留");
  await expect(p.locator("#r002-history-form [name=employeeName]")).toHaveValue(
    "配额失败保留姓名",
  );
  expect(await raw(p)).toBe(libraryBefore);
});
test("保存前读取其他页面修改后的最新库，不用打开页面时的旧历史", async ({
  page: p,
  context,
}) => {
  await open(p);
  const other = await context.newPage();
  await open(other);
  await t02(other);
  await editH001(p, { invoiceCode: "044001999999" });
  await run(other);
  await expect(other.getByTestId("r002-auto-result")).toContainText(
    "通过 R002 查重",
  );
  expect((await data(other)).library[0].invoice.code).toBe("044001999999");
  await other.close();
});
test("坏库仅在证据可保留时恢复，坏JSON不清空，四页390px无溢出及文本转义", async ({
  page: p,
}) => {
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await open(p);
  await t02(p);
  await fields(p, { employeeName: "<img src=x onerror=alert(1)>" });
  await run(p);
  const docs = (await data(p)).documents;
  await p.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.library = "broken";
    localStorage.setItem(k, JSON.stringify(s));
  }, key);
  await p.reload();
  await expect(p.locator("main")).toContainText("原值已保留");
  p.once("dialog", (d) => d.accept());
  await p.locator("#r002-recover-library").click();
  expect((await data(p)).documents).toEqual(docs);
  await p.setViewportSize({ width: 390, height: 844 });
  for (const page of ["entry", "results", "review", "library"]) {
    await nav(p, page);
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(p.locator("main img")).toHaveCount(0);
  await p.evaluate((k) => localStorage.setItem(k, "{broken"), key);
  await p.reload();
  p.once("dialog", (d) => d.accept());
  await p.locator("#r002-recover-library").click();
  await expect(p.locator("main")).toContainText("未执行恢复");
  expect(await raw(p)).toBe("{broken");
  expect(errors).toEqual([]);
});
test("历史填写经搜索筛选后保留，未保存复核切换版本可取消", async ({
  page: p,
}) => {
  await open(p);
  await t02(p);
  await run(p);
  await nav(p, "library");
  await p
    .locator("#r002-history-form [name=employeeName]")
    .fill("尚未保存的模拟姓名");
  await p.locator("#r002-history-search").fill("BX-H001");
  await expect(p.locator("#r002-history-form [name=employeeName]")).toHaveValue(
    "尚未保存的模拟姓名",
  );
  p.once("dialog", (d) => d.dismiss());
  await nav(p, "results");
  await expect(p.locator("#r002-history-form [name=employeeName]")).toHaveValue(
    "尚未保存的模拟姓名",
  );
  p.once("dialog", (d) => d.accept());
  await nav(p, "review");
  await p.locator("[name=reviewReason]").fill("未保存复核原因");
  p.once("dialog", (d) => d.dismiss());
  await nav(p, "results");
  await expect(p.locator("[name=reviewReason]")).toHaveValue("未保存复核原因");
});
