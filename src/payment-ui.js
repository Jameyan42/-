import { canHandleDocument } from "./inbox.js";
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
export function paymentRows(items, actor, filter = "待付款", query = "") {
  const q = query.trim().toLocaleLowerCase();
  return items.filter((d) => {
    if (!["待付款", "已付款"].includes(d.status)) return false;
    const owner = d.approval?.paymentActor || d.approval?.nodes.at(-1);
    const allowed =
      actor?.active !== false &&
      (actor?.role === "管理员" ||
        (d.status === "待付款"
          ? canHandleDocument(d, "expense", actor)
          : owner
            ? owner.actorId === actor?.id && owner.role === actor?.role
            : actor?.role === "财务"));
    return (
      allowed &&
      (filter === "全部" || d.status === filter) &&
      (!q ||
        [d.name, d.id, d.employee, d.department, d.payment?.reference]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q))
    );
  });
}
export function paymentView(items, actor, filter, query, selected = new Set()) {
  const all = paymentRows(items, actor, "全部"),
    rows = paymentRows(items, actor, filter, query);
  const eligible = rows.filter(
    (d) => d.status === "待付款" && canHandleDocument(d, "expense", actor),
  );
  const chosen = eligible.filter((d) => selected.has(d.id));
  return `<section class="panel"><div class="panel-title"><div><h3>付款工作台（员工报销）</h3><span>${esc(actor?.name || "")} · 汇集复核完成、等待付款登记的报销</span></div><button id="payment-export">↓ 导出筛选付款清单</button></div><div class="inbox-summary">${["待付款", "已付款"].map((s) => `<div><span>${s}金额</span><strong>${money(all.filter((x) => x.status === s).reduce((sum, x) => sum + x.amount, 0))}</strong><small>${all.filter((x) => x.status === s).length} 笔</small></div>`).join("")}</div><div class="toolbar inbox-toolbar"><div class="tabs">${["待付款", "已付款", "全部"].map((s) => `<button data-payment-filter="${s}" class="${s === filter ? "chosen" : ""}">${s}</button>`).join("")}</div><label class="inbox-search">搜索付款<input id="payment-search" value="${esc(query)}" placeholder="事项、单号、申请人或付款参考号"></label></div><div class="payment-selection"><button id="payment-select-all" ${!eligible.length || eligible.length > 20 ? "disabled" : ""}>勾选当前可处理单据</button><button id="payment-select-clear">清空勾选</button><span>已勾选 ${chosen.length} 笔 · ${money(chosen.reduce((s, d) => s + d.amount, 0))}</span><button class="primary" id="payment-batch" ${!chosen.length ? "disabled" : ""}>批量模拟登记</button><small>每批最多20笔，切换筛选或身份清空勾选；超过20笔请缩小搜索范围。管理员仅查看。</small></div><div class="table-wrap"><table><thead><tr><th>勾选</th><th>事项 / 单号</th><th>申请人</th><th>金额</th><th>总账复核</th><th>付款状态</th><th>操作</th></tr></thead><tbody>${rows.map((d) => `<tr><td>${d.status === "待付款" && canHandleDocument(d, "expense", actor) ? `<input type="checkbox" aria-label="勾选 ${esc(d.name)}" data-payment-select="${esc(d.id)}" ${selected.has(d.id) ? "checked" : ""}>` : "—"}</td><td><strong>${esc(d.name)}</strong><small>${esc(d.id)}</small></td><td>${esc(d.employee)}<small>${esc(d.department)}</small></td><td>${money(d.amount)}</td><td>${d.ledgerReview ? `${esc(d.ledgerReview.account)}<small>${esc(d.ledgerReview.costCenter)}</small>` : "历史流程未设独立总账"}</td><td><span class="badge">${esc(d.status)}</span><small>${esc(d.payment?.reference || "尚未登记付款")}</small></td><td><button class="link" data-detail="${esc(d.id)}">${d.status === "待付款" && canHandleDocument(d, "expense", actor) ? "登记付款" : "查看详情"} →</button></td></tr>`).join("") || '<tr><td colspan="7" class="empty">当前身份和筛选条件下暂无付款记录。新流程需先完成总账复核，才进入待付款。</td></tr>'}</tbody></table></div><div class="table-footer">当前显示 ${rows.length} 笔<span>管理员仅查看，办理需切至快照中的付款人员</span></div><p class="footnote inbox-footnote">这里只登记模拟付款，不连接银行、不发起转账。旧流程仍由原财务人员登记；新流程由指定付款人员登记。已付款金额仅为当前人员可查看记录的汇总。</p></section>`;
}
