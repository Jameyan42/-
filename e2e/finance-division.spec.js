import { test, expect } from "@playwright/test";
import { defaultOrg } from "../src/organization.js";
import { defaultFlows } from "../src/approval.js";
const nav = (p, name) => p.locator(`[data-page="${name}"]`).click();
const row = (p, name) => p.locator("tbody tr").filter({ hasText: name });
async function publish(p) {
  await p.locator("#role").selectOption("管理员");
  await nav(p, "审批流程");
  await p.locator("#finance-flow-template").click();
  await p
    .locator("[name=publishReason]")
    .fill("按部门总、财务、总账与付款分工");
  await p.locator("#publish-flow").click();
  await expect(p.locator(".toast")).toContainText("已发布");
}
async function claim(p, name, actor = "staff-reporting") {
  await p.locator("#role").selectOption("员工");
  await p.locator("#actor").selectOption(actor);
  await p.locator("#create").click();
  await p.locator("#expense-form [name=name]").fill(name);
  await p.locator("[name=amount]").fill("200");
  await p.locator("[name=note]").fill("虚构新分工验证");
  await p
    .locator("[name=invoice]")
    .fill(name === "旧路径" ? "LEGACY-FIN-001" : "DIVISION-001");
  await p.locator("[name=receipt]").setInputFiles({
    name: "虚构票据.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo"),
  });
  await p.locator("#expense-form button[type=submit]").click();
}
async function approve(p, name, role, actor) {
  await p.locator("#role").selectOption(role);
  await p.locator("#actor").selectOption(actor);
  await nav(p, "审批中心");
  await row(p, name).locator("[data-detail]").click();
  await p.locator("#approve").click();
}
test("CFO 图形树支持节点侧栏编辑、添加下级、折叠缩放与手机画布", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
  await expect(p.locator('[data-org-select="person:cfo-lu"]')).toContainText(
    "CFO",
  );
  await expect(p.locator(".org-tree")).toContainText("法报中心");
  await p.locator('[data-org-select="person:cfo-lu"]').click();
  await expect(p.locator("#org-inspector-form [name=managerId]")).toHaveValue(
    "",
  );
  const initial = await p.locator(".chart-node").count();
  await p.locator('[data-org-collapse="person:cfo-lu"]').click();
  await expect(p.locator(".chart-node")).toHaveCount(1);
  await p.locator("#chart-expand").click();
  await expect(p.locator(".chart-node")).toHaveCount(initial);
  await p.locator('[data-org-select="person:head-reporting"]').click();
  await p.locator("#org-inspector-form [name=title]").fill("法报中心部门总");
  await p.locator("#org-inspector-form button[type=submit]").click();
  await expect(
    p.locator('[data-org-select="person:head-reporting"]'),
  ).toContainText("法报中心部门总");
  await p.locator('[data-org-add="person:head-reporting"]').click();
  await expect(p.locator("#person-form [name=managerId]")).toHaveValue(
    "head-reporting",
  );
  await expect(p.locator("#person-form [name=departmentId]")).toHaveValue(
    "reporting",
  );
  await p.locator("#person-form [name=name]").fill("图形新员工");
  await p.locator("#person-form button[type=submit]").click();
  await expect(p.locator(".org-tree")).toContainText("图形新员工");
  await p.locator("[data-chart-zoom=in]").click();
  await expect(p.locator("#chart-zoom-label")).toHaveText("80%");
  await p.locator("#chart-fit").click();
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.locator("#role").selectOption("员工");
  await expect(p.locator("[data-org-add]")).toHaveCount(0);
  await expect(p.locator("#org-inspector-form")).toHaveCount(0);
});
test("新分工报销依次经过部门总财务总账付款，备份含独立责任与会计信息", async ({
  page: p,
}) => {
  await p.goto("/");
  await publish(p);
  await claim(p, "新分工报销");
  await p.locator("#role").selectOption("主管");
  await nav(p, "审批中心");
  await expect(row(p, "新分工报销")).toHaveCount(0);
  await approve(p, "新分工报销", "主管", "head-reporting");
  await approve(p, "新分工报销", "财务", "finance-zhou");
  await p.locator("#role").selectOption("付款");
  await nav(p, "付款工作台");
  await expect(row(p, "新分工报销")).toHaveCount(0);
  await p.locator("#role").selectOption("总账");
  await nav(p, "审批中心");
  await row(p, "新分工报销").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await expect(p.locator(".toast")).toContainText("总账科目");
  await p.locator("#ledger-account").fill("6602 管理费用");
  await p.locator("#ledger-costcenter").fill("法报中心 / 项目 A");
  await p.locator("#approve").click();
  await expect(row(p, "新分工报销")).toHaveCount(0);
  await p.locator("#role").selectOption("财务");
  await nav(p, "付款工作台");
  await expect(row(p, "新分工报销")).toHaveCount(0);
  await p.locator("#role").selectOption("付款");
  await expect(row(p, "新分工报销")).toContainText("6602 管理费用");
  await row(p, "新分工报销").locator("[data-detail]").click();
  await expect(p.locator(".snapshot")).toContainText("杜川");
  await p.locator("#payment-reference").fill("DEMO-NEW-DIVISION");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await expect(row(p, "新分工报销")).toHaveCount(0);
  await p.locator("[data-payment-filter=已付款]").click();
  await expect(row(p, "新分工报销")).toContainText("DEMO-NEW-DIVISION");
  await p.reload();
  await p.locator("#role").selectOption("付款");
  await nav(p, "付款工作台");
  await p.locator("[data-payment-filter=已付款]").click();
  await expect(row(p, "新分工报销")).toContainText("已付款");
  await nav(p, "数据管理");
  const wait = p.waitForEvent("download");
  await p.locator("#backup").click();
  const file = await wait;
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(await file.path(), "utf8"));
  const d = data.items.find((d) => d.name === "新分工报销");
  expect(d.approval.schema).toBe(2);
  expect(d.approval.paymentActor.actorId).toBe("payer-du");
  expect(d.ledgerReview.account).toBe("6602 管理费用");
  const invalid = structuredClone(data);
  delete invalid.items.find((d) => d.name === "新分工报销").ledgerReview;
  await p.locator("#restore").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await expect(p.locator(".toast")).toContainText("总账复核记录缺失");
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles({
    name: "good.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(p.locator(".toast")).toContainText("备份已恢复");
});
test("旧配置只追加 CFO 示例组织，保留既有人员关系和已发布流程", async ({
  page: p,
}) => {
  await p.goto("/");
  const configuration = { org: defaultOrg(), flows: defaultFlows() };
  await p.evaluate(
    (c) => localStorage.setItem("qingbao-configuration-v1", JSON.stringify(c)),
    configuration,
  );
  await p.reload();
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
  await expect(p.locator("#add-finance-org")).toBeVisible();
  await p.locator("#add-finance-org").click();
  await expect(p.locator(".org-tree")).toContainText("CFO");
  const current = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("qingbao-configuration-v1")),
  );
  expect(current.flows).toEqual(configuration.flows);
  for (const person of configuration.org.people)
    expect(current.org.people.find((x) => x.id === person.id)).toEqual(person);
  await publish(p);
  await expect(p.locator("[name=ledgerId]")).toHaveValue("ledger-gao");
  await expect(p.locator("[name=payerId]")).toHaveValue("payer-du");
});
test("模板仅改草稿，发布不改变原有在途报销，尾节点缺失不能发布", async ({
  page: p,
}) => {
  await p.goto("/");
  await claim(p, "旧路径", "lin");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "审批流程");
  await p.locator("#finance-flow-template").click();
  expect(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("qingbao-configuration-v1") || "null")
          ?.flows.ledgerId,
    ),
  ).toBeUndefined();
  await p.locator("[name=payerId]").selectOption("");
  await p.locator("[name=publishReason]").fill("缺少付款人");
  await p.locator("#publish-flow").click();
  await expect(p.locator(".toast")).toContainText("总账和付款");
  await p.locator("[name=payerId]").selectOption("payer-du");
  await p.locator("#publish-flow").click();
  await expect(p.locator(".toast")).toContainText("已发布");
  await approve(p, "旧路径", "主管", "manager-zhao");
  await p.locator("#role").selectOption("财务");
  await nav(p, "审批中心");
  await row(p, "旧路径").locator("[data-detail]").click();
  await expect(p.locator(".snapshot")).toContainText("v1");
  await expect(p.locator(".snapshot")).not.toContainText("高璇");
  await p.locator("#approve").click();
  await expect(row(p, "旧路径")).toContainText("待付款");
});
test("侧栏编辑阻止循环汇报，部门负责人可从图形节点设置", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
  await p.locator('[data-org-select="person:cfo-lu"]').click();
  await p
    .locator("#org-inspector-form [name=managerId]")
    .selectOption("head-reporting");
  await p.locator("#org-inspector-form button[type=submit]").click();
  await expect(p.locator(".toast")).toContainText("循环");
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-org-mode=departments]").click();
  await p.locator('[data-org-select="department:reporting"]').click();
  await expect(p.locator("#org-inspector-form [name=headId]")).toHaveValue(
    "head-reporting",
  );
  await p.locator("#org-inspector-form button[type=submit]").click();
  await expect(p.locator(".toast")).toContainText("组织已保存");
});
