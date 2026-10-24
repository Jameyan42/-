const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (v) =>
  "¥ " +
  Number(v).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function budgetOverview(rows, month, editable, healthy) {
  return `<section class="panel prose"><div class="budget-heading"><div><h2>预算执行与管控</h2><p>已付款 + 报销在途 + 申请剩余预留 = 已占用，不重复扣减申请额度</p></div><label>查看月份<input type="month" id="budget-month" value="${esc(month)}"></label></div>${healthy ? "" : '<p class="risk" role="alert">预算或申请数据异常，当前统计不完整；暂停配置、导出和新增占用，原始数据已保留，请恢复有效备份。</p>'}<div class="actions"><button id="budget-export" ${healthy ? "" : "disabled"}>导出本月预算 CSV</button><button id="budget-history" ${healthy ? "" : "disabled"}>查看本月调整记录</button></div><div class="budget-cards">${rows.map((x) => `<article class="budget-card"><div class="budget-card-title"><h3>${esc(x.department)}</h3><span class="badge ${x.ratio >= 1 ? "s4" : x.ratio >= 0.8 ? "s0" : "s3"}">${!healthy ? "待恢复有效数据" : !x.limit ? (x.source === "本月独立额度" ? "本月零额度" : "未设置额度") : x.ratio >= 1 ? "预算已耗尽" : x.ratio >= 0.8 ? "接近额度" : "额度充足"}</span></div><p>${esc(month)}预算 <b>${money(x.limit)}</b></p><small>${esc(x.source)} · ${x.mode === "block" ? "拦截新增占用" : "软预警"}</small><div class="budget-total">${money(x.paid + x.reserved)}<small>${healthy ? "已占用" : "可读取占用（不完整）"} · ${(x.ratio * 100).toFixed(1)}%</small></div><div class="budget-bar"><span style="width:${Math.min(100, x.ratio * 100)}%;background:${x.ratio >= 1 ? "#dd8173" : x.ratio >= 0.8 ? "#e3ad55" : "#6c85e4"}"></span></div><dl><div><dt>已付款</dt><dd>${money(x.paid)}</dd></div><div><dt>报销在途</dt><dd>${money(x.reimbursementReserved)}</dd></div><div><dt>申请剩余预留</dt><dd>${money(x.applicationReserved)}</dd></div><div><dt>${x.available < 0 ? "超出额度" : "可用余额"}</dt><dd class="${x.available < 0 ? "risk" : ""}">${money(Math.abs(x.available))}</dd></div></dl><div class="actions"><button data-budget-ledger="${esc(x.department)}" ${healthy ? "" : "disabled"}>查看占用明细</button>${editable ? `<button data-budget="${esc(x.department)}" ${healthy ? "" : "disabled"}>调整本月额度与管控</button>` : ""}</div></article>`).join("")}</div><div class="review-box"><h3>管控与核销口径</h3><p>本月独立配置只影响所选月份；未配置月份继承旧默认额度并软预警。拦截只针对普通报销正式提交/重提和费用申请最终批准产生的新增占用；已预留申请转报销、在途转付款不会重复占用，也不会被降额卡住。预算调整不撤销历史业务。</p><p>批准申请后预留未核销余额，关联报销不重复计入。退回/撤回关联报销使额度回到申请，结束申请才释放未用余额。按报销原提交日期归属月份；当前不含对公、跨法人及费用类型预算，也没有后端并发锁。</p></div></section>`;
}
export function budgetEditor(row, month) {
  return `<div class="modal-title"><h2>${esc(row.department)} · ${esc(month)}预算</h2><button data-close aria-label="关闭">✕</button></div><p>当前占用 ${money(row.paid + row.reserved)}；本次仅配置${esc(month)}，不改其他月份。降低额度不撤销已有占用，后续新增按新规则处理。</p><form id="budget-form"><label>本月额度（元）<input name="limit" type="number" min="0" max="10000000" step="0.01" required value="${row.limit}"></label><label>超预算处理<select name="mode"><option value="warn" ${row.mode === "warn" ? "selected" : ""}>软预警，允许新增占用</option><option value="block" ${row.mode === "block" ? "selected" : ""}>拦截新增占用</option></select></label><label>调整原因（5～200字）<textarea name="reason" required minlength="5" maxlength="200"></textarea></label><p data-budget-error class="risk" role="alert"></p><button type="submit" class="primary">保存本月预算</button></form>`;
}
export function budgetLedgerView(rows, department, month, page = 0) {
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    index = Math.min(Math.max(0, page), pages - 1),
    total = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0) / 100;
  return `<div class="modal-title"><h2>${esc(department)} · ${esc(month)}占用明细</h2><button data-close aria-label="关闭">✕</button></div><p>占用合计 ${money(total)}，共${rows.length}条贡献记录。申请只列剩余预留，避免与报销重复计数；当前不包含对公。</p><button data-budget-ledger-export>导出全部明细 CSV</button><div class="table-wrap"><table><thead><tr><th>分类/事项</th><th>申请人/状态</th><th>本月贡献金额</th><th>操作</th></tr></thead><tbody>${
    rows
      .slice(index * 20, (index + 1) * 20)
      .map(
        (r) =>
          `<tr><td>${esc(r.category)}<strong>${esc(r.name)}</strong><small>${esc(r.id)}</small></td><td>${esc(r.employee)}<small>${esc(r.status)}</small></td><td>${money(r.amount)}${r.kind === "request" ? `<small>批准${money(r.approvedAmount)} / 已核销${money(r.linkedUsed)}</small>` : ""}</td><td><button type="button" data-budget-open="${esc(r.id)}" data-budget-kind="${r.kind}">查看单据</button></td></tr>`,
      )
      .join("") || '<tr><td colspan="4">本月暂无占用记录。</td></tr>'
  }</tbody></table></div>${pages > 1 ? `<div class="processed-pagination"><button data-budget-page="${index - 1}" ${index === 0 ? "disabled" : ""}>上一页</button><span>第${index + 1}/${pages}页，每页20条</span><button data-budget-page="${index + 1}" ${index === pages - 1 ? "disabled" : ""}>下一页</button></div>` : ""}`;
}
export function budgetHistoryView(rows, month) {
  return `<div class="modal-title"><h2>${esc(month)}预算调整记录</h2><button data-close aria-label="关闭">✕</button></div><p>共${rows.length}条；保留本次配置前后额度/方式，历史业务不被回退。旧默认额度记录仍在操作记录中。</p>${
    [...rows]
      .reverse()
      .map(
        (h) =>
          `<article class="risk-review-record"><b>${esc(h.department)} · v${h.version}</b><p>${money(h.before.limit)} / ${h.before.mode === "block" ? "拦截" : "预警"} → ${money(h.after.limit)} / ${h.after.mode === "block" ? "拦截" : "预警"}</p><p>${esc(h.actorName)}（财务） · ${esc(new Date(h.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }))}（上海）</p><p>${esc(h.reason)}</p></article>`,
      )
      .join("") || "<p>本月尚无新版预算调整记录，不补造旧历史。</p>"
  }`;
}
