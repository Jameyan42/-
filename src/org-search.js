import { chartTree } from "./org-layout.js";
export function parseChartKey(key) {
  const index = String(key).indexOf(":"),
    type = String(key).slice(0, index),
    id = String(key).slice(index + 1);
  if (index < 0 || !["person", "department"].includes(type) || !id)
    throw Error("组织节点标识无效");
  return { type, id };
}
export function searchOrganization(org, query, type = "all") {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  const people = org.people.map((p) => ({
    key: "person:" + p.id,
    type: "person",
    id: p.id,
    name: p.name,
    subtitle: p.title || p.role,
    department:
      org.departments.find((d) => d.id === p.departmentId)?.name || "",
    role: p.role,
    active: p.active,
  }));
  const departments = org.departments.map((d) => ({
    key: "department:" + d.id,
    type: "department",
    id: d.id,
    name: d.name,
    subtitle: "部门",
    department:
      org.people.find((p) => p.id === d.headId)?.name || "负责人待设置",
    role: "",
    active: true,
  }));
  return [...people, ...departments]
    .filter(
      (p) =>
        (type === "all" || p.type === type) &&
        [p.name, p.subtitle, p.department, p.role]
          .join(" ")
          .toLocaleLowerCase()
          .includes(term),
    )
    .sort((a, b) => {
      const rank = (x) =>
        x.name.toLocaleLowerCase() === term
          ? 0
          : x.name.toLocaleLowerCase().startsWith(term)
            ? 1
            : 2;
      return (
        rank(a) - rank(b) ||
        a.name.localeCompare(b.name, "zh-CN") ||
        a.key.localeCompare(b.key)
      );
    });
}
export function chartNodePath(org, mode, key) {
  const visit = (n, path) =>
    n.key === key
      ? [...path, n]
      : n.children.map((c) => visit(c, [...path, n])).find(Boolean);
  return (
    chartTree(org, mode)
      .map((root) => visit(root, []))
      .find(Boolean) || null
  );
}
export function locateOrganization(org, mode, key, collapsed = new Set()) {
  const selected = parseChartKey(key),
    nextMode = selected.type === "department" ? "departments" : mode;
  const path = chartNodePath(org, nextMode, key);
  if (!path) throw Error("节点已不存在，请刷新搜索结果");
  const nextCollapsed = new Set(collapsed);
  for (const node of path.slice(0, -1)) nextCollapsed.delete(node.key);
  return { selected, mode: nextMode, path, collapsed: nextCollapsed, key };
}
