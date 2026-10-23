import {
  requestBalance,
  validateRequest,
  requestAction,
  assertClaimLink,
  validateRequestSet,
} from "./requests.js";
import { requestsView, requestOptions } from "./request-ui.js";
import { researchView, researchCsv } from "./research.js";
import { caseStudyView } from "./case-study.js";
import { ocrPanel, mountOcr } from "./ocr-ui.js";
import "./style.css";
import { review, transition } from "./domain.js";
import { withdraw, invoiceRows } from "./expenses.js";
import { defaultBudgets, budgetRows } from "./budget.js";
import { defaultPolicy, validatePolicy, validateBackup } from "./settings.js";
let policy, audit;
try {
  policy = validatePolicy(
    JSON.parse(localStorage.getItem("qingbao-policy")) || defaultPolicy,
  );
} catch {
  policy = { ...defaultPolicy };
}
try {
  audit = JSON.parse(localStorage.getItem("qingbao-audit")) || [];
} catch {
  audit = [];
}
function record(action, target, note = "") {
  audit.unshift({
    actor: role,
    action,
    target,
    note,
    time: new Date().toLocaleString("zh-CN"),
  });
  audit = audit.slice(0, 1000);
  localStorage.setItem("qingbao-audit", JSON.stringify(audit));
}
let budgets;
try {
  budgets =
    JSON.parse(localStorage.getItem("qingbao-budgets")) ||
    structuredClone(defaultBudgets);
} catch {
  budgets = structuredClone(defaultBudgets);
}
let budgetMonth = "2026-10";
let invoiceQuery = "",
  invoiceFilter = "全部";
const seed = [
  {
    id: "BX202610001",
    name: "上海客户拜访差旅",
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 2480,
    date: "2026-10-20",
    status: "待主管审批",
    receipt: "交通票据.pdf",
    invoice: "310026001",
    note: "拜访华东客户，往返高铁及市内交通",
  },
  {
    id: "BX202610002",
    name: "产品共创工作坊",
    employee: "陈嘉",
    department: "产品部",
    type: "业务招待",
    amount: 3860,
    date: "2026-10-19",
    status: "待财务审核",
    receipt: "会议发票.pdf",
    invoice: "310026002",
    note: "客户共创活动餐饮费用",
  },
  {
    id: "BX202610003",
    name: "办公耗材采购",
    employee: "周宁",
    department: "运营部",
    type: "办公采购",
    amount: 680,
    date: "2026-10-18",
    status: "待付款",
    receipt: "采购发票.pdf",
    invoice: "310026003",
    note: "打印纸与办公耗材",
  },
  {
    id: "BX202610004",
    name: "杭州项目出差",
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 1260,
    date: "2026-10-17",
    status: "已付款",
    receipt: "高铁发票.pdf",
    invoice: "310026004",
    note: "项目交付现场沟通",
  },
  {
    id: "BX202610005",
    name: "客户出行交通",
    employee: "林晓",
    department: "销售部",
    type: "差旅交通",
    amount: 2480,
    date: "2026-10-21",
    status: "待主管审批",
    receipt: "交通票据.pdf",
    invoice: "310026004",
    note: "演示：重复发票号码",
  },
].map((x) => ({
  ...x,
  history: [{ text: "员工提交报销", time: x.date + " 10:30" }],
}));
let items;
try {
  items =
    JSON.parse(localStorage.getItem("qingbao-v1")) || structuredClone(seed);
} catch {
  items = structuredClone(seed);
}
let requests = [],
  requestStoreHealthy = true;
try {
  requests = JSON.parse(localStorage.getItem("qingbao-requests-v1")) || [];
  validateRequestSet(requests, items);
} catch {
  requests = [];
  requestStoreHealthy = false;
}
function saveRequests(next = requests) {
  if (!requestStoreHealthy)
    throw new Error("费用申请存储无法读取，原数据未改动，请恢复有效备份后重试");
  localStorage.setItem("qingbao-requests-v1", JSON.stringify(next));
  requests = next;
}
let role = "主管",
  page = "工作台",
  query = "",
  filter = "全部",
  selected = null,
  toastTimer;
