export const roles = ["员工", "主管", "财务", "总账", "付款", "管理员"];
export function defaultOrg() {
  return {
    departments: [
      { id: "company", name: "星河科技", parentId: null, headId: "admin-gu" },
      { id: "sales", name: "销售部", parentId: "company", headId: "head-xu" },
      {
        id: "product",
        name: "产品部",
        parentId: "company",
        headId: "head-liang",
      },
      { id: "ops", name: "运营部", parentId: "company", headId: "manager-wu" },
    ],
    people: [
      {
        id: "lin",
        name: "林晓",
        departmentId: "sales",
        managerId: "manager-zhao",
        role: "员工",
        active: true,
      },
      {
        id: "chen",
        name: "陈嘉",
        departmentId: "product",
        managerId: "manager-sun",
        role: "员工",
        active: true,
      },
      {
        id: "tang",
        name: "唐宁",
        departmentId: "ops",
        managerId: "manager-wu",
        role: "员工",
        active: true,
      },
      {
        id: "manager-zhao",
        name: "赵航",
        departmentId: "sales",
        managerId: "head-xu",
        role: "主管",
        active: true,
      },
      {
        id: "head-xu",
        name: "许明",
        departmentId: "sales",
        managerId: "admin-gu",
        role: "主管",
        active: true,
      },
      {
        id: "manager-sun",
        name: "孙晴",
        departmentId: "product",
        managerId: "head-liang",
        role: "主管",
        active: true,
      },
      {
        id: "head-liang",
        name: "梁悦",
        departmentId: "product",
        managerId: "admin-gu",
        role: "主管",
        active: true,
      },
      {
        id: "manager-wu",
        name: "吴安",
        departmentId: "ops",
        managerId: "admin-gu",
        role: "主管",
        active: true,
      },
      {
        id: "finance-zhou",
        name: "周宁",
        departmentId: "ops",
        managerId: "admin-gu",
        role: "财务",
        active: true,
      },
      {
        id: "admin-gu",
        name: "顾远",
        departmentId: "company",
        managerId: null,
        role: "管理员",
        active: true,
      },
    ],
  };
}
const text = (x, n = 60) =>
  typeof x === "string" && x.trim().length > 0 && x.length <= n;
export function validateOrg(org) {
  if (
    !org ||
    !Array.isArray(org.departments) ||
    !org.departments.length ||
    org.departments.length > 50 ||
    !Array.isArray(org.people) ||
    !org.people.length ||
    org.people.length > 200
  )
    throw Error("组织应包含 1～50 个部门和 1～200 位人员");
  const ds = new Map(),
    ps = new Map(),
    names = new Set();
  for (const d of org.departments) {
    if (
      !d ||
      !text(d.id) ||
      !text(d.name, 30) ||
      ds.has(d.id) ||
      names.has(d.name) ||
      !(d.parentId === null || text(d.parentId)) ||
      !(d.headId === null || text(d.headId))
    )
      throw Error("部门标识、名称或引用无效/重复");
    ds.set(d.id, d);
    names.add(d.name);
  }
  names.clear();
  for (const p of org.people) {
    if (
      !p ||
      !text(p.id) ||
      !text(p.name, 30) ||
      ps.has(p.id) ||
      names.has(p.name) ||
      !ds.has(p.departmentId) ||
      !roles.includes(p.role) ||
      (p.title !== undefined &&
        (typeof p.title !== "string" || p.title.length > 40)) ||
      typeof p.active !== "boolean" ||
      !(p.managerId === null || text(p.managerId))
    )
      throw Error("人员标识、姓名、部门或角色无效/重复");
    ps.set(p.id, p);
    names.add(p.name);
  }
  if (org.departments.filter((d) => d.parentId === null).length !== 1)
    throw Error("组织必须只有一个根部门");
  const cycle = (id, map, key, label) => {
    const seen = new Set();
    let node = map.get(id);
    while (node) {
      if (seen.has(node.id)) throw Error(label + "存在循环");
      seen.add(node.id);
      const parent = node[key];
      if (parent !== null && !map.has(parent))
        throw Error(label + "引用不存在");
      node = map.get(parent);
    }
  };
  for (const d of org.departments) {
    cycle(d.id, ds, "parentId", "部门层级");
    if (d.headId) {
      const h = ps.get(d.headId);
      if (
        !h ||
        !h.active ||
        !["主管", "管理员"].includes(h.role) ||
        h.departmentId !== d.id
      )
        throw Error("部门负责人必须是本部门在岗主管或管理员");
    }
  }
  for (const p of org.people) {
    cycle(p.id, ps, "managerId", "人员汇报关系");
    if (p.active && p.managerId) {
      const m = ps.get(p.managerId);
      if (!m.active || !["主管", "管理员"].includes(m.role))
        throw Error("直属主管必须是在岗主管或管理员");
    }
    if (p.active && p.role === "员工" && !p.managerId)
      throw Error("在岗员工必须设置直属主管");
  }
  for (const p of org.people)
    if (
      p.active &&
      p.role === "员工" &&
      ds.get(p.departmentId).parentId === null
    )
      throw Error("员工应归属业务部门，不能直接归属根部门");
  if (!org.people.some((p) => p.active && p.role === "员工"))
    throw Error("演示至少保留一位在岗员工");
  if (!org.people.some((p) => p.active && p.role === "管理员"))
    throw Error("至少保留一位在岗管理员");
  return org;
}
export function assertOrgChange(previous, next, documents = []) {
  validateOrg(next);
  for (const old of previous.departments) {
    const d = next.departments.find((x) => x.id === old.id);
    if (!d || d.name !== old.name)
      throw Error("现有部门不能删除或改名，以保留历史归属");
  }
  for (const old of previous.people) {
    const p = next.people.find((x) => x.id === old.id);
    if (!p || p.name !== old.name)
      throw Error("现有人员不能删除或改名，可调整汇报关系或停用");
  }
  for (const doc of documents) {
    if (
      !doc.approval ||
      [
        "已付款",
        "已退回",
        "已撤回",
        "已批准",
        "已驳回",
        "已关闭",
        "草稿",
      ].includes(doc.status)
    )
      continue;
    const pending =
      doc.status === "待付款"
        ? doc.approval.paymentActor
          ? []
          : doc.approval.nodes.slice(-1)
        : doc.approval.nodes.slice(doc.approval.cursor);
    if (doc.approval.paymentActor) pending.push(doc.approval.paymentActor);
    for (const node of pending) {
      const p = next.people.find((p) => p.id === node.actorId);
      if (!p?.active || p.role !== node.role)
        throw Error("在途审批人不能停用或改角色，请先处理其在途单据");
    }
  }
  return next;
}

