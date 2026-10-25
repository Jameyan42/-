import { test, expect } from "@playwright/test";
const nav = (p, n) => p.locator(`nav [data-page=${n}]`).click();
const data = (p) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("qingbao-r003-v1")));
async function t04(p) {
  await p.goto("/r003.html");
  await p.locator("#example").click();
  await p.locator("#entry .primary").click();
}
test("T04阶段超5000→人工驳回→刷新原自动保留，不产生已支付", async ({
  page: p,
}) => {
  await t04(p);
  await expect(p.getByTestId("auto")).toContainText("5,000.00");
  await expect(p.getByTestId("auto")).toContainText("需要人工复核");
  const initial = await data(p);
  await nav(p, "review");
  await p.locator("#review [value=rejected]").click();
  await expect(p.locator("#review-error")).toContainText("请填写");
  await p.locator("[name=reviewer]").fill("财务（模拟）");
  await p
    .locator("[name=reason]")
    .fill("本次付款超过合同第二阶段可付款限额5000元，暂不予通过");
  await p.locator("#review [value=rejected]").click();
  await expect(p.getByTestId("human-result")).toContainText("人工驳回");
  const next = await data(p);
  expect(next.payments).toEqual(initial.payments);
  expect(next.documents[0].audits[0].automatic).toEqual(
    initial.documents[0].audits[0].automatic,
  );
  await p.reload();
  await nav(p, "results");
  await expect(p.getByTestId("human-result")).toContainText("暂不予通过");
});
test("合同管理变更证据，新版本多风险，旧版通过结论不变；恢复隔离", async ({
  page: p,
}) => {
  await p.goto("/r003.html");
  await p.locator("#example").click();
  await p.locator("[name=amountYuan]").fill("25000");
  await p.locator("#entry .primary").click();
  await expect(p.getByTestId("auto")).toContainText("通过 R003");
  const before = await data(p);
  await p.evaluate(() => {
    localStorage.setItem("qingbao-r001-v1", "sentinel1");
    localStorage.setItem("qingbao-r002-v1", "sentinel2");
  });
  await nav(p, "manage");
  await p.locator("[data-contract=HT-002]").click();
  const ev = JSON.parse(
    await p.locator("#contract [name=evidence]").inputValue(),
  );
  ev.find((x) => x.id === "delivery").status = "无效";
  await p.locator("#contract [name=evidence]").fill(JSON.stringify(ev));
  await p.locator("#contract .primary").click();
  await nav(p, "results");
  await p.locator("#reaudit").click();
  await p.locator("#entry .primary").click();
  await expect(p.getByTestId("auto")).toContainText("无效");
  expect((await data(p)).documents[0].audits[0]).toEqual(
    before.documents[0].audits[0],
  );
  await nav(p, "review");
  await p.locator("[name=reviewer]").fill("财务");
  await p.locator("[name=reason]").fill("人工核查模拟证明后例外批准");
  await p.locator("#review [value=approved]").click();
  await expect(p.getByTestId("human-result")).toContainText("人工通过");
  await nav(p, "manage");
  const docs = (await data(p)).documents;
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").click();
  expect((await data(p)).documents).toEqual(docs);
  expect(await p.evaluate(() => localStorage.getItem("qingbao-r001-v1"))).toBe(
    "sentinel1",
  );
  expect(await p.evaluate(() => localStorage.getItem("qingbao-r002-v1"))).toBe(
    "sentinel2",
  );
});
test("新增合同与付款、重复阶段阻止、刷新及手机四区", async ({ page: p }) => {
  await p.goto("/r003.html");
  await nav(p, "manage");
  await p.locator("#contract [name=name]").fill("模拟新合同");
  await p.locator("#contract [name=supplier]").fill("模拟供应商");
  await p.locator("#contract [name=total]").fill("100.01");
  await p.locator("#contract .primary").click();
  await expect(p.locator(".feedback")).toContainText("已保存");
  const c = (await data(p)).contracts.at(-1);
  expect(c.totalCents).toBe(10001);
  await p.locator("#payment [name=contractId]").selectOption(c.id);
  await p.locator("#payment [name=amount]").fill("0.01");
  await p.locator("#payment .primary").click();
  expect((await data(p)).payments.at(-1).amountCents).toBe(1);
  await p.reload();
  await nav(p, "manage");
  await p.locator("[data-contract=HT-002]").click();
  await p
    .locator("#contract [name=stages]")
    .fill('[{"id":"X","name":"错","basisPoints":3000,"requirements":[]}]');
  await p.locator("#contract .primary").click();
  await expect(p.locator("#contract .error")).toContainText("100%");
  await p
    .locator("#contract [name=stages]")
    .fill(
      JSON.stringify(
        (await data(p)).contracts.find((c) => c.id === "HT-002").stages,
      ),
    );
  await p.locator("#contract .primary").click();
  await p.setViewportSize({ width: 390, height: 844 });
  for (const n of ["entry", "results", "review", "manage"]) {
    await nav(p, n);
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