const app = document.querySelector("#app");
const money = (n) =>
  "¥ " + Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2 });
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function save() {
  localStorage.setItem("qingbao-v1", JSON.stringify(items));
}
function flags(x) {
  return review(x, items, policy);
}
function toast(s) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = s;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}
function visible() {
  return items.filter(
    (x) =>
      (role !== "员工" || x.employee === "林晓") &&
      (filter === "全部" || x.status === filter) &&
      (!query || [x.name, x.id, x.employee].join(" ").includes(query)) &&
      (page !== "审批中心" ||
        (role === "主管"
          ? x.status === "待主管审批"
          : role === "财务"
            ? ["待财务审核", "待付款"].includes(x.status)
            : true)),
  );
}
function render() {
  const pending = items.filter((x) =>
    ["待主管审批", "待财务审核", "待付款"].includes(x.status),
  );
  app.innerHTML = `
<aside><a class="brand" href="#"><b>轻</b><span>轻报<small>QINGBAO EXPENSE</small></span></a><div class="workspace">星河科技 <span>演示空间</span></div><div class="nav-label">工作空间</div>${[
    ["工作台", "◫"],
    ["报销管理", "▤"],
    ["费用申请", "◇"],
    ["审批中心", "✓"],
    ["费用洞察", "◷"],
    ["预算管理", "▥"],
    ["发票台账", "▧"],
    ["规则配置", "⚙"],
    ["操作记录", "≡"],
    ["数据管理", "⇅"],
    ["演示指南", "▷"],
    ["项目案例", "◈"],
    ["体验测试", "◎"],
    ["产品说明", "◇"],
  ]
    .map(
      ([p, i]) =>
        `<button class="nav ${page === p ? "active" : ""}" data-page="${p}"><span>${i}</span>${p}${p === "审批中心" ? `<em>${pending.length}</em>` : ""}</button>`,
    )
    .join(
      "",
    )}<div class="sidebar-bottom"><span class="green-dot"></span> 本地演示 · 数据保存在浏览器<p>为 200 人成长型企业设计</p></div></aside>
<div class="shell"><header><div>工作空间 <span>/</span> ${page}</div><div class="header-right"><span class="demo-tag">产品原型</span><label>体验角色 <select id="role">${["员工", "主管", "财务"].map((r) => `<option ${r === role ? "selected" : ""}>${r}</option>`).join("")}</select></label><div class="avatar">${role === "员工" ? "林" : role === "主管" ? "许" : "周"}</div></div></header>
<main><div class="page-heading"><div><div class="eyebrow">让每一笔费用，都清晰有序</div><h1>${page === "工作台" ? "工作台" : page}</h1><p>${role === "员工" ? "林晓，你好。提交费用、追踪进度，让报销更轻松。" : role === "主管" ? "许经理，你好。这里是团队费用与审批的最新动态。" : "周会计，你好。集中处理财务审核与付款登记。"}</p></div><button class="primary" id="create">＋ 新建报销</button></div>
${
  page === "费用申请"
    ? requestsView(requests, items, role)
    : page === "体验测试"
      ? researchView(role)
      : page === "项目案例"
        ? caseStudyView()
        : page === "产品说明"
          ? about()
          : page === "费用洞察"
            ? insights()
            : page === "预算管理"
              ? budgetView()
              : page === "规则配置"
                ? policyView()
                : page === "操作记录"
                  ? auditView()
                  : page === "数据管理"
                    ? dataView()
                    : page === "发票台账"
                      ? invoiceView()
                      : page === "演示指南"
                        ? guideView()
                        : `
${
  page === "工作台"
    ? `<section class="stats">${[
        ["待处理报销", pending.length, "笔", "覆盖审批、审核与付款", "blue"],
        [
          "已提交报销总额",
          money(
            items
              .filter((x) => !["草稿", "已撤回"].includes(x.status))
              .reduce((s, x) => s + x.amount, 0),
          ),
          "",
          "当前演示数据汇总",
          "violet",
        ],
        [
          "预审风险单",
          items.filter((x) => flags(x).length).length,
          "笔",
          "基于明确规则自动识别",
          "orange",
        ],
        [
          "已付款金额",
          money(
            items
              .filter((x) => x.status === "已付款")
              .reduce((s, x) => s + x.amount, 0),
          ),
          "",
          "已完成付款登记",
          "green",
        ],
      ]
        .map(
          ([l, v, u, d, c]) =>
            `<article class="stat"><div>${l}<span class="stat-icon ${c}">↗</span></div><h2>${v}<small>${u}</small></h2><p>${d}</p></article>`,
        )
        .join(
          "",
        )}</section><section class="assistant"><div class="spark">✧</div><div><h3>报销预审助手 <span>规则演示</span></h3><p>发现 ${items.filter((x) => flags(x).length).length} 笔报销需要关注。超标费用与重复票据已标记，建议优先核查。</p></div><button id="risks">查看风险单 →</button></section>`
    : ""
}
<section class="panel"><div class="panel-title"><div><h3>${page === "审批中心" ? "我的审批待办" : "报销记录"}</h3><span>跟踪每一笔费用的处理进度</span></div><button class="quiet" id="export">↓ 导出 CSV</button></div><div class="toolbar"><div class="tabs">${["全部", "草稿", "待主管审批", "待财务审核", "待付款", "已付款", "已退回", "已撤回"].map((s) => `<button data-filter="${s}" class="${filter === s ? "chosen" : ""}">${s === "待主管审批" ? "待审批" : s === "待财务审核" ? "待审核" : s}</button>`).join("")}</div><input id="search" aria-label="搜索报销" placeholder="⌕ 搜索名称、单号或姓名" value="${esc(query)}"></div><div class="table-wrap"><table><thead><tr><th>报销事项 / 单号</th><th>申请人</th><th>费用类型</th><th class="amount">报销金额</th><th>状态</th><th>预审结果</th><th>操作</th></tr></thead><tbody>${
                            visible()
                              .map(
                                (x) =>
                                  `<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.id)} · ${x.date}</small></td><td><div class="person"><span>${esc(x.employee[0])}</span><div>${esc(x.employee)}<small>${esc(x.department)}</small></div></div></td><td>${esc(x.type)}</td><td class="amount"><strong>${money(x.amount)}</strong></td><td><span class="badge s${["待主管审批", "待财务审核", "待付款", "已付款", "已退回", "已撤回"].indexOf(x.status)}">${x.status}</span></td><td><span class="${flags(x).length ? "risk" : "safe"}">${flags(x).length ? "⚑ " + flags(x).length + " 项待核查" : "✓ 未发现风险"}</span></td><td><button class="link" data-detail="${esc(x.id)}">查看 →</button></td></tr>`,
                              )
                              .join("") ||
                            '<tr><td colspan="7" class="empty">暂无符合条件的报销记录</td></tr>'
                          }</tbody></table></div><div class="table-footer">共 ${visible().length} 条记录<span>所有金额均为人民币 CNY</span></div></section><div class="footnote">ⓘ 演示使用虚构人员与票据；预审为规则计算，未接入大模型、发票验真或银行付款。</div>`
}</main><footer>轻报 QINGBAO <span>让费用管理回归简单</span><button id="reset">重置演示数据</button></footer></div><div id="overlay"></div>`;
  bind();
}
function about() {
  return `<section class="panel prose"><h2>用 AI 辅助构建，让产品思考可见</h2><p>轻报是面向 200 人成长型企业的费控产品原型，目标是减少报销反复填写、审批进度不透明和票据重复审核的成本。</p><h3>体验一条完整业务流程</h3><p>切换到员工创建报销 → 切换主管审批 → 切换财务审核 → 财务登记付款。出现风险时退回，员工在详情中修正并重新提交。</p><h3>三个演示案例</h3><p>上海客户拜访：正常审批；产品共创工作坊：超标预警；客户出行交通：重复票据提示。风险单应退回修改后再审核。</p><h3>预算管理</h3><p>按部门与月份查看额度、已付款、在途占用和可用余额。超过额度显示预警；财务可调整部门月度额度。额度为各月共用的演示标准，调整会影响所有月份的统计，不拦截报销。</p><h3>票据与付款闭环</h3><p>发票台账按报销单关联票据名称和发票号码，可筛选重复号码；未上传或验真票据。员工可在主管审批前撤回，释放预算占用。财务登记付款需填写日期、方式和参考号，仍不执行转账。</p><h3>能力边界</h3><p>预审仅使用透明规则。图片可通过浏览器 OCR 辅助提取，核对后填入表单；附件保存时仅记录名称，不保存原图；角色切换是演示机制，不具备真实身份认证与访问隔离。所有数据保存在当前浏览器，没有后端或多人协作。付款仅改变记录状态，不执行资金转账。</p><h3>后续验证</h3><p>招募员工、主管、财务各 2 人完成任务，记录提交耗时、一次通过率及风险提示理解率；以测试结果调整设计，不将演示数据当作真实业务效果。</p></section>`;
}
function insights() {
  const groups = {};
  items
    .filter((x) => !["草稿", "已撤回"].includes(x.status))
    .forEach((x) => (groups[x.type] = (groups[x.type] || 0) + x.amount));
  const max = Math.max(...Object.values(groups), 1);
  return `<section class="panel prose"><h3>费用结构</h3><p>按已提交报销的申请金额统计，包含待审批及退回单据，不含草稿。</p>${Object.entries(
    groups,
  )
    .map(
      ([k, v]) =>
        `<div class="bar-label">${k}<strong>${money(v)}</strong></div><div class="bar"><span style="width:${(v / max) * 100}%"></span></div>`,
    )
    .join(
      "",
    )}<h3>流程分布</h3><div class="flow">${["待主管审批", "待财务审核", "待付款", "已付款", "已退回", "已撤回"].map((s) => `<div><h2>${items.filter((x) => x.status === s).length}</h2>${s}</div>`).join("")}</div></section>`;
}
function bind() {
  bindRequests();
  bindMore();
  bindExpenses();
  document.querySelector("#budget-month")?.addEventListener("change", (e) => {
    if (e.target.value) {
      budgetMonth = e.target.value;
      render();
    }
  });
  document
    .querySelectorAll("[data-budget]")
    .forEach((b) => (b.onclick = () => editBudget(b.dataset.budget)));
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        filter = "全部";
        query = "";
        render();
      }),
  );
  document.querySelector("#role").onchange = (e) => {
    role = e.target.value;
    render();
  };
  document.querySelector("#create").onclick = () => form();
  document.querySelector("#reset").onclick = () => {
    if (confirm("重置后将清除当前浏览器中的演示修改，是否继续？")) {
      requests = [];
      requestStoreHealthy = true;
      saveRequests();
      items = structuredClone(seed);
      budgets = structuredClone(defaultBudgets);
      localStorage.setItem("qingbao-budgets", JSON.stringify(budgets));
      policy = { ...defaultPolicy };
      localStorage.setItem("qingbao-policy", JSON.stringify(policy));
      audit = [];
      localStorage.removeItem("qingbao-budget-audit");
      record("重置演示", "演示空间", "恢复初始数据、预算与规则");
      save();
      render();
      toast("演示数据已重置");
    }
  };
  document.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        render();
      }),
  );
  document.querySelector("#search")?.addEventListener("input", (e) => {
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.querySelector("#search");
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  document
    .querySelectorAll("[data-detail]")
    .forEach((b) => (b.onclick = () => detail(b.dataset.detail)));
  document.querySelector("#risks")?.addEventListener("click", () => {
    const item = items.find((x) => flags(x).length);
    if (item) detail(item.id);
    else toast("当前没有预审风险单");
  });
  document.querySelector("#export")?.addEventListener("click", () => {
    const cell = (s) =>
      '"' +
      String(s)
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv =
      "\ufeff" +
      [
        ["单号", "事项", "申请人", "金额", "状态"],
        ...visible().map((x) => [x.id, x.name, x.employee, x.amount, x.status]),
      ]
        .map((r) => r.map(cell).join(","))
        .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "轻报-报销记录.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
function modal(html) {
  const o = document.querySelector("#overlay");
  o.innerHTML = `<div class="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="业务操作窗口" tabindex="-1">${html}</section></div>`;
  const close = () => {
    if (
      o.querySelector("form[data-dirty=true]") &&
      !confirm("报销尚未保存，确定关闭并放弃本次填写吗？")
    )
      return;
    o.innerHTML = "";
  };
  o.querySelector(".modal").onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === "Tab") {
      const focusable = [
        ...o.querySelectorAll(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary",
        ),
      ].filter((x) => !x.hidden && x.getClientRects().length);
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  o.querySelector(".backdrop").onclick = (e) => {
    if (e.target === e.currentTarget) close();
  };
  o.querySelector("[data-close]").onclick = close;
  o.querySelector("button,input")?.focus();
}
function detail(id) {
  selected = items.find((x) => x.id === id);
  const x = selected;
  const f = flags(x);
  const can =
    (role === "主管" && x.status === "待主管审批") ||
    (role === "财务" && ["待财务审核", "待付款"].includes(x.status));
  modal(
    `<div class="modal-title"><div><small>${esc(x.id)}</small><h2>${esc(x.name)}</h2></div><button data-close aria-label="关闭">✕</button></div><div class="detail-amount">${money(x.amount)} <span class="badge">${x.status}</span></div><div class="detail-grid"><p>申请人<b>${esc(x.employee)} · ${esc(x.department)}</b></p><p>费用类型<b>${esc(x.type)}</b></p><p>发票号码<b>${esc(x.invoice || "未填写")}</b></p><p>附件（仅记录名称）<b>${esc(x.receipt || "未提供")}</b></p></div><p>${esc(x.note)}</p><div class="review-box"><h3>✧ 预审说明 · 规则计算</h3>${f.length ? f.map((s) => `<p class="risk">⚑ ${s}</p>`).join("") : '<p class="safe">✓ 未发现超标、缺失附件或重复号码风险</p>'}<small>未进行票据真伪验证；提示不替代人工审核。</small></div>${x.payment ? `<div class="review-box payment-summary"><h3>付款登记信息</h3><p>方式：${esc(x.payment.method)} · 日期：${esc(x.payment.date)}</p><p>参考号：${esc(x.payment.reference)}</p><small>仅作模拟登记，未连接银行或执行转账。</small></div>` : x.status === "已付款" ? '<p class="footnote">历史演示记录未提供付款参考号。</p>' : ""}${x.ocr ? '<p class="footnote">曾使用浏览器 OCR 辅助并由员工核对，识别不代表发票真实或字段准确。</p>' : ""}${x.requestId ? `<div class="review-box"><h3>关联费用申请</h3><p>${esc(requests.find((r) => r.id === x.requestId)?.name || x.requestId)}</p><small>提交时占用申请额度，付款后转为实际支出；未核销余额仍预留。</small></div>` : ""}<h3>流转记录</h3><div class="timeline">${x.history.map((h) => `<p>${esc(h.text)}<small>${esc(h.time)}</small></p>`).join("")}</div>${role === "员工" && x.employee === "林晓" && x.status === "待主管审批" ? '<div class="review-box"><label>撤回原因<textarea id="withdraw-reason" maxlength="200" placeholder="如金额填写有误，需要修改"></textarea></label><button id="withdraw">撤回并修改</button><p>仅主管审批前可撤回，之后需由审核人退回。</p></div>' : ""}${can ? `${x.status === "待付款" ? paymentFields() : ""}<label>处理备注<textarea id="reason" placeholder="退回时必须填写原因"></textarea></label><div class="actions"><button id="reject">退回修改</button><button class="primary" id="approve">${x.status === "待付款" ? "登记付款" : "审核通过"}</button></div>` : role === "员工" && x.employee === "林晓" && ["已退回", "草稿", "已撤回"].includes(x.status) ? `<button class="primary" id="edit">${x.status === "草稿" ? "继续填写草稿" : "修改并重新提交"}</button>` : '<p class="footnote">切换对应角色，在可处理的阶段执行操作。</p>'}`,
  );
  if (can) {
    document.querySelector("#reject").onclick = () => act("reject");
    document.querySelector("#approve").onclick = () => act("approve");
  }
  document.querySelector("#edit")?.addEventListener("click", () => form(x));
  document.querySelector("#withdraw")?.addEventListener("click", () => {
    try {
      const reason = document.querySelector("#withdraw-reason").value;
      const next = withdraw(x, "林晓", reason);
      items[items.findIndex((i) => i.id === x.id)] = next;
      record("撤回报销", x.id, reason);
      save();
      render();
      toast("报销已撤回，预算占用已释放，可修改后重新提交");
    } catch (e) {
      toast(e.message);
    }
  });
}
function act(action) {
  try {
    const i = items.findIndex((x) => x.id === selected.id);
    items[i] = transition(
      { ...items[i], flags: flags(items[i]) },
      action,
      role,
      document.querySelector("#reason").value,
      selected.status === "待付款" && action === "approve"
        ? {
            reference: document.querySelector("#payment-reference").value,
            date: document.querySelector("#payment-date").value,
            method: document.querySelector("#payment-method").value,
            confirmed: document.querySelector("#payment-confirm").checked,
          }
        : null,
    );
    record(
      action === "reject"
        ? "退回报销"
        : items[i].status === "已付款"
          ? "登记付款"
          : "审核通过",
      items[i].id,
      items[i].payment
        ? `付款参考号 ${items[i].payment.reference}；${document.querySelector("#reason").value}`
        : document.querySelector("#reason").value,
    );
    save();
    render();
    toast(
      action === "reject"
        ? "已退回，员工可修改后重新提交"
        : "处理成功，报销已进入下一阶段",
    );
  } catch (e) {
    toast(e.message);
  }
}
function form(existing) {
  let ocrEvidence = existing?.ocr || null;
  if (role !== "员工") {
    toast("请先将体验角色切换为员工，再创建报销");
    return;
  }
  modal(
    `<div class="modal-title"><h2>${existing ? "编辑报销" : "新建报销"}</h2><button data-close aria-label="关闭">✕</button></div><p class="muted">申请人：林晓 · 销售部</p><form id="expense-form"><label>报销事项<input name="name" maxlength="60" required value="${esc(existing?.name || "")}" placeholder="例如：上海客户拜访差旅"></label><div class="form-grid"><label>费用类型<select name="type">${["差旅交通", "业务招待", "办公采购", "其他费用"].map((t) => `<option ${existing?.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>金额（元）<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required value="${existing?.amount || ""}"></label></div><label>发票号码<input name="invoice" maxlength="40" value="${esc(existing?.invoice || "")}" placeholder="用于重复报销检测"></label><label>票据附件<input name="receipt" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"><small>图片可在浏览器中识别，不上传原图；保存时仅记录文件名。${existing?.receipt ? "当前：" + esc(existing.receipt) : ""}</small></label>${requestOptions(requests, items, existing, new Date().toLocaleDateString("sv-SE"))}${ocrPanel()}${existing?.receipt ? '<label class="check-line"><input type="checkbox" name="removeReceipt">移除当前附件名称</label>' : ""}<label>业务说明<textarea name="note" maxlength="500" required placeholder="说明费用用途">${esc(existing?.note || "")}</textarea></label><div id="form-review" class="review-box"></div><div class="actions"><button type="button" id="draft">保存草稿</button><button type="submit" class="primary">提交报销 →</button></div></form>`,
  );
  const formEl = document.querySelector("#expense-form");
  const collect = () => {
    const d = new FormData(formEl);
    return {
      id: existing?.id || "BX" + crypto.randomUUID(),
      name: d.get("name").trim(),
      amount: Number(d.get("amount")) || 0,
      type: d.get("type"),
      invoice: d.get("invoice").trim(),
      receipt:
        d.get("receipt")?.name ||
        (d.get("removeReceipt") ? "" : existing?.receipt) ||
        "",
      note: d.get("note").trim(),
      employee: "林晓",
      department: "销售部",
      date: existing?.date || new Date().toLocaleDateString("sv-SE"),
      status: "待主管审批",
      history: existing?.history || [],
      ...(d.get("requestId") ? { requestId: d.get("requestId") } : {}),
      ...(ocrEvidence ? { ocr: ocrEvidence } : {}),
    };
  };
  const preview = () => {
    const x = collect();
    const f = flags(x);
    document.querySelector("#form-review").innerHTML =
      `<h3>提交前预审 · 规则计算</h3>${f.length ? f.map((t) => `<p class="risk">⚑ ${esc(t)}</p>`).join("") : '<p class="safe">✓ 当前未触发规则预警</p>'}<small>单笔额度 ${money(policy.limit)}；仅检查已填写的信息，提交仍需完整填写必填项。风险单可提交说明情况，财务审核前须解决。</small>`;
  };
  formEl.elements.requestId.addEventListener("change", () => {
    const r = requests.find((r) => r.id === formEl.elements.requestId.value);
    if (r) formEl.elements.type.value = r.type;
    preview();
    formEl.dataset.dirty = "true";
  });
  formEl.addEventListener("input", preview);
  preview();
  mountOcr(formEl, {
    onInvalidate: () => {
      ocrEvidence = null;
    },
    onApply: ({ invoice, amount }) => {
      ocrEvidence = {
        engine: "Tesseract.js",
        confirmed: true,
        at: new Date().toISOString(),
        fields: [
          ...(invoice ? ["invoice"] : []),
          ...(amount ? ["amount"] : []),
        ],
      };
      formEl.dataset.dirty = "true";
    },
    onSample: () => {
      preview();
      formEl.dataset.dirty = "true";
    },
  });
  formEl.elements.receipt.addEventListener("change", () => {
    ocrEvidence = null;
  });
  formEl.addEventListener("input", () => {
    formEl.dataset.dirty = "true";
  });
  const persist = (draft) => {
    const x = collect();
    if (
      !draft &&
      (!Number.isFinite(x.amount) ||
        x.amount <= 0 ||
        x.amount > 1000000 ||
        !x.name ||
        !x.note)
    )
      return toast("请填写事项、有效金额和业务说明");
    if (!Number.isFinite(x.amount) || x.amount < 0 || x.amount > 1000000)
      return toast("请输入有效金额");
    x.name = x.name || (draft ? "未命名草稿" : "");
    x.status = draft ? "草稿" : "待主管审批";
    try {
      assertClaimLink(x, requests, items);
    } catch (e) {
      return toast(e.message);
    }
    x.history = [
      ...x.history,
      {
        text: draft
          ? "员工保存草稿"
          : existing
            ? "员工修改并提交"
            : "员工提交报销",
        time: new Date().toLocaleString("zh-CN"),
      },
    ];
    if (existing) items[items.findIndex((i) => i.id === x.id)] = x;
    else items.unshift(x);
    record(
      draft ? "保存草稿" : "提交报销",
      x.id,
      x.name + (x.ocr ? " · 曾使用OCR辅助并人工核对" : ""),
    );
    save();
    render();
    toast(
      draft
        ? "草稿已保存，可在草稿标签继续填写"
        : "报销已提交，预审结果可在详情查看",
    );
  };
  document.querySelector("#draft").onclick = () => persist(true);
  formEl.onsubmit = (e) => {
    e.preventDefault();
    persist(false);
  };
}
render();

function budgetView() {
  const rows = budgetRows(items, budgets, budgetMonth, requests);
  return `<section class="panel prose"><div class="budget-heading"><div><h2>预算有边界，支出有依据</h2><p>部门月度额度 · 已付款 + 在途占用 = 已使用预算</p></div><label>查看月份 <input type="month" id="budget-month" value="${budgetMonth}"></label></div><div class="budget-cards">${rows.map((x) => `<article class="budget-card"><div class="budget-card-title"><h3>${esc(x.department)}</h3><span class="badge ${x.ratio >= 1 ? "s4" : x.ratio >= 0.8 ? "s0" : "s3"}">${x.ratio >= 1 ? "预算已耗尽" : x.ratio >= 0.8 ? "接近额度" : "额度充足"}</span></div><p>月度预算 <b>${money(x.limit)}</b></p><div class="budget-total">${money(x.paid + x.reserved)}<small>已使用 · ${(x.ratio * 100).toFixed(1)}%</small></div><div class="budget-bar"><span style="width:${Math.min(100, x.ratio * 100)}%;background:${x.ratio >= 1 ? "#dd8173" : x.ratio >= 0.8 ? "#e3ad55" : "#6c85e4"}"></span></div><dl><div><dt>已付款</dt><dd>${money(x.paid)}</dd></div><div><dt>报销在途</dt><dd>${money(x.reimbursementReserved)}</dd></div><div><dt>申请剩余预留</dt><dd>${money(x.applicationReserved)}</dd></div><div><dt>${x.available < 0 ? "超出额度" : "可用余额"}</dt><dd class="${x.available < 0 ? "risk" : ""}">${money(Math.abs(x.available))}</dd></div></dl>${role === "财务" ? `<button data-budget="${esc(x.department)}">调整预算额度</button>` : '<small class="muted">切换财务角色可调整额度</small>'}</article>`).join("")}</div><div class="review-box"><h3>预算口径说明</h3>已批准申请按申请月份预留未核销余额，关联报销不重复占用；结束申请释放余额。按报销提交日期归属月份；待审批、待审核和待付款计入在途占用，已付款计入实际支出，退回单释放占用，重提后重新占用。当前额度为各月份共用的演示标准，调整会影响所有月份。预算为软预警，不阻止提交或审批，也未按部门外的费用类型细分。</div></section>`;
}
function editBudget(department) {
  if (role !== "财务") return;
  modal(
    `<div class="modal-title"><h2>${esc(department)} · 调整月度额度</h2><button data-close aria-label="关闭">✕</button></div><p class="muted">演示额度适用于每个月份；本次调整将影响所有月份的统计。</p><form id="budget-form"><label>月度预算（元）<input name="limit" type="number" min="0.01" max="10000000" step="0.01" required value="${budgets[department]}"></label><label>调整原因<textarea name="reason" required maxlength="200" placeholder="例如：新增客户项目，需要增加差旅预算"></textarea></label><div class="actions"><button type="submit" class="primary">保存额度</button></div></form>`,
  );
  document.querySelector("#budget-form").onsubmit = (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const limit = Number(d.get("limit"));
    if (!Number.isFinite(limit) || limit <= 0 || !d.get("reason").trim())
      return toast("请填写有效额度和调整原因");
    budgets[department] = limit;
    localStorage.setItem("qingbao-budgets", JSON.stringify(budgets));
    let audit;
    try {
      audit = JSON.parse(localStorage.getItem("qingbao-budget-audit")) || [];
    } catch {
      audit = [];
    }
    audit.push({
      department,
      limit,
      reason: d.get("reason").trim(),
      time: new Date().toISOString(),
    });
    localStorage.setItem("qingbao-budget-audit", JSON.stringify(audit));
    record(
      "调整预算",
      department,
      `额度 ${money(limit)}；原因：${d.get("reason").trim()}`,
    );
    render();
    toast("预算额度已更新");
  };
}
function policyView() {
  return `<section class="panel prose"><div class="section-intro"><span class="section-mark">⚙</span><div><h2>将费用制度，转成清晰规则</h2><p>固定流程：员工提交 → 部门主管 → 财务审核 → 付款登记</p></div></div><form id="policy-form"><div class="settings-row"><div><h3>单笔费用上限</h3><p>超过上限触发预警；财务不能通过有未解决风险的报销。</p></div><label>金额（元）<input type="number" name="limit" min="0.01" max="1000000" step="0.01" required value="${policy.limit}" ${role !== "财务" ? "disabled" : ""}></label></div><div class="settings-row"><div><h3>附件完整性</h3><p>未记录附件文件名时提示补充；不校验文件内容。</p></div><label class="check-line"><input type="checkbox" name="requireReceipt" ${policy.requireReceipt ? "checked" : ""} ${role !== "财务" ? "disabled" : ""}>启用检查</label></div><div class="settings-row"><div><h3>发票号码查重</h3><p>与其他已提交且未退回单据比较；草稿不参与查重。</p></div><label class="check-line"><input type="checkbox" name="checkDuplicate" ${policy.checkDuplicate ? "checked" : ""} ${role !== "财务" ? "disabled" : ""}>启用检查</label></div>${role === "财务" ? '<label>变更原因<textarea name="reason" required maxlength="200" placeholder="填写本次规则调整的业务原因"></textarea></label><div class="actions"><button class="primary" type="submit">保存规则</button></div>' : '<p class="footnote">切换财务角色可配置规则。</p>'}</form><div class="review-box">规则变更会立即重新计算所有报销的预审提示，包括历史单据；不会更改原审批结论或触发付款。此版本没有历史规则快照。预算仍为独立的软预警。</div></section>`;
}
function auditView() {
  const legacy = JSON.parse(
    localStorage.getItem("qingbao-budget-audit") || "[]",
  );
  return `<section class="panel"><div class="panel-title"><div><h3>操作记录</h3><span>记录本浏览器中的关键业务动作 · 最新在前 · 最多 1000 条</span></div><span class="badge">${audit.length} 条</span></div><div class="table-wrap"><table><thead><tr><th>时间</th><th>角色</th><th>动作</th><th>对象</th><th>说明</th></tr></thead><tbody>${audit.map((x) => `<tr><td>${esc(x.time)}</td><td>${esc(x.actor)}</td><td>${esc(x.action)}</td><td>${esc(x.target)}</td><td class="wrap-cell">${esc(x.note || "—")}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">暂无记录，创建报销或调整规则后会显示在这里</td></tr>'}</tbody></table></div>${legacy.length ? `<div class="prose"><h3>早期预算调整记录</h3>${legacy.map((x) => `<p>${esc(x.time)} · ${esc(x.department)} · ${money(x.limit)} · ${esc(x.reason)}</p>`).join("")}</div>` : ""}<div class="footnote prose">演示记录保存在浏览器，可随备份迁移；不具备服务端防篡改审计能力。早期报销记录请查看各单据的流转记录。</div></section>`;
}
function dataView() {
  return `<section class="panel prose"><div class="section-intro"><span class="section-mark">⇅</span><div><h2>让演示数据，随作品一起迁移</h2><p>无需真实财务资料。备份用于更换浏览器、设备或演示前留档。</p></div></div><div class="data-cards"><article><h3>导出完整备份</h3><p>包含报销、费用申请、规则、部门预算及操作记录，JSON 格式。角色为演示身份，导出不代表真实数据权限。</p><button id="backup" class="primary">下载数据备份</button></article><article><h3>导入已有备份</h3><p>校验格式后替换当前数据。建议先导出；浏览器会要求你确认覆盖。</p><label>选择轻报 JSON 备份<input id="restore" type="file" accept=".json,application/json"></label></article></div><div class="review-box"><h3>使用范围</h3>所有记录仅在当前浏览器中存储，清理浏览器数据会丢失。不同设备不会同步。本原型不是生产财务系统，请使用虚构票据。</div><h3>面试演示路线</h3><div class="demo-steps"><div><b>01</b><h3>完成一笔报销</h3><p>员工创建 → 主管通过 → 财务审核 → 付款登记。</p></div><div><b>02</b><h3>处理一笔异常</h3><p>发现重复票据 → 退回 → 员工修正 → 重提审批。</p></div><div><b>03</b><h3>解释产品决策</h3><p>调整预算查看预警，配置规则观察变化，在操作记录追踪动作。</p></div></div></section>`;
}
function downloadFile(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bindMore() {
  document
    .querySelector("#research-export")
    ?.addEventListener("click", () =>
      downloadFile(
        researchCsv(),
        "轻报-可用性测试空白记录.csv",
        "text/csv;charset=utf-8",
      ),
    );
  document
    .querySelector("#print-case")
    ?.addEventListener("click", () => window.print());
  document.querySelector("#case-to-guide")?.addEventListener("click", () => {
    page = "演示指南";
    render();
  });
  document.querySelector("#policy-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (role !== "财务") return;
    const d = new FormData(e.target);
    try {
      const next = validatePolicy({
        limit: Number(d.get("limit")),
        requireReceipt: d.has("requireReceipt"),
        checkDuplicate: d.has("checkDuplicate"),
      });
      if (!d.get("reason").trim()) return toast("请填写变更原因");
      const before = { ...policy };
      policy = next;
      localStorage.setItem("qingbao-policy", JSON.stringify(policy));
      record(
        "调整预审规则",
        "费用政策",
        `${d.get("reason").trim()}；单笔上限 ${before.limit} → ${policy.limit}，附件检查 ${policy.requireReceipt ? "开启" : "关闭"}，查重 ${policy.checkDuplicate ? "开启" : "关闭"}`,
      );
      render();
      toast("规则已保存，预审提示已重新计算");
    } catch (e) {
      toast(e.message);
    }
  });
  document.querySelector("#backup")?.addEventListener("click", () => {
    if (!requestStoreHealthy)
      return toast("费用申请存储无法读取，不能导出完整备份；原始数据未改动");
    const backup = {
      format: "qingbao-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      requests,
      items,
      budgets,
      policy,
      audit,
    };
    downloadFile(
      JSON.stringify(backup, null, 2),
      "轻报-数据备份.json",
      "application/json",
    );
    toast("已生成备份，请在浏览器下载列表查看");
  });
  document.querySelector("#restore")?.addEventListener("change", async (e) => {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("备份文件不能超过 5 MB");
      const data = validateBackup(JSON.parse(await file.text()));
      if (data.requests === undefined && !requestStoreHealthy)
        throw new Error(
          "旧备份未包含申请，不能覆盖无法读取的原申请数据；请使用包含申请的有效备份",
        );
      const nextRequests =
        data.requests === undefined ? requests : data.requests;
      validateRequestSet(nextRequests, data.items);
      if (
        !confirm(
          `将使用备份中的 ${data.items.length} 笔报销替换当前数据。${data.requests === undefined ? "旧备份不含申请，保留现有费用申请" : `同时替换为 ${nextRequests.length} 笔费用申请`}，继续吗？`,
        )
      ) {
        input.value = "";
        return;
      }
      requests = nextRequests;
      requestStoreHealthy = true;
      saveRequests();
      items = data.items;
      budgets = data.budgets;
      policy = data.policy;
      audit = data.audit;
      save();
      localStorage.setItem("qingbao-budgets", JSON.stringify(budgets));
      localStorage.setItem("qingbao-policy", JSON.stringify(policy));
      localStorage.removeItem("qingbao-budget-audit");
      record("导入备份", "演示空间", `导入 ${items.length} 笔报销`);
      filter = "全部";
      query = "";
      render();
      toast("备份已恢复");
    } catch (err) {
      toast("导入失败：" + err.message);
      input.value = "";
    }
  });
}
function paymentFields() {
  return `<div class="review-box"><h3>登记线下付款</h3><div class="form-grid"><label>付款日期<input type="date" id="payment-date" value="${new Date().toLocaleDateString("sv-SE")}"></label><label>付款方式<select id="payment-method"><option>银行转账</option><option>其他线下付款</option></select></label></div><label>付款参考号<input id="payment-reference" maxlength="60" placeholder="例如 DEMO-202610-001（仅演示）"></label><label class="check-line"><input id="payment-confirm" type="checkbox">确认仅登记模拟记录，不会实际转账</label></div>`;
}
function matchingInvoices() {
  return invoiceRows(items, role === "员工" ? "林晓" : null).filter(
    (x) =>
      (invoiceFilter === "全部" || x.duplicate) &&
      [x.invoice, x.receipt, x.employee, x.name]
        .join(" ")
        .includes(invoiceQuery),
  );
}
function invoiceView() {
  const rows = matchingInvoices();
  return `<section class="panel"><div class="panel-title"><div><h3>发票与报销，一处追踪</h3><span>关联报销票据索引 · 不存储原文件、不验证发票真伪</span></div><button id="invoice-export">↓ 导出台账</button></div><div class="toolbar"><div class="tabs">${["全部", "重复号码"].map((t) => `<button data-invoice-filter="${t}" class="${invoiceFilter === t ? "chosen" : ""}">${t}</button>`).join("")}</div><input id="invoice-search" aria-label="搜索发票台账" value="${esc(invoiceQuery)}" placeholder="搜索号码、附件、姓名或事项"></div><div class="table-wrap"><table><thead><tr><th>发票号码 / 附件名称</th><th>关联报销</th><th>申请人</th><th class="amount">关联报销金额</th><th>报销状态</th><th>号码检查</th><th>操作</th></tr></thead><tbody>${rows.map((x) => `<tr><td><strong>${esc(x.invoice || "未填写号码")}</strong><small>${esc(x.receipt || "未提供附件")}</small></td><td><strong>${esc(x.name)}</strong><small>${esc(x.id)}</small></td><td>${esc(x.employee)}</td><td class="amount">${money(x.amount)}</td><td><span class="badge">${x.status}</span></td><td><span class="${x.duplicate ? "risk" : "safe"}">${x.duplicate ? "⚑ 疑似重复" : !x.invoice ? "未填写号码" : ["已退回", "已撤回"].includes(x.status) ? "不参与查重" : "✓ 未发现重复"}</span></td><td><button class="link" data-detail="${esc(x.id)}">查看报销 →</button></td></tr>`).join("") || '<tr><td colspan="7" class="empty">没有符合条件的关联票据</td></tr>'}</tbody></table></div><div class="table-footer">共 ${rows.length} 条关联记录<span>金额为报销金额，并非独立票面金额</span></div><p class="footnote prose">同一号码的有效报销将同时标记。草稿不展示；退回、撤回单保留索引，但不占用号码。预审规则关闭查重后，此台账仍展示号码重复情况，供人工核对。</p></section>`;
}
function guideView() {
  return `<section class="panel prose"><div class="section-intro"><span class="section-mark">▷</span><div><h2>五分钟，讲清一个产品闭环</h2><p>按场景操作，展示问题、方案与取舍。所有样例均为虚构数据。</p></div></div><div class="guide-grid">${[
    [
      "01",
      "员工提交与纠错",
      "体验如何减少返工",
      "员工",
      "报销管理",
      "可先载入虚构样票体验 OCR，核对后填入；保存草稿并补充用途后提交。发现错误可在主管审批前撤回再修改。",
      "设计理由：区分草稿、撤回和退回，既降低输入成本，也保持审批状态清晰。",
    ],
    [
      "02",
      "主管与财务协作",
      "完成从审批到付款的闭环",
      "主管",
      "审批中心",
      "主管通过后切财务审核。付款时填写模拟参考号并确认仅作登记，完成后查看付款记录。",
      "设计理由：审批通过和实际付款是不同事件，不能用一个“完成”状态代替。",
    ],
    [
      "03",
      "异常票据与预算",
      "用具体案例说明风险前置",
      "财务",
      "发票台账",
      "打开重复号码筛选；查看重复票据关联哪些报销。再到预算管理调整额度，观察在途占用与余额。",
      "设计理由：号码查重是风险提示而非真伪判断，预算采用软预警以先验证管控价值。",
    ],
    [
      "04",
      "规则配置与验证",
      "说明产品决策与验证边界",
      "财务",
      "规则配置",
      "调整单笔上限并填写原因，到操作记录查看变化。用数据管理导出备份，保留演示现场。",
      "设计理由：配置要可追踪；当前仍需验证真实用户理解程度，不能把测试通过说成业务效果提升。",
    ],
  ]
    .map(
      ([n, title, subtitle, r, p, steps, why]) =>
        `<article class="guide-card"><span class="guide-number">${n}</span><small>${subtitle}</small><h3>${title}</h3><p>${steps}</p><div class="guide-why">${why}</div><button class="primary" data-guide-role="${r}" data-guide-page="${p}">以${r}身份开始 →</button></article>`,
    )
    .join(
      "",
    )}</div><div class="review-box"><h3>如实介绍 AI 的作用</h3>可以表述为：“我负责定位、范围和业务流程，借助 AI 完成原型开发与场景验证。”产品内预审目前为确定性规则，图片 OCR 已可在浏览器运行；预审没有调用大模型，也没有真实财务数据或转账能力。首次体验建议使用已有样例；如需重置，可先在数据管理中导出备份。</div></section>`;
}
function bindExpenses() {
  document.querySelectorAll("[data-invoice-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        invoiceFilter = b.dataset.invoiceFilter;
        render();
      }),
  );
  document.querySelector("#invoice-search")?.addEventListener("input", (e) => {
    invoiceQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector("#invoice-search");
    input.focus();
    input.setSelectionRange(pos, pos);
  });
  document.querySelector("#invoice-export")?.addEventListener("click", () => {
    const cell = (x) =>
      '"' +
      String(x)
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const data = [
      [
        "发票号码",
        "附件名称",
        "报销单号",
        "事项",
        "申请人",
        "关联报销金额",
        "状态",
        "疑似重复",
      ],
      ...matchingInvoices().map((x) => [
        x.invoice,
        x.receipt,
        x.id,
        x.name,
        x.employee,
        x.amount,
        x.status,
        x.duplicate ? "是" : "否",
      ]),
    ];
    downloadFile(
      "\ufeff" + data.map((r) => r.map(cell).join(",")).join("\r\n"),
      "轻报-发票关联台账.csv",
      "text/csv;charset=utf-8",
    );
  });
  document.querySelectorAll("[data-guide-role]").forEach(
    (b) =>
      (b.onclick = () => {
        role = b.dataset.guideRole;
        page = b.dataset.guidePage;
        filter = "全部";
        query = "";
        render();
        toast("已进入练习场景，可随时回到演示指南");
      }),
  );
}
function bindRequests() {
  document.querySelector("#new-request")?.addEventListener("click", newRequest);
  document
    .querySelectorAll("[data-request]")
    .forEach((b) => (b.onclick = () => requestDetail(b.dataset.request)));
}
function newRequest() {
  if (role !== "员工") return toast("请切换员工角色创建费用申请");
  if (!requestStoreHealthy)
    return toast("费用申请存储无法读取，原数据未改动，请恢复有效备份");
  modal(
    `<div class="modal-title"><h2>新建费用申请</h2><button data-close aria-label="关闭">✕</button></div><p class="muted">林晓 · 销售部 · 尚未批准前不占用预算</p><form id="request-form"><label>申请事项<input name="name" maxlength="60" required placeholder="例如：华东客户拜访"></label><div class="form-grid"><label>计划月份<input type="month" name="month" required value="${new Date().toLocaleDateString("sv-SE").slice(0, 7)}"></label><label>申请额度（元）<input type="number" name="amount" min="0.01" max="1000000" step="0.01" required></label></div><label>费用类型<select name="type">${["差旅交通", "业务招待", "办公采购", "其他费用"].map((t) => `<option>${t}</option>`).join("")}</select></label><label>用途说明<textarea name="note" required maxlength="500" placeholder="说明业务必要性、预计费用和使用范围"></textarea></label><div class="actions"><button type="submit" class="primary">提交申请</button></div></form>`,
  );
  const f = document.querySelector("#request-form");
  f.addEventListener("input", () => (f.dataset.dirty = "true"));
  f.onsubmit = (e) => {
    e.preventDefault();
    const d = new FormData(f);
    try {
      const r = validateRequest({
        id: "SQ" + crypto.randomUUID(),
        name: d.get("name").trim(),
        month: d.get("month"),
        amount: Number(d.get("amount")),
        type: d.get("type"),
        note: d.get("note").trim(),
        employee: "林晓",
        department: "销售部",
        status: "待审批",
        history: [
          {
            text: "员工提交费用申请",
            time: new Date().toLocaleString("zh-CN"),
          },
        ],
      });
      if (requests.length >= 1000) throw Error("费用申请已达 1000 条上限");
      saveRequests([r, ...requests]);
      record("提交费用申请", r.id, r.name);
      render();
      toast("申请已提交，待主管审批");
    } catch (e) {
      toast(e.message);
    }
  };
}
function requestDetail(id) {
  const r = requests.find((r) => r.id === id);
  if (!r) return;
  const departmentBudget = budgetRows(items, budgets, r.month, requests).find(
    (b) => b.department === r.department,
  );
  const approvalAvailable =
    departmentBudget.available - (r.status === "待审批" ? r.amount : 0);
  const b = requestBalance(r, items),
    linked = items.filter((x) => x.requestId === r.id);
  const approval = role === "主管" && r.status === "待审批",
    close =
      role === "员工" &&
      r.employee === "林晓" &&
      ["待审批", "已批准"].includes(r.status);
  modal(
    `<div class="modal-title"><div><small>${esc(r.id)}</small><h2>${esc(r.name)}</h2></div><button data-close aria-label="关闭">✕</button></div><div class="detail-amount">${money(r.amount)} <span class="badge">${r.status}</span></div><p>${esc(r.employee)} · ${esc(r.department)} · ${esc(r.month)} · ${esc(r.type)}</p><p>${esc(r.note)}</p><div class="review-box">已关联 ${money(b.used)} · 剩余额度 ${money(b.remaining)}<p>${r.status === "已批准" ? "余额正在预留预算" : "当前不预留预算"}。${b.unpaid ? "仍有在途报销，不能结束申请。" : "可结束申请并释放尚未使用的余额。"}</p></div><div class="review-box"><h3>部门预算影响</h3><p>月度预算 ${money(departmentBudget.limit)} · 当前可用 ${money(departmentBudget.available)}</p>${r.status === "待审批" ? `<p class="${approvalAvailable < 0 ? "risk" : "safe"}">批准后预计可用 ${money(approvalAvailable)}</p>` : ""}<small>部门预算为软预警，不阻止批准；关联报销不能超过申请本身的批准额度。</small></div><h3>关联报销</h3>${linked.length ? linked.map((x) => `<p>${esc(x.name)} · ${money(x.amount)} · ${x.status}</p>`).join("") : '<p class="muted">暂无关联报销</p>'}<h3>申请流转记录</h3><div class="timeline">${r.history.map((h) => `<p>${esc(h.text)}<small>${esc(h.time)}</small></p>`).join("")}</div>${approval || close ? `<label>处理原因<textarea id="request-reason" maxlength="200" placeholder="驳回或结束时必填"></textarea></label><div class="actions">${approval ? '<button data-request-action="reject">驳回申请</button><button class="primary" data-request-action="approve">批准申请</button>' : '<button data-request-action="close">结束申请并释放余额</button>'}</div>` : '<p class="footnote">审批由主管处理；员工可在无在途报销时结束自己的申请。</p>'}`,
  );
  document.querySelectorAll("[data-request-action]").forEach(
    (button) =>
      (button.onclick = () => {
        try {
          const next = requestAction(
            r,
            button.dataset.requestAction,
            role,
            "林晓",
            items,
            document.querySelector("#request-reason").value,
          );
          saveRequests(requests.map((x) => (x.id === r.id ? next : x)));
          record(
            "费用申请" + next.status,
            r.id,
            document.querySelector("#request-reason").value,
          );
          render();
          toast("申请已更新，预算占用已重新计算");
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
