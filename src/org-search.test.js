import test from "node:test";
import assert from "node:assert/strict";
import { enterpriseOrg } from "./organization.js";
import {
  searchOrganization,
  chartNodePath,
  locateOrganization,
  parseChartKey,
} from "./org-search.js";
import { chartTree, chartLayout } from "./org-layout.js";
test("搜索匹配姓名、岗位、部门及角色，大小写和首尾空格归一且不修改数据", () => {
  const org = enterpriseOrg(),
    before = structuredClone(org);
  assert.equal(searchOrganization(org, "  cfo  ")[0].id, "cfo-lu");
  assert.equal(searchOrganization(org, "叶禾")[0].id, "staff-reporting");
  assert.ok(
    searchOrganization(org, "法报中心", "person").some(
      (p) => p.id === "ledger-gao",
    ),
  );
  assert.ok(
    searchOrganization(org, "总账", "person").some(
      (p) => p.id === "ledger-gao",
    ),
  );
  assert.equal(
    searchOrganization(org, "法报中心", "department")[0].id,
    "reporting",
  );
  assert.deepEqual(searchOrganization(org, "   "), []);
  assert.deepEqual(searchOrganization(org, "不存在的岗位"), []);
  assert.deepEqual(org, before);
});
test("折叠节点定位只展开目标上级，保留其他折叠与目标自己的折叠状态", () => {
  const org = enterpriseOrg(),
    folded = new Set([
      "person:cfo-lu",
      "person:head-reporting",
      "person:head-analysis",
    ]);
  const result = locateOrganization(
    org,
    "reports",
    "person:staff-reporting",
    folded,
  );
  assert.deepEqual(
    result.path.map((n) => n.id),
    ["cfo-lu", "head-reporting", "staff-reporting"],
  );
  assert.deepEqual([...result.collapsed], ["person:head-analysis"]);
  assert.equal(folded.size, 3);
  assert.ok(
    chartLayout(chartTree(org, "reports"), result.collapsed).nodes.some(
      (n) => n.id === "staff-reporting",
    ),
  );
  const parent = locateOrganization(
    org,
    "reports",
    "person:head-reporting",
    folded,
  );
  assert.equal(parent.collapsed.has("person:head-reporting"), true);
});
test("部门定位从汇报图切到归属图，人员定位保持当前模式", () => {
  const org = enterpriseOrg(),
    department = locateOrganization(
      org,
      "reports",
      "department:reporting",
      new Set(["department:company"]),
    );
  assert.equal(department.mode, "departments");
  assert.equal(department.collapsed.has("department:company"), false);
  assert.deepEqual(
    department.path.map((n) => n.id),
    ["company", "reporting"],
  );
  const employee = locateOrganization(
    org,
    "departments",
    "person:staff-reporting",
  );
  assert.equal(employee.mode, "departments");
  assert.deepEqual(
    employee.path.map((n) => n.id),
    ["company", "reporting", "staff-reporting"],
  );
});
test("停用人员可被明确查到，非法或消失节点不能定位且原折叠状态不受影响", () => {
  const org = enterpriseOrg();
  org.people.find((p) => p.id === "staff-tax").active = false;
  assert.equal(searchOrganization(org, "乔伊")[0].active, false);
  const folds = new Set(["person:cfo-lu"]);
  assert.throws(
    () => locateOrganization(org, "reports", "person:gone", folds),
    /不存在/,
  );
  assert.equal(folds.size, 1);
  assert.equal(chartNodePath(org, "reports", "department:tax-risk"), null);
  for (const key of ["missing", "person:", "invalid:name"])
    assert.throws(() => parseChartKey(key), /标识/);
});
test("节点键保留标识中的冒号，归属路径与标题中的特殊字符不改变结构", () => {
  const org = enterpriseOrg(),
    p = org.people.find((p) => p.id === "staff-reporting");
  p.id = "staff:with:colon";
  p.name = "叶禾 <示例>";
  assert.deepEqual(parseChartKey("person:staff:with:colon"), {
    type: "person",
    id: "staff:with:colon",
  });
  const result = locateOrganization(org, "reports", "person:staff:with:colon");
  assert.equal(result.selected.id, "staff:with:colon");
  assert.equal(result.path.at(-1).name, "叶禾 <示例>");
});
