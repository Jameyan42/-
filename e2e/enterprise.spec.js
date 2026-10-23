import { test, expect } from "@playwright/test";
import { enterpriseOrg } from "../src/organization.js";
import { defaultFlows, financeDivisionFlows } from "../src/approval.js";
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
const form = (p) => p.locator("#enterprise-form");
const submit = (p) => form(p).locator('[type="submit"]').click();
const org = enterpriseOrg(),
  flows = financeDivisionFlows(defaultFlows(), org),
  who = (id) => org.people.find((p) => p.id === id);
const supplier = {
  name: "远帆服务有限公司（虚构）",
  creditCode: "DEMO-CREDIT-001",
  accountName: "远帆服务有限公司（虚构）",
  bankName: "演示银行",
  bankAccount: "DEMO-SUPPLIER-001",
  active: true,
};
function seeded() {
  let s = saveSupplier(emptyEnterprise(), supplier, who("admin-gu"));
  s = saveContract(
    s,
    {
      title: "虚构会务服务",
      number: "HT-DEMO-001",
      supplierId: s.suppliers[0].id,
      amount: 10000,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      text: demoContractText,
    },
    who("lin"),
    org,
  );
  return reviewContract(s, s.contracts[0].id, who("finance-zhou"), {
    approve: true,
    confirmed: true,
    note: "已核对全文、开票及验收后付款",
  });
}
async function setup(p, s = seeded(), role = "员工") {
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
  await p.locator("#role").selectOption(role);
  await nav(p, "对公支付单");
}
async function newPayment(p, amount = "4000", name = "虚构会务尾款") {
  await p.locator("#enterprise-create").click();
  await form(p)
    .locator("[name=contractId]")
    .selectOption({ label: "HT-DEMO-001 · 虚构会务服务" });
  await form(p).locator("[name=name]").fill(name);
  await form(p).locator("[name=amount]").fill(amount);
  await form(p)
    .locator("[name=note]")
    .fill("虚构服务已经验收及核对发票，演示申请付款");
  await submit(p);
}
const open = (p) => p.locator("[data-enterprise-open]").first().click();
const state = (p) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("qingbao-enterprise-v1")));
test("实际新建供应商与合同、人工复核、对公审批总账及模拟付款全链路", async ({
  page: p,
}) => {
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "供应商管理");
  await p.locator("#enterprise-create").click();
  for (const [name, value] of Object.entries(supplier).filter(
    ([k]) => k !== "active",
  ))
    await form(p).locator(`[name=${name}]`).fill(value);
  await submit(p);
  await expect(p.locator("tbody")).toContainText(supplier.name);
  await nav(p, "审批流程");
  await p.locator("#finance-flow-template").click();
  await p.locator("[name=publishReason]").fill("演示对公支付的财务分工");
  await p.locator("#publish-flow").click();
  await p.locator("#role").selectOption("员工");
  await nav(p, "合同审查");
  await p.locator("#enterprise-create").click();
  await form(p)
    .locator("[name=supplierId]")
    .selectOption({ label: supplier.name });
  await form(p).locator("[name=number]").fill("HT-DEMO-001");
  await form(p).locator("[name=title]").fill("虚构会务服务");
  await p.locator("#contract-sample").click();
  await p.locator("#contract-preview").click();
  await expect(p.locator("#contract-preview-result")).toContainText(
    "当前规则未命中",
  );
  await expect(
    form(p).getByRole("button", { name: "AI 审查 · 尚未连接" }),
  ).toBeDisabled();
  await submit(p);
  await p.locator("#role").selectOption("财务");
  await open(p);
  await form(p)
    .locator("[name=note]")
    .fill("已核对合同全文、主体、验收及开票后付款条款");
  await form(p).locator("[name=confirmed]").check();
  await submit(p);
  await p.locator("#role").selectOption("员工");
  await nav(p, "对公支付单");
  await newPayment(p);
  await expect(p.locator("tbody")).toContainText("待主管审批");
  for (const role of ["主管", "财务", "总账", "付款"]) {
    await p.locator("#role").selectOption(role);
    if (role === "主管") await p.locator("#actor").selectOption("head-xu");
    await open(p);
    if (role === "总账") {
      await submit(p);
      await expect(p.locator("#enterprise-error")).toContainText("总账");
      await form(p).locator("[name=account]").fill("6602服务费");
      await form(p).locator("[name=costCenter]").fill("销售部");
    }
    if (role === "付款") {
      await expect(p.locator(".modal")).toContainText("DEMO-SUPPLIER-001");
      await form(p).locator("[name=reference]").fill("DEMO-CORPORATE-001");
      await form(p).locator("[name=confirmed]").check();
    }
    await submit(p);
  }
  await expect(p.locator("tbody")).toContainText("已付款");
  const s = await state(p);
  expect(s.payments[0].payment.reference).toBe("DEMO-CORPORATE-001");
  expect(s.payments[0].history).toHaveLength(5);
  expect(s.contracts[0].review.role).toBe("财务");
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "合同审查");
  await expect(p.locator("tbody")).toContainText("6,000.00");
  expect(errors).toEqual([]);
});
test("超额保持表单、退回释额及重提、更换身份隔离与收款快照", async ({
  page: p,
}) => {
  await setup(p);
  await newPayment(p, "12000");
  await expect(p.locator("#enterprise-error")).toContainText("额度");
  expect((await state(p)).payments).toHaveLength(0);
  await form(p).locator("[name=amount]").fill("4000");
  await submit(p);
  await p.locator("#actor").selectOption("staff-tax");
  await expect(p.locator("tbody")).not.toContainText("虚构会务尾款");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "供应商管理");
  await open(p);
  await form(p).locator("[name=bankAccount]").fill("DEMO-NEW-ACCOUNT");
  await submit(p);
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("head-xu");
  await nav(p, "对公支付单");
  await open(p);
  await expect(p.locator(".modal")).toContainText("DEMO-SUPPLIER-001");
  await form(p).locator("[name=action]").selectOption("reject");
  await form(p).locator("[name=note]").fill("付款用途需补充");
  await submit(p);
  await p.locator("#role").selectOption("员工");
  await p.locator("#actor").selectOption("lin");
  await nav(p, "合同审查");
  await expect(p.locator("tbody")).toContainText("10,000.00");
  await nav(p, "对公支付单");
  await open(p);
  await expect(p.locator(".modal")).toContainText("付款用途需补充");
  await p.locator("#corporate-edit").click();
  await form(p).locator("[name=note]").fill("补充服务用途后重提");
  await submit(p);
  expect((await state(p)).payments[0].supplierSnapshot.bankAccount).toBe(
    "DEMO-NEW-ACCOUNT",
  );
});
test("新备份含合同对公、旧备份保留、坏格式及写入失败不覆盖", async ({
  page: p,
}) => {
  await setup(p);
  await newPayment(p);
  const before = await state(p);
  await nav(p, "数据管理");
  const dl = p.waitForEvent("download");
  await p.locator("#backup").click();
  const file = await dl;
  const fs = await import("node:fs/promises");
  const backup = JSON.parse(await fs.readFile(await file.path(), "utf8"));
  expect(backup.enterprise).toEqual(before);
  await p.evaluate(() => localStorage.removeItem("qingbao-enterprise-v1"));
  await p.reload();
  await nav(p, "数据管理");
  p.on("dialog", (d) => d.accept());
  await p
    .locator("#restore")
    .setInputFiles({
      name: "full.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(p.locator(".toast")).toContainText("已恢复");
  expect(await state(p)).toEqual(before);
  const old = structuredClone(backup);
  delete old.enterprise;
  await p.locator("#restore").setInputFiles({
    name: "old.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect(p.locator(".toast")).toContainText("已恢复");
  expect(await state(p)).toEqual(before);
  const bad = structuredClone(backup);
  bad.enterprise.payments[0].amount = 20000;
  await p.locator("#restore").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(p.locator(".toast")).toContainText("导入失败");
  expect(await state(p)).toEqual(before);
  await p.locator("#role").selectOption("员工");
  await nav(p, "对公支付单");
  await p.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "qingbao-enterprise-v1")
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, k, v);
    };
  });
  await newPayment(p, "100", "容量失败单");
  await expect(p.locator("#enterprise-error")).toContainText("原数据未改动");
  expect(await state(p)).toEqual(before);
  await expect(form(p).locator("[name=name]")).toHaveValue("容量失败单");
});
test("合同导入 TXT、风险证据转义及需修改后版本重提", async ({ page: p }) => {
  const s = seeded();
  s.contracts[0].status = "待复核";
  delete s.contracts[0].review;
  await setup(p, s);
  await nav(p, "合同审查");
  await open(p);
  await p.locator("#contract-edit").click();
  const text = `乙方：${supplier.name}。全额预付。无限责任。单方解除。<img src=x onerror=alert(1)>`;
  await p.locator("#contract-text-file").setInputFiles({
    name: "demo.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await expect(form(p).locator("[name=text]")).toHaveValue(text);
  await p.locator("#contract-preview").click();
  await expect(p.locator("#contract-preview-result")).toContainText(
    "全额预付风险",
  );
  await expect(p.locator("#contract-preview-result img")).toHaveCount(0);
  await submit(p);
  await p.locator("#role").selectOption("财务");
  await open(p);
  await form(p).locator("[name=note]").fill("预付与责任条款需修改");
  await form(p).locator("[name=confirmed]").check();
  await form(p).locator("[name=decision]").selectOption("return");
  await submit(p);
  await expect(p.locator("tbody")).toContainText("需修改");
  await p.locator("#role").selectOption("员工");
  await open(p);
  await p.locator("#contract-edit").click();
  await p.locator("#contract-sample").click();
  await submit(p);
  expect((await state(p)).contracts[0].version).toBe(3);
  expect((await state(p)).contracts[0].review).toBeUndefined();
});
test("企业损坏存储保留、配置与报销付款不可绕过跨业务核对", async ({
  page: p,
}) => {
  await setup(p);
  await p.evaluate(() =>
    localStorage.setItem("qingbao-enterprise-v1", "{broken-enterprise"),
  );
  await p.reload();
  await nav(p, "对公支付单");
  await expect(p.locator("main")).toContainText("原始值已保留");
  await expect(p.locator("#enterprise-create")).toHaveCount(0);
  await nav(p, "数据管理");
  await p.locator("#backup").click();
  await expect(p.locator(".toast")).toContainText("企业业务存储异常");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-enterprise-v1")),
  ).toBe("{broken-enterprise");
});
test("对公筛选分页 CSV覆盖全部匹配，390px布局及只读管理员", async ({
  page: p,
}) => {
  let s = seeded();
  for (let i = 0; i < 12; i++)
    s = submitCorporate(
      s,
      {
        name: `分页演示${i}`,
        contractId: s.contracts[0].id,
        amount: 100,
        date: "2026-10-23",
        note: "虚构付款",
      },
      who("lin"),
      org,
      flows,
    );
  await setup(p, s, "管理员");
  await expect(p.locator("tbody tr")).toHaveCount(10);
  await expect(p.locator("#enterprise-create")).toHaveCount(0);
  await p.locator('[data-enterprise-page="1"]').click();
  await expect(p.locator("tbody tr")).toHaveCount(2);
  const dl = p.waitForEvent("download");
  await p.locator("#enterprise-export").click();
  const fs = await import("node:fs/promises");
  const body = await fs.readFile(await (await dl).path(), "utf8");
  expect(body.trim().split("\r\n")).toHaveLength(13);
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(p.locator("h1")).toContainText("对公支付单");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.locator("#enterprise-search").fill("没有这笔");
  await expect(p.locator("tbody")).toContainText("暂无符合");
});

test("报销单笔及批量付款与对公已付参考号双向判重", async ({ page: p }) => {
  let s = seeded();
  s = submitCorporate(
    s,
    {
      name: "已付对公演示",
      contractId: s.contracts[0].id,
      amount: 100,
      date: "2026-10-23",
      note: "虚构服务付款",
    },
    who("lin"),
    org,
    flows,
  );
  const id = s.payments[0].id;
  while (s.payments[0].status !== "待付款") {
    const n = s.payments[0].approval.nodes[s.payments[0].approval.cursor];
    s = actCorporate(s, id, who(n.actorId), "approve", {
      ledgerReview: { account: "服务费", costCenter: "销售部" },
    });
  }
  s = actCorporate(s, id, who("payer-du"), "approve", {
    payment: {
      date: "2026-10-23",
      method: "银行转账",
      reference: "DEMO-DUP-001",
      confirmed: true,
    },
  });
  await setup(p, s, "财务");
  await nav(p, "付款工作台");
  const before = await p.evaluate(() => localStorage.getItem("qingbao-v1"));
  await p.locator('[data-detail="BX202610003"]').click();
  await p.locator("#payment-reference").fill(" demo-dup-001 ");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("已使用");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  await p.locator("[data-close]").click();
  await p.locator("#payment-select-all").click();
  await p.locator("#payment-batch").click();
  await p.locator("#batch-payment-form [name=prefix]").fill("DEMO-DUP");
  await p.locator("#batch-payment-form [name=confirmed]").check();
  await p.locator("#batch-payment-form [type=submit]").click();
  await expect(p.locator(".toast")).toContainText("已使用");
  expect(await p.evaluate(() => localStorage.getItem("qingbao-v1"))).toBe(
    before,
  );
  expect(await state(p)).toEqual(s);
});