// Add a fictitious CFO example without replacing existing departments, names or reporting lines.
export function addFinanceOrganization(previous) {
  const org = structuredClone(previous);
  const root = org.departments.find((d) => d.parentId === null);
  const addPerson = (p) => {
    if (org.people.some((x) => x.id === p.id || x.name === p.name))
      throw Error("示例人员已存在或名称冲突，请在现有节点编辑");
    org.people.push({ ...p, active: true });
  };
  addPerson({
    id: "cfo-lu",
    name: "陆衡",
    title: "CFO",
    role: "主管",
    departmentId: root.id,
    managerId: null,
  });
  for (const [id, name, headId, headName, employeeId, employeeName] of [
    [
      "reporting",
      "法报中心",
      "head-reporting",
      "沈岚",
      "staff-reporting",
      "叶禾",
    ],
    [
      "analysis",
      "预算分析部",
      "head-analysis",
      "程睿",
      "staff-analysis",
      "夏宁",
    ],
    ["treasury", "资金部", "head-treasury", "韩敏", "staff-treasury", "苏晨"],
    ["tax-risk", "税务与风控部", "head-tax", "方澈", "staff-tax", "乔伊"],
  ]) {
    if (org.departments.some((d) => d.id === id || d.name === name))
      throw Error("示例部门已存在或名称冲突，请在现有部门编辑");
    org.departments.push({ id, name, parentId: root.id, headId });
    addPerson({
      id: headId,
      name: headName,
      title: "部门总",
      role: "主管",
      departmentId: id,
      managerId: "cfo-lu",
    });
    addPerson({
      id: employeeId,
      name: employeeName,
      title: "专员",
      role: "员工",
      departmentId: id,
      managerId: headId,
    });
  }
  addPerson({
    id: "ledger-gao",
    name: "高璇",
    title: "总账会计",
    role: "总账",
    departmentId: "reporting",
    managerId: "head-reporting",
  });
  addPerson({
    id: "payer-du",
    name: "杜川",
    title: "出纳",
    role: "付款",
    departmentId: "treasury",
    managerId: "head-treasury",
  });
  return validateOrg(org);
}
export function enterpriseOrg() {
  const org = addFinanceOrganization(defaultOrg());
  org.people.find((p) => p.id === "admin-gu").managerId = "cfo-lu";
  org.departments.find((d) => d.parentId === null).headId = "cfo-lu";
  return validateOrg(org);
}
