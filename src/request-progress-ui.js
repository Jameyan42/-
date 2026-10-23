import {
  requestProgressRows,
  requestProgressStatuses,
} from "./request-progress.js";
import { tripSummary } from "./travel-ui.js";
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
export function requestProgressView(
  requests,
  items,
  actor,
  org,
  { status = "全部", month = "", query = "", page = 0 } = {},
  healthy = true,
) {
  if (!healthy)
    return '<section class="panel prose"><h2>申请进度暂不可用</h2><p role="alert" class="risk">费用申请存储无法完整读取，已保留原始数据；请恢复有效备份后查看，当前无法导出。</p></section>';
  if (!actor?.active || actor.role !== "员工")
    return '<section class="panel prose"><h2>员工申请进度</h2><p>请选择员工角色和具体人员，查看本人的费用申请及额度。</p></section>';
  const all = requestProgressRows(requests, items, actor, org),
    rows = requestProgressRows(requests, items, actor, org, {
      status,
      month,
      query,
    }),
    pages = Math.max(1, Math.ceil(rows.length / 10)),
    index = Math.min(Math.max(0, page), pages - 1);
  const sum = (k) => all.reduce((s, r) => s + Math.round(r[k] * 100), 0) / 100;
  return `<section class="panel prose request-progress"><div class="panel-title"><div><h2>${esc(actor.name)}的申请进度</h2><span>事前申请、批准预留及报销核销，一处查看</span></div><button id="request-progress-export">↓ 导出筛选结果</button></div><div class="progress-summary"><div><small>本人申请总数</small><strong>${all.length} 笔</strong><span>包含待审批、已批准、驳回和关闭</span></div><div><small>当前可关联额度 / 申请余额预留</small><strong>${money(sum("available"))}</strong><span>仅已批准申请的未使用余额</span></div><div><small>关联报销在途 / 已登记付款</small><strong>${money(sum("inFlight"))}</strong><span>已登记付款 ${money(sum("paid"))}，不代表银行到账</span></div></div><div class="toolbar request-progress-toolbar"><label>申请状态<select id="request-progress-status">${requestProgressStatuses.map((s) => `<option ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>计划月份<input id="request-progress-month" type="month" value="${esc(month)}"></label><label>搜索本人申请<input id="request-progress-search" value="${esc(query)}" placeholder="事项、单号、目的地或当前审批人"></label></div><p class="footnote">概览为本人全部申请，当前匹配 ${rows.length} 笔；按本次提交时间由近到远，旧记录时间未知排在后面。导出包含所有匹配页。</p><div class="progress-cards">${
    rows
      .slice(index * 10, index * 10 + 10)
      .map(
        (r) =>
          `<article class="progress-card" data-request-progress="${esc(r.request.id)}"><div class="progress-card-title"><div><h3>${esc(r.request.name)}</h3><small>${esc(r.request.id)} · ${esc(r.request.month)} · ${esc(r.request.type)}</small></div><strong>申请 ${money(r.request.amount)}</strong></div><p><span class="badge">${esc(r.request.status)}</span> ${esc(r.version)}</p><p>当前节点：<b>${esc(r.stage)}</b>${r.actorName ? ` · 当前待处理人：<b>${esc(r.actorName)}</b>` : ""}</p>${r.reason ? `<p class="progress-reason">驳回原因：${esc(r.reason)}</p>` : ""}<p class="footnote">${esc(r.hint)}</p>${r.steps.length ? `<ol class="progress-steps" aria-label="本次申请审批路径">${r.steps.map((n) => `<li class="${n.state === "当前待处理" ? "current" : ""}" ${n.state === "当前待处理" ? 'aria-current="step"' : ""}><b>${esc(n.label)}</b><span>${esc(n.actorName)}</span><small>${n.state}</small></li>`).join("")}</ol>` : ""}<div class="request-amounts"><p>已占用额度 <b>${money(r.used)}</b></p><p>在途报销 <b>${money(r.inFlight)}</b></p><p>已登记付款 <b>${money(r.paid)}</b></p><p>未使用额度 <b>${money(r.remaining)}</b></p><p>当前可关联 <b>${money(r.available)}</b></p><p>当前余额预留 <b>${money(r.reserved)}</b></p></div>${r.request.trip ? tripSummary(r.request.trip) : ""}<details class="request-linked"><summary>关联报销（${r.linked.length}）</summary>${r.linked.map((d) => `<p>${esc(d.name)} · ${money(d.amount)} · ${esc(d.status)}${["草稿", "已退回", "已撤回"].includes(d.status) ? " · 不占额度" : ""} <button class="link" data-detail="${esc(d.id)}">查看报销 →</button></p>`).join("") || '<p class="footnote">暂无本人关联报销。</p>'}</details><button class="link" data-request="${esc(r.request.id)}">查看申请${["待审批", "已批准"].includes(r.request.status) ? " / 结束申请" : ""} →</button></article>`,
      )
      .join("") ||
    '<p class="empty">没有符合条件的本人申请，可清除筛选或到费用申请创建。</p>'
  }</div><div class="table-footer">当前筛选 ${rows.length} 笔${status !== "全部" || month || query ? '<button class="link" id="request-progress-clear">清除筛选</button>' : ""}</div>${pages > 1 ? `<div class="processed-pagination"><button data-request-progress-page="${index - 1}" ${index === 0 ? "disabled" : ""}>上一页</button><span>第 ${index + 1} / ${pages} 页 · 每页10条</span><button data-request-progress-page="${index + 1}" ${index === pages - 1 ? "disabled" : ""}>下一页</button></div>` : ""}<p class="footnote">已占用 = 在途报销 + 已登记付款，退回/撤回/草稿不占额度。当前预算占用由在途、已登记付款及已批准申请余额构成，不重复计入原申请额度；关闭申请的未使用额度仅供回顾，当前不预留且不能再关联。身份切换是演示机制，不是生产认证。</p></section>`;
}
