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
const actionName = { approve: "通过", reject: "退回/驳回", pay: "付款登记" };
export function processedView(
  all,
  rows,
  actor,
  kind,
  query,
  result,
  order,
  healthy = true,
  page = 0,
) {
  const pageCount = Math.max(1, Math.ceil(rows.length / 20)),
    currentPage = Math.max(0, Math.min(pageCount - 1, page));
  const visible = rows.slice(currentPage * 20, (currentPage + 1) * 20);
  const count = (k) => all.filter((r) => k === "all" || r.kind === k).length;
  return `<section class="panel inbox-panel"><div class="panel-title"><div><h3>我的已处理记录</h3><span>${esc(actor?.name || "未选择人员")} · 按处理次数记录，同一单据可以出现多次</span></div><button id="processed-export" class="quiet">↓ 导出筛选结果</button></div>${!healthy ? '<div class="review-box risk" role="alert">费用申请存储无法读取，处理记录列表不完整；原始数据未改动，请恢复有效备份。</div>' : ""}<div class="inbox-summary">${[
    ["all", "已记录处理次数"],
    ["expense", "报销处理次数"],
    ["request", "费用申请处理次数"],
  ]
    .map(
      ([k, l]) =>
        `<div><span>${l}</span><strong data-processed-count="${k}">${count(k)}</strong></div>`,
    )
    .join("")}</div><div class="toolbar inbox-toolbar"><div class="tabs">${[
    ["all", "全部"],
    ["expense", "报销"],
    ["request", "费用申请"],
  ]
    .map(
      ([k, l]) =>
        `<button data-inbox-kind="${k}" class="${k === kind ? "chosen" : ""}">${l} (${count(k)})</button>`,
    )
    .join(
      "",
    )}</div><label class="inbox-search">搜索处理记录<input id="inbox-search" value="${esc(query)}" placeholder="事项、申请人、备注、科目或付款参考号"></label><label>处理结果<select id="processed-result">${[
    ["all", "全部结果"],
    ["approve", "通过"],
    ["reject", "退回/驳回"],
    ["pay", "付款登记"],
  ]
    .map(
      ([k, l]) =>
        `<option value="${k}" ${k === result ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><label>处理时间<select id="inbox-order"><option value="newest" ${order === "newest" ? "selected" : ""}>最新处理优先</option><option value="oldest" ${order === "oldest" ? "selected" : ""}>最早处理优先</option></select></label></div><div class="table-wrap"><table><thead><tr><th>类型 / 处理时事项</th><th>处理时申请信息</th><th>我的处理</th><th>处理节点 / 版本</th><th>处理后 / 当前状态</th><th>处理时间</th><th>操作</th></tr></thead><tbody>${visible.map(({ doc, kind: k, operation: o }) => `<tr><td><span class="badge">${k === "expense" ? "报销" : "费用申请"}</span><strong>${esc(o.summary.name)}</strong><small>${esc(doc.id)}</small></td><td>${esc(o.summary.employee)} · ${money(o.summary.amount)}<small>${esc(o.summary.department)} · ${esc(o.summary.type)}</small></td><td><span class="badge ${o.action === "reject" ? "s4" : "s3"}">${actionName[o.action]}</span><small>${esc(o.actorName)} · ${esc(o.role)}</small>${o.note ? `<small class="processed-note" title="${esc(o.note)}">${esc(o.note)}</small>` : ""}${o.accounting ? `<small>科目 ${esc(o.accounting.account)}<br>核算 ${esc(o.accounting.costCenter)}</small>` : ""}${o.payment ? `<small>参考号 ${esc(o.payment.reference)}</small>` : ""}</td><td>${esc(o.label)}<small>${o.flowVersion ? "v" + o.flowVersion : "历史固定流程"}</small></td><td>当时：${esc(o.toStatus)}<small>当前：${esc(doc.status)}</small></td><td>${esc(new Date(o.at).toLocaleString("zh-CN"))}</td><td><button class="link" ${k === "expense" ? "data-detail" : "data-request"}="${esc(doc.id)}">查看当前单据 →</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">${all.length ? "当前筛选下没有处理记录。可清除筛选查看全部。" : "当前身份尚无可归属的处理记录。本次升级后由你执行的审批、退回和付款会记录在这里。"}</td></tr>`}</tbody></table></div><div class="table-footer">筛选共 ${rows.length} 次处理 · 此身份共 ${all.length} 次${kind !== "all" || query || result !== "all" ? '<button class="link" id="inbox-clear">清除筛选</button>' : ""}</div>${pageCount > 1 ? `<div class="processed-pagination"><button data-processed-page="${currentPage - 1}" ${currentPage === 0 ? "disabled" : ""}>上一页</button><span>第 ${currentPage + 1} / ${pageCount} 页 · 每页 20 条</span><button data-processed-page="${currentPage + 1}" ${currentPage === pageCount - 1 ? "disabled" : ""}>下一页</button></div>` : ""}<div class="footnote inbox-footnote">只展示具有明确人员标识的新处理记录，旧日志不按姓名或角色猜测归属。导出包含当前筛选的全部记录，不限于当前页。金额、事项和总账/付款摘要保留处理时内容；“查看当前单据”展示最新状态。按处理次数统计，不把重复处理当作多笔业务或累计支出。此原型记录保存在浏览器，不是防篡改审计。</div></section>`;
}
