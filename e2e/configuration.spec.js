import { test, expect } from "@playwright/test";
const nav = (p, n) => p.locator(`[data-page="${n}"]`).click();
const row = (p, n) => p.locator("tbody tr").filter({ hasText: n });
async function request(p, name, amount = "4000") {
  await p.locator("#role").selectOption("员工");
  await nav(p, "费用申请");
  await p.locator("#new-request").click();
  await p.locator("#request-form [name=name]").fill(name);
  await p.locator("#request-form [name=amount]").fill(amount);
  await p.locator("#request-form [name=note]").fill("虚构费用用于测试审批树");
  await p.locator("#request-form button[type=submit]").click();
  await expect(row(p, name)).toContainText("待审批");
}
async function editPerson(p, id, manager) {
  await p.locator(`[data-edit-person="${id}"]`).click();
  await p.locator("#person-form [name=managerId]").selectOption(manager);
  await p.locator("#person-form button[type=submit]").click();
}
test("申请条件分支逐人审批，同角色不能越权，全部通过后才预留预算", async ({
  page: p,
}) => {
  await p.goto("/");
  await request(p, "多级申请");
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("head-xu");
  await row(p, "多级申请").locator("[data-request]").click();
  await expect(p.locator(".snapshot")).toContainText("赵航");
  await expect(p.locator("[data-request-action=approve]")).toHaveCount(0);
  await p.locator("[data-close]").click();
  await p.locator("#actor").selectOption("manager-zhao");
  await row(p, "多级申请").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await expect(row(p, "多级申请")).toContainText("待审批");
  await expect(row(p, "多级申请")).toContainText("许明");
  await nav(p, "预算管理");
  await expect(
    p
      .locator(".budget-card")
      .first()
      .locator("dl>div")
      .filter({ hasText: "申请剩余预留" }),
  ).toContainText("0.00");
  await nav(p, "费用申请");
  await p.locator("#actor").selectOption("head-xu");
  await row(p, "多级申请").locator("[data-request]").click();
  await p.locator("[data-request-action=approve]").click();
  await expect(row(p, "多级申请")).toContainText("已批准");
  await nav(p, "预算管理");
  await expect(
    p
      .locator(".budget-card")
      .first()
      .locator("dl>div")
      .filter({ hasText: "申请剩余预留" }),
  ).toContainText("4,000.00");
});
test("组织汇报调整只影响新提交，循环被拒，树在手机上无整页溢出", async ({
  page: p,
}) => {
  await p.goto("/");
  await request(p, "旧汇报申请", "1000");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
  await editPerson(p, "head-xu", "manager-zhao");
  await expect(p.locator(".toast")).toContainText("循环");
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-close]").click();
  await editPerson(p, "lin", "head-xu");
  await expect(p.locator(".toast")).toContainText("组织已保存");
  await p.locator("[data-org-mode=reports]").click();
  await expect(p.locator(".org-tree")).toContainText("林晓");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await request(p, "新汇报申请", "1000");
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("manager-zhao");
  await row(p, "旧汇报申请").locator("[data-request]").click();
  await expect(p.locator("[data-request-action=approve]")).toHaveCount(1);
  await p.locator("[data-close]").click();
  await row(p, "新汇报申请").locator("[data-request]").click();
  await expect(p.locator("[data-request-action=approve]")).toHaveCount(0);
  await expect(p.locator(".snapshot")).toContainText("许明");
});
test("流程草稿、试算、发布版本与历史快照互不混淆，非管理员看已发布版", async ({
  page: p,
}) => {
  await p.goto("/");
  await request(p, "版本一申请", "4000");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "审批流程");
  await p.locator("[data-flow-target=request]").click();
  await p.locator("[name=threshold]").fill("5000");
  await p.locator("#save-flow-draft").click();
  await expect(p.locator(".toast")).toContainText("草稿已保存");
  await p.locator("#test-route").click();
  await expect(p.locator("#route-output")).toContainText("默认分支");
  await p.locator("#role").selectOption("员工");
  await expect(p.locator("[name=threshold]")).toHaveValue("3000");
  await expect(p.locator("#publish-flow")).toHaveCount(0);
  await p.locator("#test-route").click();
  await expect(p.locator("#route-output")).toContainText("条件分支");
  await p.locator("#role").selectOption("管理员");
  await expect(p.locator("[name=threshold]")).toHaveValue("5000");
  await p.locator("#publish-flow").click();
  await expect(p.locator(".toast")).toContainText("发布原因");
  await p.locator("[name=publishReason]").fill("调整大额审批阈值");
  await p.locator("#publish-flow").click();
  await expect(p.locator(".toast")).toContainText("已发布 v2");
  await request(p, "版本二申请", "4000");
  await row(p, "版本二申请").locator("[data-request]").click();
  await expect(p.locator(".snapshot")).toContainText("v2");
  await expect(p.locator(".snapshot li")).toHaveCount(1);
  await p.locator("[data-close]").click();
  await row(p, "版本一申请").locator("[data-request]").click();
  await expect(p.locator(".snapshot")).toContainText("v1");
  await expect(p.locator(".snapshot li")).toHaveCount(2);
  await p.locator("[data-close]").click();
  await p.reload();
  await p.locator("#role").selectOption("管理员");
  await nav(p, "审批流程");
  await p.locator("[data-flow-target=request]").click();
  await expect(p.locator("[name=threshold]")).toHaveValue("5000");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
test("新增部门主管负责人及员工，预算默认为零且新身份可提交申请", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
  await p.locator("#add-department").click();
  await p.locator("#department-form [name=name]").fill("市场部");
  await p.locator("#department-form button[type=submit]").click();
  await expect(p.locator(".org-tree")).toContainText("市场部");
  const departmentId = await p.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("qingbao-configuration-v1"),
      ).org.departments.find((d) => d.name === "市场部").id,
  );
  await p.locator("#add-person").click();
  await p.locator("#person-form [name=name]").fill("测试主管");
  await p
    .locator("#person-form [name=departmentId]")
    .selectOption(departmentId);
  await p.locator("#person-form [name=role]").selectOption("主管");
  await p.locator("#person-form button[type=submit]").click();
  const managerId = await p.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("qingbao-configuration-v1"),
      ).org.people.find((d) => d.name === "测试主管").id,
  );
  await p.locator(`[data-edit-department="${departmentId}"]`).click();
  await p.locator("[name=headId]").selectOption(managerId);
  await p.locator("#department-form button[type=submit]").click();
  await p.locator("#add-person").click();
  await p.locator("#person-form [name=name]").fill("测试员工");
  await p
    .locator("#person-form [name=departmentId]")
    .selectOption(departmentId);
  await p.locator("#person-form [name=managerId]").selectOption(managerId);
  await p.locator("#person-form button[type=submit]").click();
  const employeeId = await p.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("qingbao-configuration-v1"),
      ).org.people.find((d) => d.name === "测试员工").id,
  );
  await nav(p, "预算管理");
  await expect(
    p.locator(".budget-card").filter({ hasText: "市场部" }),
  ).toContainText("未设置额度");
  await p.locator("#role").selectOption("员工");
  await p.locator("#actor").selectOption(employeeId);
  await request(p, "新部门申请", "4000");
  await row(p, "新部门申请").locator("[data-request]").click();
  await expect(p.locator(".snapshot li")).toHaveCount(1);
  await expect(p.locator(".snapshot")).toContainText("测试主管");
  await expect(p.locator(".modal")).toContainText("测试员工");
});
test("备份包含组织流程快照，旧备份保留当前配置，损坏快照导入被拒", async ({
  page: p,
}) => {
  await p.goto("/");
  await request(p, "备份快照", "1000");
  await nav(p, "数据管理");
  const wait = p.waitForEvent("download");
  await p.locator("#backup").click();
  const file = await wait;
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(data.configuration.flows.version).toBe(1);
  expect(data.requests[0].approval.nodes[0].actorId).toBe("manager-zhao");
  const restore = async (data) =>
    p
      .locator("#restore")
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(data)),
      });
  const invalid = structuredClone(data);
  invalid.requests[0].approval.cursor = 1;
  await restore(invalid);
  await expect(p.locator(".toast")).toContainText("不一致");
  const legacy = structuredClone(data);
  delete legacy.configuration;
  delete legacy.requests;
  p.once("dialog", (d) => d.accept());
  await restore(legacy);
  await expect(p.locator(".toast")).toContainText("备份已恢复");
  await nav(p, "费用申请");
  await expect(row(p, "备份快照")).toContainText("待审批");
  await p.evaluate(() =>
    localStorage.setItem("qingbao-configuration-v1", "{broken"),
  );
  await p.reload();
  await nav(p, "数据管理");
  await p.locator("#backup").click();
  await expect(p.locator(".toast")).toContainText("组织/流程");
  p.once("dialog", (d) => d.accept());
  await restore(data);
  await expect(p.locator(".toast")).toContainText("备份已恢复");
});
test("指定人员报销流程发布后完成逐人审批付款，在途人员不可停用", async ({
  page: p,
}) => {
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "审批流程");
  await p.locator("[name=threshold]").fill("1000");
  await p.locator("[data-selector=high-1]").selectOption("person");
  await p.locator("[data-person=high-1]").selectOption("head-liang");
  await p.locator("[name=publishReason]").fill("跨部门项目增加指定审核人");
  await p.locator("#publish-flow").click();
  await expect(p.locator(".toast")).toContainText("已发布 v2");
  await p.locator("#role").selectOption("员工");
  await p.locator("#create").click();
  await p.locator("#expense-form [name=name]").fill("树形流程报销");
  await p.locator("[name=amount]").fill("2000");
  await p.locator("[name=note]").fill("虚构审批路径验收");
  await p.locator("[name=invoice]").fill("TREE-001");
  await p
    .locator("[name=receipt]")
    .setInputFiles({
      name: "虚构附件.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo"),
    });
  await p.locator("#expense-form button[type=submit]").click();
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
  await editPerson(p, "lin", "head-xu");
  await p.locator("[data-edit-person=manager-zhao]").click();
  await p.locator("[name=active]").uncheck();
  await p.locator("#person-form button[type=submit]").click();
  await expect(p.locator(".toast")).toContainText("在途");
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-close]").click();
  await nav(p, "审批中心");
  await p.locator("#role").selectOption("主管");
  await p.locator("#actor").selectOption("manager-zhao");
  await row(p, "树形流程报销").locator("[data-detail]").click();
  await expect(p.locator(".snapshot")).toContainText("梁悦");
  await p.locator("#approve").click();
  await expect(row(p, "树形流程报销")).toHaveCount(0);
  await p.locator("#actor").selectOption("head-liang");
  await row(p, "树形流程报销").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await p.locator("#role").selectOption("财务");
  await row(p, "树形流程报销").locator("[data-detail]").click();
  await p.locator("#approve").click();
  await row(p, "树形流程报销").locator("[data-detail]").click();
  await p.locator("#payment-reference").fill("DEMO-TREE-001");
  await p.locator("#payment-confirm").check();
  await p.locator("#approve").click();
  await nav(p, "报销管理");
  await row(p, "树形流程报销").locator("[data-detail]").click();
  await expect(p.locator(".modal")).toContainText("已付款");
  await expect(p.locator(".snapshot .done")).toHaveCount(3);
});
