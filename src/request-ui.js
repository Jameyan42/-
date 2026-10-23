import { requestBalance } from "./requests.js";
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
export function requestsView(requests, items, role, employee = "林晓") {
  const rows = requests.filter(
    (r) => role !== "员工" || r.employee === employee,
  );
  return `<section class="panel"><div class="panel-title"><div><h3>先申请，再支出</h3><span>员工提交 → 主管审批 → 预留预算 → 关联报销 → 结束释放余额</span></div>${role === "员工" ? '<button data-page="申请进度">查看我的申请进度 →</button>' : ""}<button id="new-request" class="primary">＋ 新建费用申请</button></div><div class="table-wrap"><table><thead><tr><th>事项 / 月份</th><th>申请人</th><th>申请额度</th><th>已关联金额</th><th>剩余额度</th><th>状态</th><th>操作</th></tr></thead><tbody>${
    rows
      .map((r) => {
        const b = requestBalance(r, items);
        return `<tr><td><strong>${esc(r.name)}</strong><small>${esc(r.month)} · ${esc(r.type)}</small>${r.trip ? `<small>${esc(r.trip.origin)} → ${esc(r.trip.destination)}<br>${esc(r.trip.start)} 至 ${esc(r.trip.end)}</small>` : ""}</td><td>${esc(r.employee)}<small>${esc(r.department)}</small></td><td>${money(r.amount)}</td><td>${money(b.used)}</td><td>${money(b.remaining)}<small>${r.status === "已批准" ? "预留中" : "未预留"}</small></td><td><span class="badge">${r.status}</span>${r.approval && r.status === "待审批" ? `<small>待 ${esc(r.approval.nodes[r.approval.cursor]?.actorName || "处理")}</small>` : ""}</td><td><button class="link" data-request="${esc(r.id)}">查看 →</button></td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="7" class="empty">暂无费用申请。切换员工后，可创建第一笔事前申请。</td></tr>'
  }</tbody></table></div><div class="review-box request-notice"><h3>额度与预算口径</h3>只有批准后才预留预算。关联报销占用申请额度，未核销余额继续预留，避免重复计入。退回/撤回释放报销占用并回到申请余额；结束申请才释放未使用预算。仍有在途报销不能结束。只支持同员工、部门、月份和类型；一个申请可分多笔报销，合计不得超过申请额度。部门预算仍为软预警。</div></section>`;
}
export function requestOptions(
  requests,
  items,
  existing,
  today,
  employee = "林晓",
) {
  const rows = requests.filter(
    (r) =>
      r.employee === employee &&
      r.status === "已批准" &&
      r.month === (existing?.date || today).slice(0, 7),
  );
  let html =
    '<option value="">不关联事前申请</option>' +
    rows
      .map(
        (r) =>
          `<option value="${esc(r.id)}" ${existing?.requestId === r.id ? "selected" : ""}>${esc(r.name)} · 可关联 ${money(
            requestBalance(
              r,
              items.filter((x) => x.id !== existing?.id),
            ).remaining,
          )}</option>`,
      )
      .join("");
  if (existing?.requestId && !rows.some((r) => r.id === existing.requestId))
    html += `<option selected value="${esc(existing.requestId)}">原关联申请当前不可提交，请更换或取消关联</option>`;
  return `<label>关联费用申请（可选）<select name="requestId">${html}</select><small>可选本月已批准的申请；选择时同步费用类型。申请上限为硬校验，部门预算仍是软预警。</small></label>`;
}
