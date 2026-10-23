export function chartTree(org, mode = "departments") {
  const people = (p) => ({
    key: "person:" + p.id,
    type: "person",
    id: p.id,
    name: p.name,
    subtitle: p.title || p.role,
    detail: org.departments.find((d) => d.id === p.departmentId)?.name || "",
    active: p.active,
    children: org.people.filter((x) => x.managerId === p.id).map(people),
  });
  const departments = (d) => ({
    key: "department:" + d.id,
    type: "department",
    id: d.id,
    name: d.name,
    subtitle: org.people.find((p) => p.id === d.headId)?.name || "负责人待设置",
    detail: org.people.find((p) => p.id === d.headId)?.title || "部门负责人",
    children: [
      ...org.departments.filter((x) => x.parentId === d.id).map(departments),
      ...org.people
        .filter((p) => p.departmentId === d.id)
        .map((p) => ({ ...people(p), children: [] })),
    ],
  });
  return mode === "reports"
    ? org.people.filter((p) => p.managerId === null).map(people)
    : org.departments.filter((d) => d.parentId === null).map(departments);
}
export function chartLayout(trees, collapsed = new Set()) {
  const nodes = [],
    edges = [];
  let leaf = 0;
  const visit = (n, depth) => {
    const children = collapsed.has(n.key) ? [] : n.children;
    const positions = children.map((c) => visit(c, depth + 1));
    const x = positions.length
      ? (positions[0].x + positions.at(-1).x) / 2
      : leaf++ * 244 + 20;
    const node = {
      ...n,
      x,
      y: depth * 180 + 25,
      hasChildren: !!n.children.length,
    };
    nodes.push(node);
    for (const child of positions) edges.push({ from: node, to: child });
    return node;
  };
  trees.forEach((t) => visit(t, 0));
  return {
    nodes,
    edges,
    width: Math.max(520, leaf * 244 + 40),
    height: Math.max(...nodes.map((n) => n.y), 25) + 155,
  };
}
