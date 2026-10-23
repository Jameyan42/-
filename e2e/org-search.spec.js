import { test, expect } from "@playwright/test";
import { enterpriseOrg } from "../src/organization.js";
import { defaultFlows } from "../src/approval.js";
const nav = (p, name) => p.locator(`[data-page="${name}"]`).click();
const result = (p, key) =>
  p.locator(".org-search-results").locator(`[data-org-locate="${key}"]`);
async function start(p) {
  await p.goto("/");
  await p.locator("#role").selectOption("管理员");
  await nav(p, "组织架构");
}
test("搜索折叠下级自动展开、定位和显示路径，清除不改组织", async ({
  page: p,
}) => {
  await start(p);
  const before = await p.evaluate(() =>
    localStorage.getItem("qingbao-configuration-v1"),
  );
  await p.locator('[data-org-collapse="person:cfo-lu"]').click();
  await expect(p.locator(".chart-node")).toHaveCount(1);
  await p.locator("#org-search").fill("叶禾");
  await expect(p.locator("#org-search-status")).toContainText("找到 1");
  await result(p, "person:staff-reporting").click();
  await expect(p.locator(".chart-node.is-selected")).toContainText("叶禾");
  await expect(p.locator(".org-breadcrumb")).toContainText("陆衡");
  await expect(p.locator(".org-breadcrumb")).toContainText("沈岚");
  await expect(p.locator("#org-inspector-form [name=managerId]")).toHaveValue(
    "head-reporting",
  );
  expect(
    await p
      .locator('[data-org-select="person:staff-reporting"]')
      .evaluate((el) => {
        const n = el.getBoundingClientRect(),
          v = el.closest(".chart-viewport").getBoundingClientRect();
        return (
          n.left >= v.left &&
          n.right <= v.right &&
          n.top >= v.top &&
          n.bottom <= v.bottom
        );
      }),
  ).toBe(true);
  await p.locator("#org-search-clear").click();
  await expect(p.locator("#org-search")).toHaveValue("");
  await expect(p.locator(".chart-node.is-selected")).toContainText("叶禾");
  expect(
    await p.evaluate(() => localStorage.getItem("qingbao-configuration-v1")),
  ).toBe(before);
});
test("按部门岗位查找并切换视图，范围筛选、无结果及路径导航", async ({
  page: p,
}) => {
  await start(p);
  await p.locator("#org-search").fill("法报中心");
  await p.locator("#org-search-type").selectOption("department");
  await expect(p.locator(".org-search-results button")).toHaveCount(1);
  await result(p, "department:reporting").click();
  await expect(p.locator("[data-org-mode=departments]")).toHaveClass(/chosen/);
  await expect(p.locator("#org-inspector-form [name=headId]")).toHaveValue(
    "head-reporting",
  );
  await p.locator("#org-search-type").selectOption("person");
  await p.locator("#org-search").fill("总账");
  await result(p, "person:ledger-gao").click();
  await expect(p.locator(".org-breadcrumb")).toContainText("法报中心");
  await expect(p.locator("#org-inspector-form [name=title]")).toHaveValue(
    "总账会计",
  );
  await p
    .locator('.org-breadcrumb [data-org-locate="department:company"]')
    .click();
  await expect(p.locator(".chart-node.is-selected")).toContainText("星河科技");
  await p.locator("#org-search").fill("绝不存在的部门");
  await expect(p.locator(".org-search-results")).toContainText("没有匹配结果");
  await expect(p.locator("#org-search-status")).toContainText("找到 0");
});
test("只读人员可查停用节点但不能编辑，页面无脚本注入", async ({ page: p }) => {
  const org = enterpriseOrg();
  org.people.find((p) => p.id === "staff-tax").active = false;
  org.people.find((p) => p.id === "staff-tax").title =
    "<img src=x onerror=alert(1)>";
  await p.goto("/");
  await p.evaluate(
    (c) => localStorage.setItem("qingbao-configuration-v1", JSON.stringify(c)),
    { org, flows: defaultFlows() },
  );
  await p.reload();
  await p.locator("#role").selectOption("员工");
  await nav(p, "组织架构");
  await p.locator("#org-search").fill("乔伊");
  await expect(result(p, "person:staff-tax")).toContainText("已停用");
  await expect(p.locator(".org-search-results img")).toHaveCount(0);
  await result(p, "person:staff-tax").click();
  await expect(p.locator("#org-inspector")).toContainText("只读");
  await expect(p.locator("#org-inspector-form")).toHaveCount(0);
});
test("未保存修改在定位、切页和切换角色时可取消，编辑字段保留", async ({
  page: p,
}) => {
  await start(p);
  await p.locator('[data-org-select="person:head-reporting"]').click();
  await p.locator("#org-inspector-form [name=title]").fill("未保存部门总");
  p.once("dialog", (d) => d.dismiss());
  await p.locator("#org-search").fill("叶禾");
  await expect(p.locator("#org-search")).toHaveValue("");
  await expect(p.locator("#org-inspector-form [name=title]")).toHaveValue(
    "未保存部门总",
  );
  p.once("dialog", (d) => d.dismiss());
  await nav(p, "审批中心");
  await expect(p.locator("h1")).toHaveText("组织架构");
  p.once("dialog", (d) => d.dismiss());
  await p.locator("#role").selectOption("员工");
  await expect(p.locator("#role")).toHaveValue("管理员");
  await expect(p.locator("#org-inspector-form [name=title]")).toHaveValue(
    "未保存部门总",
  );
  p.once("dialog", (d) => d.accept());
  await p.locator("#org-search").fill("叶禾");
  await result(p, "person:staff-reporting").click();
  await expect(p.locator("#org-inspector-form [name=name]")).toHaveValue(
    "叶禾",
  );
});
test("手机搜索定位与重新定位选中节点，适应画布后恢复可读缩放", async ({
  page: p,
}) => {
  await start(p);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("#chart-fit").click();
  await p.locator("#org-search").fill("CFO");
  await result(p, "person:cfo-lu").click();
  expect(
    Number((await p.locator("#chart-zoom-label").innerText()).replace("%", "")),
  ).toBeGreaterThanOrEqual(65);
  await p.locator(".chart-viewport").evaluate((v) => {
    v.scrollLeft = 0;
    v.scrollTop = 400;
  });
  await p.locator("#chart-selected").click();
  await expect(p.locator(".chart-node.is-selected")).toContainText("CFO");
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
