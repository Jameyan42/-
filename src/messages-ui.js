import { filterMessages } from "./messages.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function messagesView(
  rows,
  actor,
  { type = "all", unread = "all", query = "", page = 0 } = {},
  readHealthy = true,
  requestHealthy = true,
) {
  const filtered = readHealthy
      ? filterMessages(rows, { type, unread, query })
      : filterMessages(rows, { type, query }),
    pages = Math.max(1, Math.ceil(filtered.length / 20)),
    index = Math.min(Math.max(0, page), pages - 1);
  return `<section class="panel prose messages-panel"><h2>${esc(actor?.name || "当前身份")}的站内消息</h2><p>基于本浏览器当前单据状态生成，每单展示当前一条提示。旧记录也可能出现在这里，不代表刚发送；不推送短信、邮件或系统弹窗。</p>${!requestHealthy ? '<p class="risk" role="alert">费用申请数据无法读取，当前仅展示可读取的报销消息，数量不代表完整结果。</p>' : ""}${!readHealthy ? '<p class="risk" role="alert">消息已读存储异常，原始值已保留；暂不能判断未读或标记已读，请恢复有效备份。</p>' : ""}<div class="inbox-summary"><div><span>当前可读取提示</span><strong>${rows.length}</strong></div><div><span>未读</span><strong>${readHealthy ? rows.filter((r) => r.unread).length : "未知"}</strong></div><div><span>待我处理</span><strong>${rows.filter((r) => r.type === "todo").length}</strong></div></div><div class="toolbar inbox-toolbar"><label>消息类别<select id="message-type">${[
    ["all", "全部消息"],
    ["todo", "待我处理"],
    ["update", "本人单据进展"],
  ]
    .map(
      ([k, l]) =>
        `<option value="${k}" ${k === type ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><label>阅读状态<select id="message-unread" ${!readHealthy ? "disabled" : ""}><option value="all" ${unread === "all" ? "selected" : ""}>全部状态</option><option value="unread" ${unread === "unread" ? "selected" : ""}>仅未读</option></select></label><label class="inbox-search">搜索消息<input id="message-search" value="${esc(query)}" placeholder="事项、单号、申请人或当前状态"></label><button id="message-read-filtered" ${!readHealthy || !filtered.some((r) => r.unread) ? "disabled" : ""}>将筛选结果标为已读</button></div><p class="footnote">当前匹配 ${filtered.length} 条，每页20条；批量已读作用于所有匹配页，不改变业务待办。</p><div class="progress-cards">${
    filtered
      .slice(index * 20, index * 20 + 20)
      .map(
        (r) =>
          `<article class="progress-card message-card ${readHealthy && r.unread ? "message-is-unread" : ""}" data-message-key="${esc(r.key)}"><p><span class="badge">${!readHealthy ? "阅读状态未知" : r.unread ? "未读" : "已读"}</span> ${r.type === "todo" ? "待我处理" : "单据进展"} · ${r.kind === "expense" ? "报销" : "费用申请"}</p><h3>${esc(r.title)}</h3><p><b>${esc(r.doc.name)}</b> · ${esc(r.doc.id)}</p><p>${esc(r.doc.employee)} · ${esc(r.doc.department)} · ${esc(r.stage)}</p>${r.reason ? `<p class="progress-reason">处理说明：${esc(r.reason)}</p>` : ""}<p class="footnote">${esc(r.hint)}</p><small>业务记录时间：${r.time ? esc(new Date(r.time).toLocaleString("zh-CN")) : "记录未提供可核对时间"}</small><div class="actions"><button class="link" data-message-open="${esc(r.key)}">查看${r.type === "todo" ? "并处理" : ""}单据 →</button>${readHealthy && r.unread ? `<button type="button" data-message-read="${esc(r.key)}">标记已读</button>` : ""}</div></article>`,
      )
      .join("") ||
    '<p class="empty">当前没有符合条件的消息，可清除筛选。未提交、草稿或尚无结果的本人单据不生成进展提示。</p>'
  }</div><div class="table-footer">匹配 ${filtered.length} 条${type !== "all" || unread !== "all" || query ? '<button class="link" id="message-clear">清除筛选</button>' : ""}</div>${pages > 1 ? `<div class="processed-pagination"><button data-message-page="${index - 1}" ${index === 0 ? "disabled" : ""}>上一页</button><span>第 ${index + 1} / ${pages} 页</span><button data-message-page="${index + 1}" ${index === pages - 1 ? "disabled" : ""}>下一页</button></div>` : ""}<p class="footnote">按具体人员保存已读；标记已读不等于审批、撤回或付款。单据状态或本次提交路径改变后会产生新的未读提示，已结束的待办提示不保留在本页，完整历史请看单据流转记录。仅站内展示，不弹出系统通知。</p></section>`;
}
