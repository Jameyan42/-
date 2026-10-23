import { personForm, departmentForm } from "./config-ui.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
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
export function orgChartView(org, role, mode, state) {
  const layout = chartLayout(chartTree(org, mode), state.collapsed),
    admin = role === "管理员";
  const selected = state.selected,
    entity = selected
      ? (selected.type === "person" ? org.people : org.departments).find(
          (p) => p.id === selected.id,
        )
      : null;
  let inspector =
    '<div class="chart-empty"><b>点选一个节点</b><p>在这里查看资料、维护上级和负责人。卡片上的“＋”可直接添加下级。</p></div>';
  if (entity) {
    const form =
      selected.type === "person"
        ? personForm(org, entity.id)
        : departmentForm(org, entity.id);
    inspector = `<h3>${esc(entity.name)}</h3><p>${selected.type === "person" ? "人员资料与直属上级" : "部门归属与负责人"}</p>${admin ? form.slice(form.indexOf("<form")).replace(/id="(person|department)-form"/, 'id="org-inspector-form"') : '<p class="muted">当前为只读预览。切换管理员可维护组织。</p>'}`;
  }
  const path = (e) => {
    const x1 = e.from.x + 104,
      y1 = e.from.y + 106,
      x2 = e.to.x + 104,
      y2 = e.to.y;
    return `M${x1} ${y1} V${(y1 + y2) / 2} H${x2} V${y2}`;
  };
  return `<section class="panel prose org-chart-panel"><div class="panel-title config-heading"><div><h3>组织架构画布</h3><span>用连线理解部门归属与人员汇报，点选节点在右侧维护。</span></div>${admin ? '<div><button id="add-department">＋ 部门</button> <button id="add-person" class="primary">＋ 人员</button></div>' : '<span class="badge">只读预览</span>'}</div><div class="chart-toolbar"><div class="tabs"><button data-org-mode="departments" class="${mode === "departments" ? "chosen" : ""}">部门树</button><button data-org-mode="reports" class="${mode === "reports" ? "chosen" : ""}">汇报树</button></div><div class="chart-tools"><button data-chart-zoom="out" aria-label="缩小组织图">−</button><span id="chart-zoom-label">${Math.round(state.zoom * 100)}%</span><button data-chart-zoom="in" aria-label="放大组织图">＋</button><button id="chart-fit">适应画布</button><button id="chart-expand">全部展开</button></div></div>${!org.people.some((p) => p.id === "cfo-lu") ? `<div class="review-box">当前保留你的已有组织。${admin ? '<button id="add-finance-org">添加 CFO 示例组织</button>' : ""} 只追加示例部门和人员，不替换现有汇报关系。</div>` : ""}<div class="chart-workspace"><div class="chart-viewport" tabindex="0" aria-label="组织图画布，可横向与纵向滚动"><div class="chart-scaled" style="width:${layout.width * state.zoom}px;height:${layout.height * state.zoom}px"><div class="org-tree chart-canvas" data-chart-width="${layout.width}" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${state.zoom})"><svg width="${layout.width}" height="${layout.height}" aria-hidden="true">${layout.edges.map((e) => `<path d="${path(e)}"/>`).join("")}</svg>${layout.nodes.map((n) => `<article class="chart-node ${n.type === "department" ? "is-department" : ""} ${selected?.type === n.type && selected?.id === n.id ? "is-selected" : ""}" style="left:${n.x}px;top:${n.y}px"><button class="chart-select" data-org-select="${esc(n.key)}"><small>${esc(n.subtitle)}${n.active === false ? " · 已停用" : ""}</small><b>${esc(n.name)}</b><span>${esc(n.detail)}</span></button><div class="chart-node-actions">${admin ? `<button class="link" data-edit-${n.type}="${esc(n.id)}">编辑</button><button class="link" data-org-add="${esc(n.key)}">＋ 下级</button>` : ""}${admin && n.type === "department" ? `<button class="link" data-org-add-department="${esc(n.id)}">＋ 子部门</button>` : ""}${n.hasChildren ? `<button class="link" data-org-collapse="${esc(n.key)}" aria-expanded="${!state.collapsed.has(n.key)}">${state.collapsed.has(n.key) ? "展开" : "收起"}</button>` : ""}</div></article>`).join("")}</div></div></div><div class="chart-inspector" id="org-inspector">${inspector}</div></div><p class="footnote">画布可滚动、缩放与展开折叠。部门树表达归属，汇报树表达直属上级；CFO 是管理岗位，不会自动成为每笔报销的审批节点。已有名称暂不改名；循环、失效上级和在途责任人停用会阻止保存。</p></section>`;
}
