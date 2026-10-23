import { chartTree, chartLayout } from "./org-layout.js";
import { searchOrganization, chartNodePath } from "./org-search.js";
export { chartTree, chartLayout } from "./org-layout.js";
import { personForm, departmentForm } from "./config-ui.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function orgChartView(org, role, mode, state) {
  const layout = chartLayout(chartTree(org, mode), state.collapsed),
    admin = role === "管理员";
  const selected = state.selected,
    entity = selected
      ? (selected.type === "person" ? org.people : org.departments).find(
          (p) => p.id === selected.id,
        )
      : null;
  const query = state.searchQuery || "",
    searchType = state.searchType || "all",
    matches = searchOrganization(org, query, searchType);
  const selectedKey = selected ? selected.type + ":" + selected.id : null;
  const breadcrumb = selectedKey ? chartNodePath(org, mode, selectedKey) : null;
  const search = `<div class="org-search"><div class="org-search-fields"><label>查找组织节点<input id="org-search" type="search" maxlength="60" placeholder="姓名、岗位、部门或角色" value="${esc(query)}"></label><label>查找范围<select id="org-search-type"><option value="all" ${searchType === "all" ? "selected" : ""}>人员与部门</option><option value="person" ${searchType === "person" ? "selected" : ""}>仅人员</option><option value="department" ${searchType === "department" ? "selected" : ""}>仅部门</option></select></label>${query ? '<button id="org-search-clear">清除搜索</button>' : ""}<button id="chart-selected" ${selected ? "" : "disabled"}>定位选中节点</button></div><div id="org-search-status" role="status">${query.trim() ? `找到 ${matches.length} 个匹配节点。点选结果会展开上级路径并定位，不修改组织。` : "可按姓名、岗位或部门搜索，停用人员会明确标记。"}</div>${query.trim() ? `<div class="org-search-results">${matches.map((m) => `<button data-org-locate="${esc(m.key)}"><b>${esc(m.name)}</b><span>${m.type === "person" ? "人员" : "部门"} · ${esc(m.subtitle)} · ${esc(m.department)}${m.active ? "" : " · 已停用"}</span></button>`).join("") || '<p class="muted">没有匹配结果，试试更短的姓名、岗位或部门关键词。</p>'}</div>` : ""}</div>`;
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
  return `<section class="panel prose org-chart-panel"><div class="panel-title config-heading"><div><h3>组织架构画布</h3><span>按姓名、岗位、部门查找并定位，点选节点在右侧维护。</span></div>${admin ? '<div><button id="add-department">＋ 部门</button> <button id="add-person" class="primary">＋ 人员</button></div>' : '<span class="badge">只读预览</span>'}</div><div class="chart-toolbar"><div class="tabs"><button data-org-mode="departments" class="${mode === "departments" ? "chosen" : ""}">部门树</button><button data-org-mode="reports" class="${mode === "reports" ? "chosen" : ""}">汇报树</button></div><div class="chart-tools"><button data-chart-zoom="out" aria-label="缩小组织图">−</button><span id="chart-zoom-label">${Math.round(state.zoom * 100)}%</span><button data-chart-zoom="in" aria-label="放大组织图">＋</button><button id="chart-fit">适应画布</button><button id="chart-expand">全部展开</button></div></div>${search}${breadcrumb ? `<nav class="org-breadcrumb" aria-label="当前节点路径"><span>${mode === "reports" ? "汇报路径" : "归属路径"}：</span>${breadcrumb.map((n) => `<button class="link" data-org-locate="${esc(n.key)}">${esc(n.name)}</button>`).join('<span aria-hidden="true">›</span>')}</nav>` : ""}${!org.people.some((p) => p.id === "cfo-lu") ? `<div class="review-box">当前保留你的已有组织。${admin ? '<button id="add-finance-org">添加 CFO 示例组织</button>' : ""} 只追加示例部门和人员，不替换现有汇报关系。</div>` : ""}<div class="chart-workspace"><div class="chart-viewport" tabindex="0" aria-label="组织图画布，可横向与纵向滚动"><div class="chart-scaled" style="width:${layout.width * state.zoom}px;height:${layout.height * state.zoom}px"><div class="org-tree chart-canvas" data-chart-width="${layout.width}" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${state.zoom})"><svg width="${layout.width}" height="${layout.height}" aria-hidden="true">${layout.edges.map((e) => `<path d="${path(e)}"/>`).join("")}</svg>${layout.nodes.map((n) => `<article class="chart-node ${n.type === "department" ? "is-department" : ""} ${selected?.type === n.type && selected?.id === n.id ? "is-selected" : ""}" style="left:${n.x}px;top:${n.y}px"><button class="chart-select" data-org-select="${esc(n.key)}"><small>${esc(n.subtitle)}${n.active === false ? " · 已停用" : ""}</small><b>${esc(n.name)}</b><span>${esc(n.detail)}</span></button><div class="chart-node-actions">${admin ? `<button class="link" data-edit-${n.type}="${esc(n.id)}">编辑</button><button class="link" data-org-add="${esc(n.key)}">＋ 下级</button>` : ""}${admin && n.type === "department" ? `<button class="link" data-org-add-department="${esc(n.id)}">＋ 子部门</button>` : ""}${n.hasChildren ? `<button class="link" data-org-collapse="${esc(n.key)}" aria-expanded="${!state.collapsed.has(n.key)}">${state.collapsed.has(n.key) ? "展开" : "收起"}</button>` : ""}</div></article>`).join("")}</div></div></div><div class="chart-inspector" id="org-inspector">${inspector}</div></div><p class="footnote">画布可滚动、缩放与展开折叠。部门树表达归属，汇报树表达直属上级；CFO 是管理岗位，不会自动成为每笔报销的审批节点。已有名称暂不改名；循环、失效上级和在途责任人停用会阻止保存。</p></section>`;
}
