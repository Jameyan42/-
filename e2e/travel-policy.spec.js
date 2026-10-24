import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { defaultTravelRules } from "../src/travel-policy.js";
const nav = (p, name) => p.locator(`aside [data-page="${name}"]`).click();
const row = (p, name) => p.locator("tbody tr").filter({ hasText: name });
async function who(p, role, actor) {
  await p.locator("#role").selectOption(role);
  if (actor) await p.locator("#actor").selectOption(actor);
}
async function standards(p) {
  await who(p, "财务");
  await nav(p, "差旅标准");
}
async function publish(p, reason = "按虚构企业制度调整差旅标准") {
  await p.locator("[name=travelReason]").fill(reason);
  await p.locator("#travel-policy-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("差旅制度已发布");
}
async function expense(p, name = "差旅规则审核", destination = "上海市") {
  await who(p, "员工", "lin");
  await nav(p, "报销管理");
  await p.locator("#create").click();
  await p.locator("[name=name]").fill(name);
  await p.locator("[name=note]").fill("仅虚构差旅规则场景");
  await p.locator("[name=invoice]").fill(name);
  await p.locator("[name=receipt]").setInputFiles({
    name: "虚构票据.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo"),
  });
  await p.locator("#travel-enabled").check();
  for (const [key, value] of Object.entries({
    origin: "杭州",
    destination,
    start: "2026-10-21",
    end: "2026-10-23",
  }))
    await p.locator(`[data-trip=${key}]`).fill(value);
}
async function line(
  p,
  index,
  category,
  amount,
  units = 1,
  date = "2026-10-21",
) {
  const r = p.locator(".travel-line").nth(index);
  await r.locator("[data-line=category]").selectOption(category);
  await r.locator("[data-line=date]").fill(date);
  await r.locator("[data-line=units]").fill(String(units));
  await r.locator("[data-line=amount]").fill(String(amount));
}
test("财务维护城市档、特例和具体人员职级，员工自动匹配且不能自选高档", async ({
  page: p,
}) => {
  await p.goto("/");
  await standards(p);
  await p.locator('[data-travel-person="chen"]').selectOption("管理人员");
  await p.locator("#travel-add-override").click();
  await p.locator('[data-override="city"]').fill("上海市");
  await p.locator('[data-override="hotel"]').fill("620");
  await p.locator('[data-override="meal"]').fill("120");
  await p.locator('[data-override="local"]').fill("90");
  await publish(p);
  const r = await p.evaluate(
    () => JSON.parse(localStorage.getItem("qingbao-policy")).travelRules,
  );
  expect(r.version).toBe(2);
  expect(r.overrides[0].city).toBe("上海");
  expect(r.employees.find((x) => x.id === "chen").grade).toBe("管理人员");
  await expense(p, "特例标准");
  await expect(p.locator("[data-trip=cityLevel]")).toBeDisabled();
  await expect(p.locator("[data-trip=grade]")).toBeDisabled();
  await expect(p.locator("[data-trip=grade]")).toHaveValue("普通员工");
  await expect(p.locator("#travel-match")).toContainText("住宿620/晚");
  await line(p, 0, "住宿", 1240, 2);
  await expect(p.locator("#travel-checks")).not.toContainText("超额");
  await p.locator("[data-trip=destination]").fill("南京");
  await expect(p.locator("#travel-match")).toContainText("住宿350/晚");
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-close]").click();
  await who(p, "员工", "chen");
  await p.locator("#create").click();
  await p.locator("#travel-enabled").check();
  await p.locator("[data-trip=destination]").fill("上海");
  await expect(p.locator("[data-trip=grade]")).toHaveValue("管理人员");
  await expect(p.locator("#travel-match")).toContainText("住宿700/晚");
});
test("住宿超标拦截保留依据，改制度不追改在途，退回重提按新标准并保存处理快照", async ({
  page: p,
}) => {
  await p.goto("/");
  await standards(p);
  await p.locator('[data-travel-effect="hotel"]').selectOption("block");
  await publish(p);
  await expense(p);
  await line(p, 0, "住宿", 1100, 2);
  await p.locator("#travel-exception").fill("展会涨价，请审核业务必要性");
  await p.locator("#expense-form [type=submit]").click();
  await who(p, "主管");
  await row(p, "差旅规则审核").locator("[data-detail]").click();
  await expect(p.locator(".travel-assessment")).toContainText("100.00");
  await p.locator("#approve").click();
  await who(p, "财务");
  await row(p, "差旅规则审核").locator("[data-detail]").click();
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("住宿超过");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await p.locator("[data-close]").click();
  await nav(p, "差旅标准");
  await p.locator('[data-travel-rate="0"] [data-rate=hotel]').fill("600");
  await publish(p, "新的住宿标准提高至600元每晚");
  await nav(p, "报销管理");
  await row(p, "差旅规则审核").locator("[data-detail]").click();
  await expect(p.locator(".travel-assessment")).toContainText("v2");
  await expect(p.locator(".travel-assessment")).toContainText("500元/晚");
  await p.locator("#reason").fill("退回按新制度核对并重提");
  await p.locator("#reject").click();
  await who(p, "员工");
  await row(p, "差旅规则审核").locator("[data-detail]").click();
  await p.locator("#edit").click();
  await expect(p.locator("#travel-match")).toContainText("住宿600/晚");
  await p.locator("#expense-form [type=submit]").click();
  await who(p, "主管");
  await row(p, "差旅规则审核").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await who(p, "财务");
  await row(p, "差旅规则审核").locator("[data-detail]").click();
  await p.locator("#approve").click();
  const saved = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("qingbao-v1")).find(
      (x) => x.name === "差旅规则审核",
    ),
  );
  expect(saved.travel.standard.version).toBe(3);
  expect(saved.status).toBe("待付款");
  expect(
    saved.history.some(
      (h) =>
        h.precheck?.policy.travelStandard?.version === 2 &&
        h.precheck.findings.some((f) => f.id === "travel-hotel"),
    ),
  ).toBe(true);
  expect(saved.history.at(-1).precheck.policy.travelStandard.hotel).toBe(600);
});
test("市内交通同日合并、餐补超标和缺水单/事前申请均展示核对依据", async ({
  page: p,
}) => {
  await p.goto("/");
  await expense(p, "差旅多风险");
  await line(p, 0, "住宿", 1000, 2);
  for (const [category, amount, units] of [
    ["餐补", 330, 3],
    ["市内交通", 50, 1],
    ["市内交通", 40, 1],
  ]) {
    await p.locator("#travel-add-line").click();
    await line(
      p,
      (await p.locator(".travel-line").count()) - 1,
      category,
      amount,
      units,
    );
  }
  await expect(p.locator("#travel-checks")).toContainText("超额10.00元");
  await p
    .locator("#travel-exception")
    .fill("虚构餐补及交通超标说明，请人工核对");
  await p.locator("#expense-form [type=submit]").click();
  await who(p, "主管");
  await row(p, "差旅多风险").locator("[data-detail]").click();
  const panel = p.locator(".precheck-panel").first();
  for (const value of [
    "餐补超过",
    "市内交通超过",
    "当日合计",
    "超额10.00元",
    "酒店水单",
    "事前费用申请",
  ])
    await expect(panel).toContainText(value);
  await expect(p.locator(".travel-assessment tbody tr")).toHaveCount(3);
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
test("制度发布配额失败保留表单与原值，旧备份保留新制度，坏快照拒绝恢复", async ({
  page: p,
}) => {
  await p.goto("/");
  await standards(p);
  await publish(p);
  const before = await p.evaluate(() => localStorage.getItem("qingbao-policy"));
  await p.locator('[data-travel-rate="0"] [data-rate=hotel]').fill("650");
  await p.locator("[name=travelReason]").fill("验证容量失败不覆盖旧制度");
  await p.evaluate(() => {
    window.originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-policy") throw Error("quota");
      return window.originalSet.call(this, k, v);
    };
  });
  await p.locator("#travel-policy-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("原制度未改动");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-policy"))).toBe(
    before,
  );
  await expect(
    p.locator('[data-travel-rate="0"] [data-rate=hotel]'),
  ).toHaveValue("650");
  await p.evaluate(() => {
    Storage.prototype.setItem = window.originalSet;
  });
  await publish(p, "恢复容量后发布新标准以便备份");
  await expense(p, "差旅备份快照");
  await line(p, 0, "城际交通", 100);
  await p.locator("#expense-form [type=submit]").click();
  await nav(p, "数据管理");
  const download = p.waitForEvent("download");
  await p.locator("#backup").click();
  const backup = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  expect(backup.policy.travelRules.version).toBe(3);
  const old = structuredClone(backup);
  delete old.policy.travelRules;
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "旧制度备份.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect(p.locator(".toast")).toContainText("恢复");
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-policy")).travelRules.version,
    ),
  ).toBe(3);
  await nav(p, "数据管理");
  const bad = structuredClone(backup);
  bad.items.find((x) => x.name === "差旅备份快照").travel.standard.grade =
    "管理人员";
  const itemsBefore = await p.evaluate(() =>
    localStorage.getItem("qingbao-v1"),
  );
  await p.locator("#restore").setInputFiles({
    name: "坏快照.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(p.locator(".toast")).toContainText("快照与行程不一致");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    itemsBefore,
  );
});
test("未维护城市/职级清晰提醒，员工只读，制度编辑切页可取消且手机不溢出", async ({
  page: p,
}) => {
  await p.goto("/");
  await standards(p);
  await p.locator('[data-travel-person="lin"]').selectOption("");
  await publish(p);
  await p.locator('[data-travel-rate="0"] [data-rate=hotel]').fill("888");
  p.once("dialog", (d) => d.dismiss());
  await nav(p, "工作台");
  await expect(p.locator("#travel-policy-form")).toBeVisible();
  await expect(
    p.locator('[data-travel-rate="0"] [data-rate=hotel]'),
  ).toHaveValue("888");
  p.once("dialog", (d) => d.accept());
  await who(p, "员工");
  await expect(
    p.locator('[data-travel-rate="0"] [data-rate=hotel]'),
  ).toBeDisabled();
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await expense(p, "未维护差旅", "未建城<img src=x>");
  await line(p, 0, "城际交通", 100);
  await p.locator("#expense-form [type=submit]").click();
  await row(p, "未维护差旅").locator("[data-detail]").click();
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "目的地未维护",
  );
  await expect(p.locator(".precheck-panel").first()).toContainText(
    "尚未维护职级",
  );
  await expect(p.locator(".travel-assessment img")).toHaveCount(0);
});

