import { progressRows, progressGroups } from "./expense-progress.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  "¥ " + Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2 });
export function expenseProgressView(
  items,
  actor,
  org,
  { group = "all", query = "", page = 0 } = {},
) {
  if (!actor || actor.role !== "员工" || actor.active === false)
    return '<section class="panel prose"><h2>员工报销进度</h2><p>请选择员工角色和具体人员，查看其本人的报销进度。</p></section>';
  const all = progressRows(items, actor, org),
    rows = progressRows(items, actor, org, { group, query });
  const pages = Math.max(1, Math.ceil(rows.length / 10)),
    index = Math.min(Math.max(0, page), pages - 1);
  return `<section class="panel prose expense-progress"><h2>${esc(actor.name)}的报销进度</h2><p>仅显示本人报销。金额为报销申请金额，付款状态仅为模拟登记。</p><div class="progress-summary">${progressGroups
    .slice(1)
    .map(([key, label]) => {
      const list = all.filter((r) => r.group === key);
      return `<button data-progress-group="${key}" aria-pressed="${key === group}"><small>${label}</small><strong>${list.length} 笔</strong><span>申请金额 ${money(list.reduce((n, r) => n + r.doc.amount, 0))}</span></button>`;
    })
    .join(
      "",
    )}</div><div class="toolbar"><div class="tabs">${progressGroups.map(([key, label]) => `<button data-progress-group="${key}" class="${key === group ? "chosen" : ""}" aria-pressed="${key === group}">${label} (${all.filter((r) => key === "all" || r.group === key).length})</button>`).join("")}</div><label>查找本人报销<input id="progress-search" value="${esc(query)}" placeholder="事项、单号、状态或待处理人"></label></div><p class="footnote">分组数字为本人全部报销；当前匹配 ${rows.length} 笔。按本次提交时间由近到远，未提供时间的旧单据/草稿排在后面。</p><div class="progress-cards">${
    rows
      .slice(index * 10, index * 10 + 10)
      .map(
        (r) =>
          `<article class="progress-card" data-progress-id="${esc(r.doc.id)}"><div class="progress-card-title"><div><h3>${esc(r.doc.name || "未命名草稿")}</h3><small>${esc(r.doc.id)} · ${esc(r.doc.type)}</small></div><strong>${money(r.doc.amount)}</strong></div><p><span class="badge">${esc(r.doc.status)}</span> <span>${esc(r.version)}</span></p><p>当前节点：<b>${esc(r.stage)}</b>${r.actorName ? ` · ${r.group === "action" ? "待完善人" : "当前待处理人"}：<b>${esc(r.actorName)}</b>` : ""}</p>${r.reason ? `<p class="progress-reason"><b>退回说明：</b>${esc(r.reason)}</p>` : ""}<p class="footnote">${esc(r.hint)}</p>${r.steps.length ? `<ol class="progress-steps" aria-label="本次提交的审批路径">${r.steps.map((n) => `<li class="${n.state === "当前待处理" ? "current" : ""}" ${n.state === "当前待处理" ? 'aria-current="step"' : ""}><b>${esc(n.label)}</b><span>${esc(n.actorName)}</span><small>${n.state}</small></li>`).join("")}</ol>` : ""}<button class="link" data-detail="${esc(r.doc.id)}">${r.group === "action" ? "查看并完善 →" : "查看单据与流转记录 →"}</button></article>`,
      )
      .join("") ||
    '<p class="empty">没有符合条件的本人报销。可切换“全部”或清空搜索。</p>'
  }</div><div class="table-footer">当前筛选 ${rows.length} 笔${query || group !== "all" ? '<button class="link" id="progress-clear">清除筛选</button>' : ""}</div>${pages > 1 ? `<div class="processed-pagination"><button data-progress-page="${index - 1}" ${index === 0 ? "disabled" : ""}>上一页</button><span>第 ${index + 1} / ${pages} 页 · 每页10条</span><button data-progress-page="${index + 1}" ${index === pages - 1 ? "disabled" : ""}>下一页</button></div>` : ""}<p class="footnote">路径来自本次提交快照，后续配置不会改写在途路径。旧单据仅按原角色显示，不猜测处理人。此页不包含事前费用申请，也不提供催办或到账确认；身份选择仍是演示机制。</p></section>`;
}
