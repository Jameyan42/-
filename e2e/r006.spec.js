import { test, expect } from "@playwright/test";
import { addMaterials, completeBusiness, samplePdf } from "./r006-helpers.js";
const f = (p, n) => p.locator(`#s001-form [name="${n}"]`),
  inv = (p, n) => p.locator(`[data-invoice] [data-field="${n}"]`).first();
const r6 = (p) => p.locator('[data-rule-key="workflow.approval-materials"]'),
  data = (p) =>
    p.evaluate(() => JSON.parse(localStorage.getItem("qingbao-s001-v1")));
async function create(p, amount = "800", files = true) {
  await p.goto("/?view=claims");
  await p.locator("#role").selectOption("财务");
  await p.locator("#s001-new").click();
  await p.locator("#s001-example").click();
  await f(p, "amountYuan").fill(amount);
  await f(p, "hotelAmountYuan").fill(amount);
  await inv(p, "amountYuan").fill(amount);
  await f(p, "accountStage").selectOption("财务确认");
  await f(p, "accountCode").selectOption("6602.01");
  if (files) await addMaterials(p);
}
async function saveDetail(p) {
  await p.locator("#s001-draft").click();
  await p.locator("[data-detail-s001]").first().click();
}
async function action(p, which, comment) {
  await p.locator("#r006-action-form [name=comment]").fill(comment);
  await p.locator(`#r006-action-form [value="${which}"]`).click();
}
async function role(p, id) {
  await p
    .locator("#role")
    .selectOption(id === "finance-zhou" ? "财务" : "主管");
  await p.locator("#actor").selectOption(id);
}
test("A 正常800：真实文件→具名主管→六规则PASS→财务独立批准→刷新历史", async ({
  page: p,
}) => {
  await create(p);
  await saveDetail(p);
  await completeBusiness(p);
  await expect(p.locator(".s001-rule")).toHaveCount(6);
  await expect(r6(p).locator(">summary")).toContainText("通过");
  await expect(p.locator("[data-r006-sub=approval]")).toContainText("业务审批");
  await expect(p.getByTestId("s001-business")).toHaveText(
    "规则检查通过（待财务确认）",
  );
  await p
    .locator("#s001-review-form [name=reason]")
    .fill("业务审批及材料均已核实");
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.getByTestId("s001-review")).toContainText("财务复核通过");
  await p.reload();
  await p.locator('aside [data-page="审核历史"]').click();
  await p.locator("[data-history-doc]").first().click();
  await expect(r6(p)).toContainText("附件完整性");
  const d = (await data(p)).claims[0];
  expect(d.workflows[0].records).toHaveLength(1);
  expect(d.operations.some((l) => l.type === "财务最终复核")).toBeTruthy();
});
test("B 六异常并存，缺部门审批不被缺附件遮蔽，不能普通财务放行", async ({
  page: p,
}) => {
  await create(p, "1500", false);
  await f(p, "checkOut").fill("2026-10-21");
  await f(p, "accountCode").selectOption("6602.02");
  await inv(p, "type").selectOption("增值税电子普通发票");
  await inv(p, "code").fill("044001900111");
  await inv(p, "number").fill("12345678");
  await inv(p, "amountYuan").fill("1000");
  await inv(p, "buyerName").fill("星河科技（东莞）有限公司");
  await inv(p, "buyerTaxId").fill("DEMO-DG-001");
  await saveDetail(p);
  await action(p, "submit", "提交1500元演示");
  await role(p, "manager-zhao");
  await action(p, "APPROVED", "直属主管同意");
  await role(p, "finance-zhou");
  await p.locator("#r006-audit").click();
  await expect(p.locator(".s001-rule")).toHaveCount(6);
  await expect(p.locator("[data-r006-sub=approval]")).toContainText(
    "部门负责人",
  );
  await expect(p.locator("[data-r006-sub=attachments]")).toContainText(
    "缺少必要附件",
  );
  expect(
    (await data(p)).claims[0].batches.at(-1).results.map((r) => r.status),
  ).toEqual([
    "REVIEW",
    "REVIEW",
    "BLOCK",
    "BLOCK",
    "BLOCK",
    "INSUFFICIENT_DATA",
  ]);
  await p.locator("#s001-review-form [name=reason]").fill("不可跳过");
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.locator("#s001-review-error")).toContainText("不能普通放行");
});
test("C 800已审批后改1500：旧审批失效、新两节点、同角色无权代批", async ({
  page: p,
}) => {
  await create(p);
  await saveDetail(p);
  await completeBusiness(p);
  await p.locator("[data-edit-s001]").click();
  await f(p, "amountYuan").fill("1500");
  await f(p, "hotelAmountYuan").fill("1500");
  await inv(p, "amountYuan").fill("1500");
  await f(p, "changeReason").fill("出差追加住宿费");
  await saveDetail(p);
  await expect(p.locator("#s001-root")).toContainText("需重新提交审批");
  await action(p, "submit", "新金额重新提交");
  await role(p, "head-xu");
  await action(p, "APPROVED", "尝试越过主管");
  await expect(p.locator("#r006-action-error")).toContainText("具名授权");
  p.once("dialog", (d) => d.accept());
  await role(p, "manager-zhao");
  await action(p, "APPROVED", "主管重审通过");
  await role(p, "finance-zhou");
  await p.locator("#r006-audit").click();
  await expect(p.locator("[data-r006-sub=approval]")).toContainText(
    "部门负责人",
  );
  await role(p, "head-xu");
  await action(p, "APPROVED", "部门负责人同意");
  await role(p, "finance-zhou");
  await p.locator("#r006-audit").click();
  await expect(r6(p).locator(">summary")).toContainText("通过");
  const d = (await data(p)).claims[0];
  expect(d.workflows).toHaveLength(2);
  expect(d.workflows[0].records).toHaveLength(1);
  expect(d.workflows[1].records).toHaveLength(2);
  expect(d.batches).toHaveLength(3);
});
test("D 缺文件→补充保存→未核实REVIEW→财务核实→重新审批→历史保留", async ({
  page: p,
}) => {
  await create(p, "800", false);
  await p.locator("#s001-form [type=submit]").click();
  await expect(r6(p)).toContainText("缺少必要附件");
  const old = (await data(p)).claims[0].batches[0];
  await p.locator("[data-edit-s001]").click();
  await addMaterials(p);
  await f(p, "changeReason").fill("补充两份模拟原件");
  await saveDetail(p);
  await completeBusiness(p);
  await expect(r6(p).locator(">summary")).toContainText("通过");
  expect((await data(p)).claims[0].batches[0]).toEqual(old);
  await p.locator("[data-edit-s001]").click();
  await p.locator("[data-material-remove]").first().click();
  await f(p, "changeReason").fill("删除必要原件测试");
  await saveDetail(p);
  await expect(p.locator("#s001-root")).toContainText("需重新提交审批");
  await p.locator("#r006-audit").click();
  await expect(r6(p)).toContainText("缺少必要附件");
});
test("未核实附件不能凭分类通过，人工核查记录不清除审批风险，手机无溢出", async ({
  page: p,
}) => {
  await create(p, "800", false);
  await p.locator("#r006-kind").selectOption("INVOICE");
  await p.locator("#r006-file").setInputFiles(samplePdf);
  await p.locator("[data-material]").waitFor();
  await p.locator("[data-material-links]").selectOption({ index: 0 });
  await p.locator("#r006-kind").selectOption("TRAVEL_APPROVAL");
  await p
    .locator("#r006-file")
    .setInputFiles({ ...samplePdf, name: "示例出差.pdf" });
  await p.locator("[data-material]").nth(1).waitFor();
  await p.locator("#s001-form [type=submit]").click();
  await expect(p.locator("[data-r006-sub=attachments]")).toContainText(
    "内容尚未核实",
  );
  await p
    .locator("#s001-review-form [name=reason]")
    .fill("未完成业务审批和内容核实");
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.locator("#s001-review-error")).toContainText("不能跳过");
  await p.locator("#r004-note [name=note]").fill("请补充原票并完成业务审批");
  await p.locator('#r004-note [value="需补充材料"]').click();
  await expect(r6(p).locator(">summary")).toContainText("需要人工复核");
  await p.setViewportSize({ width: 390, height: 844 });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
test("驳回与退回保留，不能原版本再通过；政策修改历史快照不变", async ({
  page: p,
}) => {
  await create(p);
  await saveDetail(p);
  await action(p, "submit", "开始审批");
  await role(p, "manager-zhao");
  await action(p, "REJECTED", "业务依据不符");
  await action(p, "APPROVED", "企图覆盖驳回");
  await expect(p.locator("#r006-action-error")).toContainText("已结束");
  p.once("dialog", (d) => d.accept());
  await role(p, "finance-zhou");
  await p.locator("#r006-audit").click();
  await expect(p.locator("[data-r006-sub=approval]")).toContainText("驳回");
  const old = (await data(p)).claims[0].batches.at(-1);
  await p.locator('aside [data-page="审核规则"]').click();
  const config = p.locator("#r006-config"),
    c = JSON.parse(await config.locator("[name=config]").inputValue());
  c.approvalPolicies.find((x) => x.policyId === "AP-SZ-LOW").maxAmount = 50000;
  c.approvalPolicies.find((x) => x.policyId === "AP-SZ-HIGH").minAmount = 50001;
  await config.locator("[name=config]").fill(JSON.stringify(c));
  await config.locator("[name=reason]").fill("模拟调整审批阈值");
  await config.locator("button").click();
  await p.reload();
  const s = await data(p);
  expect(s.workflowConfig.version).toBe(2);
  expect(s.claims[0].batches.at(-1)).toEqual(old);
  expect(s.claims[0].workflows[0].config.version).toBe(1);
});
test("多票必须逐票关联，一份PDF明确多选关联可覆盖，旧批次保留缺失", async ({
  page: p,
}) => {
  await create(p);
  await p.locator("#s001-add-invoice").click();
  await p.locator("#s001-form [type=submit]").click();
  await expect(p.locator("[data-r006-sub=attachments]")).toContainText(
    "缺少必要附件",
  );
  const old = (await data(p)).claims[0].batches[0];
  await p.locator("[data-edit-s001]").click();
  await p
    .locator("[data-material-links]")
    .first()
    .selectOption(
      await p
        .locator("[data-material-links]")
        .first()
        .locator("option")
        .evaluateAll((opts) => opts.map((o) => o.value)),
    );
  await f(p, "changeReason").fill("人工将同一多票PDF明确关联两张票面");
  await p.locator("#s001-form [type=submit]").click();
  await expect(p.locator("[data-r006-sub=attachments] h4")).toContainText(
    "通过",
  );
  expect((await data(p)).claims[0].batches[0]).toEqual(old);
});
test("原组织数据损坏时不借用回退组织授权，业务审批暂停但原值保留", async ({
  page: p,
}) => {
  await p.goto("/?view=claims");
  await p.evaluate(() =>
    localStorage.setItem("qingbao-configuration-v1", "BROKEN"),
  );
  await create(p, "800", false);
  await saveDetail(p);
  await action(p, "submit", "不能借回退组织审批");
  await expect(p.locator("#r006-action-error")).toContainText("组织配置异常");
  p.once("dialog", (d) => d.accept());
  await p.locator("#r006-audit").click();
  await expect(p.locator("[data-r006-sub=approval]")).toContainText(
    "组织配置异常",
  );
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-configuration-v1")),
  ).toBe("BROKEN");
});
test("旧五规则历史不追补R006结论，新财务批准须重新审核", async ({
  page: p,
}) => {
  await create(p);
  await saveDetail(p);
  await completeBusiness(p);
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("qingbao-s001-v1")),
      d = s.claims[0],
      b = d.batches[0];
    b.ruleKeys = b.ruleKeys.filter((k) => k !== "workflow.approval-materials");
    b.results = b.results.filter((r) => r.ruleId !== "R006");
    delete b.context.workflow;
    delete b.context.workflowConfig;
    delete b.context.claimRevision;
    delete d.workflows;
    localStorage.setItem("qingbao-s001-v1", JSON.stringify(s));
  });
  await p.reload();
  await p.locator("#role").selectOption("财务");
  await p.locator("[data-detail-s001]").first().click();
  await p
    .locator("#s001-review-form [name=reason]")
    .fill("不能沿用旧批次跳过R006");
  await p.locator("#s001-review-form [value=approved]").click();
  await expect(p.locator("#s001-review-error")).toContainText("未执行R006");
  p.once("dialog", (d) => d.accept());
  await p.locator("#s001-history").click();
  await expect(p.locator("#s001-root")).toContainText("该历史批次未执行R006");
  await expect(p.locator("[data-r006-sub]")).toHaveCount(0);
});