test("损坏差旅制度保留原值并暂停提交，坏快照可查看异常并阻止财务通过", async ({
  page: p,
}) => {
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("/");
  await expense(p, "坏快照保护");
  await line(p, 0, "城际交通", 100);
  await p.locator("#expense-form [type=submit]").click();
  await who(p, "主管");
  await row(p, "坏快照保护").locator("[data-detail]").click();
  await p.locator("#approve").click();
  const r = defaultTravelRules();
  r.rates[0].hotel = -1;
  const badPolicy = JSON.stringify({
    limit: 3000,
    requireReceipt: true,
    checkDuplicate: true,
    travelRules: r,
  });
  await p.evaluate(
    (raw) => localStorage.setItem("qingbao-policy", raw),
    badPolicy,
  );
  await p.reload();
  await standards(p);
  await expect(p.locator("main")).toContainText("规则存储异常");
  await expect(
    p.locator('[data-travel-rate="0"] [data-rate=hotel]'),
  ).toBeDisabled();
  expect(await p.evaluate(() => localStorage.getItem("qingbao-policy"))).toBe(
    badPolicy,
  );
  await expense(p, "坏制度不新增");
  await line(p, 0, "城际交通", 100);
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.locator("#expense-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("差旅提交/草稿暂停");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await p.evaluate(() => {
    localStorage.setItem(
      "qingbao-policy",
      JSON.stringify({
        limit: 3000,
        requireReceipt: true,
        checkDuplicate: true,
      }),
    );
    const items = JSON.parse(localStorage.getItem("qingbao-v1"));
    items.find((x) => x.name === "坏快照保护").travel.standard.hotel = -1;
    localStorage.setItem("qingbao-v1", JSON.stringify(items));
  });
  await p.reload();
  await who(p, "财务");
  await nav(p, "报销管理");
  await row(p, "坏快照保护").locator("[data-detail]").click();
  await expect(p.locator(".modal")).toContainText("差旅数据或标准快照异常");
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("快照无效");
  expect(errors).toEqual([]);
});
