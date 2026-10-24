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
export function inboxView(
  all,
  rows,
  actor,
  kind,
  query,
  order,
  healthy = true,
  enterpriseHealthy = true,
  page = 0,
) {
  const pageCount = Math.max(1, Math.ceil(rows.length / 20)),
    index = Math.min(Math.max(0, page), pageCount - 1),
    visible = rows.slice(index * 20, (index + 1) * 20);
  const counts = {
    all: all.length,
    expense: all.filter((r) => r.kind === "expense").length,
    request: all.filter((r) => r.kind === "request").length,
    corporate: all.filter((r) => r.kind === "corporate").length,
  };
  const empty = all.length
    ? "当前筛选下没有待办。可清除筛选查看全部。"
    : actor?.role === "员工"
      ? "员工身份没有审批任务。可到报销管理或费用申请查看自己的单据。"
      : "当前身份暂无待办。其他人员负责的节点不会显示在这里。";
  return `<section class="panel inbox-panel"><div class="panel-title"><div><h3>我的统一待办</h3><span>${esc(actor?.name || "未选择人员")} · ${esc(actor?.role || "")}，集中处理报销、费用申请、对公支付与付款登记</span></div><button id="inbox-export" class="quiet">↓ 导出当前列表</button></div>${!healthy ? '<div class="review-box risk" role="alert">费用申请存储无法读取，当前列出可读取的单据，数量不是完整待办总数。原始数据未改动，请到数据管理恢复有效备份。</div>' : ""}${!enterpriseHealthy ? '<div class="review-box risk" role="alert">对公业务存储无法读取，列表不含对公单，数量不是完整待办总数；原始值已保留，请恢复有效备份。</div>' : ""}<div class="inbox-summary" aria-label="当前身份待办概览">${[
    ["all", "当前可处理"],
    ["expense", "报销与付款"],
    ["request", "费用申请"],
    ["corporate", "对公支付"],
  ]
    .map(
      ([k, l]) =>
        `<div><span>${l}</span><strong data-inbox-count="${k}">${counts[k]}</strong></div>`,
    )
    .join(
      "",
    )}</div><div class="toolbar inbox-toolbar"><div class="tabs" aria-label="待办类型">${[
    ["all", "全部"],
    ["expense", "报销"],
    ["request", "费用申请"],
    ["corporate", "对公支付"],
  ]
    .map(
      ([k, l]) =>
        `<button data-inbox-kind="${k}" class="${kind === k ? "chosen" : ""}" aria-pressed="${kind === k}">${l} (${counts[k]})</button>`,
    )
    .join(
      "",
    )}</div><label class="inbox-search">搜索待办<input id="inbox-search" placeholder="事项、单号、姓名或部门" value="${esc(query)}"></label><label>提交时间<select id="inbox-order"><option value="oldest" ${order === "oldest" ? "selected" : ""}>最早提交优先</option><option value="newest" ${order === "newest" ? "selected" : ""}>最新提交优先</option></select></label></div><div class="table-wrap"><table><thead><tr><th>类型 / 事项</th><th>申请人</th><th class="amount">金额</th><th>当前阶段</th><th>审批进度</th><th>提交时间</th><th>操作</th></tr></thead><tbody>${visible.map((r) => `<tr data-inbox-row="${r.kind}:${esc(r.doc.id)}"><td><span class="badge ${r.kind === "request" ? "s1" : "s0"}">${r.kind === "corporate" ? "对公支付" : r.kind === "request" ? "费用申请" : "报销"}</span><strong>${esc(r.doc.name)}</strong><small>${esc(r.doc.id)} · ${esc(r.doc.type)}</small></td><td>${esc(r.doc.employee)}<small>${esc(r.doc.department)}</small></td><td class="amount">${money(r.doc.amount)}</td><td><span class="badge">${esc(r.doc.status)}</span><small>${esc(r.stage)} · ${esc(r.actorName || "按原角色处理")}</small></td><td>${esc(r.progress)}<small>${esc(r.version)}</small></td><td>${r.submittedAt ? esc(new Date(r.submittedAt).toLocaleString("zh-CN")) : '<span class="muted">历史记录未提供</span>'}</td><td><button class="link" ${r.kind === "corporate" ? "data-corporate" : r.kind === "request" ? "data-request" : "data-detail"}="${esc(r.doc.id)}">${r.doc.status === "待付款" ? "登记付款" : "查看并处理"} →</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">${empty}</td></tr>`}</tbody></table></div><div class="table-footer">当前显示 ${visible.length} 条 · 筛选共 ${rows.length} 条 · 此身份共 ${all.length} 条${kind !== "all" || query ? '<button class="link" id="inbox-clear">清除筛选</button>' : ""}</div>${pageCount > 1 ? `<div class="processed-pagination"><button data-inbox-page="${index - 1}" ${index === 0 ? "disabled" : ""}>上一页</button><span>第 ${index + 1} / ${pageCount} 页 · 每页20条</span><button data-inbox-page="${index + 1}" ${index === pageCount - 1 ? "disabled" : ""}>下一页</button></div>` : ""}<div class="footnote inbox-footnote">只展示当前节点可处理的单据。通过或驳回后自动移出当前节点；财务审核通过后仍会保留付款登记任务。导出包含当前筛选的所有页。旧报销/申请记录继续原角色流程，未提供提交时间的记录排在最后。</div></section>`;
}
