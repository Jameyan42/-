import { evaluatePrecheck } from "./precheck.js";
import {
  precheckPanel,
  precheckBadge,
  precheckHistory,
  precheckSettings,
  collectPrecheck,
} from "./precheck-ui.js";
import {
  emptyEnterprise,
  validateEnterprise,
  persistEnterprise,
  enterpriseKey,
  enterprisePages,
} from "./enterprise.js";
import { enterpriseView, mountEnterprise } from "./enterprise-ui.js";
import {
  emptyMessageRead,
  validateMessageRead,
  markMessagesRead,
  businessMessages,
  filterMessages,
} from "./messages.js";
import { messagesView } from "./messages-ui.js";
import {
  assertUniqueReference,
  batchReferences,
  batchPayment,
  paymentCsv,
} from "./payment-batch.js";
import {
  attachmentEditor,
  mountAttachmentEditor,
  attachmentDetails,
  bindAttachmentDetails,
} from "./attachments-ui.js";
import {
  persistExpenseItems,
  serializeExpenseItems,
  writeStorageBatch,
} from "./attachments.js";
import { requestProgressRows, requestProgressCsv } from "./request-progress.js";
import { requestProgressView } from "./request-progress-ui.js";
import {
  travelForm,
  mountTravelForm,
  tripSummary,
  travelSummary,
  travelStandardsView,
} from "./travel-ui.js";
import { validateTravel, assertTravelSubmission } from "./travel.js";
import { ownsExpense } from "./expense-progress.js";
import { expenseProgressView } from "./expense-progress-ui.js";
import {
  validateDateRange,
  datePreset,
  processingTimeZone,
} from "./processing-dates.js";
import { locateOrganization, parseChartKey } from "./org-search.js";
import { processedRows, processedCsv } from "./operations.js";
import { processedView } from "./processed-ui.js";
import { orgChartView } from "./org-chart.js";
import { paymentRows, paymentView } from "./payment-ui.js";
import { canHandleDocument, inboxRows, inboxCsv } from "./inbox.js";
import { inboxView } from "./inbox-ui.js";
import {
  defaultOrg,
  enterpriseOrg,
  addFinanceOrganization,
  roles,
  assertOrgChange,
} from "./organization.js";
import {
  defaultFlows,
  financeDivisionFlows,
  validateFlows,
  compileApproval,
  approvalStatus,
} from "./approval.js";
import {
  flowView,
  collectFlow,
  personForm,
  departmentForm,
  approvalTimeline,
} from "./config-ui.js";
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
let policy,
  audit,
  policyHealthy = true;
try {
  const raw = localStorage.getItem("qingbao-policy");
  policy =
    raw === null
      ? structuredClone(defaultPolicy)
      : validatePolicy(JSON.parse(raw));
} catch {
  policy = structuredClone(defaultPolicy);
  policyHealthy = false;
}

try {
  audit = JSON.parse(localStorage.getItem("qingbao-audit")) || [];
} catch {
  audit = [];
}
function record(action, target, note = "") {
  audit.unshift({
    actor: `${currentEmployee()}（${role}）`,
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
let enterprise = emptyEnterprise(),
  enterpriseHealthy = true;
try {
  const raw = localStorage.getItem(enterpriseKey);
  enterprise =
    raw === null ? emptyEnterprise() : validateEnterprise(JSON.parse(raw));
} catch {
  enterpriseHealthy = false;
}
function saveEnterprise(next) {
  if (!enterpriseHealthy) throw Error("企业业务存储异常，原始值已保留");
  if (!configHealthy) throw Error("组织/流程存储异常，请先恢复有效备份");
  assertOrgChange(configuration.org, configuration.org, next.payments);
  enterprise = persistEnterprise(localStorage, next);
}
let configuration = { org: enterpriseOrg(), flows: defaultFlows() },
  configHealthy = true;
try {
  configuration =
    JSON.parse(localStorage.getItem("qingbao-configuration-v1")) ||
    configuration;
  validateFlows(configuration.flows, configuration.org);
  assertOrgChange(configuration.org, configuration.org, [
    ...items,
    ...requests,
    ...enterprise.payments,
  ]);
} catch {
  configuration = { org: defaultOrg(), flows: defaultFlows() };
  configHealthy = false;
}
let messageRead = emptyMessageRead(),
  messageReadHealthy = true;
try {
  const raw = localStorage.getItem("qingbao-message-read-v1");
  messageRead =
    raw === null ? emptyMessageRead() : validateMessageRead(JSON.parse(raw));
} catch {
  messageReadHealthy = false;
}
let messageType = "all",
  messageUnread = "all",
  messageQuery = "",
  messagePage = 0;
function currentMessages() {
  return businessMessages(
    items,
    requests,
    currentActor(),
    configuration.org,
    messageRead,
  );
}
function markVisibleMessages(keys) {
  if (!messageReadHealthy) throw Error("消息已读存储异常，原始值已保留");
  const allowed = new Set(currentMessages().map((r) => r.key));
  if (keys.some((k) => !allowed.has(k)))
    throw Error("消息状态已变化，请重新查看");
  const next = markMessagesRead(messageRead, currentActor()?.id, keys);
  try {
    localStorage.setItem("qingbao-message-read-v1", JSON.stringify(next));
  } catch {
    throw Error("消息已读保存失败或容量不足，未改动已读状态");
  }
  messageRead = next;
}

let flowDraft = structuredClone(configuration.flows),
  flowTarget = "expense",
  orgMode = "reports",
  actorId = "manager-zhao";
try {
  const d = JSON.parse(localStorage.getItem("qingbao-flow-draft-v1"));
  if (
    d &&
    ["expense", "request"].every(
      (k) =>
        d[k] &&
        typeof d[k].threshold === "number" &&
        Number.isFinite(d[k].threshold) &&
        ["low", "high"].every(
          (b) =>
            Array.isArray(d[k][b]) &&
            d[k][b].length <= 4 &&
            d[k][b].every(
              (n) =>
                n &&
                ["manager", "departmentHead", "person"].includes(n.selector),
            ),
        ),
    )
  )
    flowDraft = d;
} catch {}
const orgChartState = {
  selected: null,
  zoom: 0.7,
  collapsed: new Set(),
  scrollLeft: null,
  scrollTop: 0,
  searchQuery: "",
  searchType: "all",
  focusKey: null,
};
let paymentSelected = new Set();
let paymentFilter = "待付款",
  paymentQuery = "";
function currentActor() {
  const people = configuration.org.people.filter(
    (p) => p.active && p.role === role,
  );
  return (
    people.find((p) => p.id === actorId) ||
    people.find(
      (p) =>
        p.id ===
        {
          员工: "lin",
          主管: "manager-zhao",
          财务: "finance-zhou",
          总账: "ledger-gao",
          付款: "payer-du",
          管理员: "admin-gu",
        }[role],
    ) ||
    people[0]
  );
}
function currentEmployee() {
  return currentActor()?.name || "";
}
function currentDepartment() {
  return (
    configuration.org.departments.find(
      (d) => d.id === currentActor()?.departmentId,
    )?.name || ""
  );
}
function canHandleExpense(x) {
  return canHandleDocument(x, "expense", currentActor());
}
let requestProgressStatus = "全部",
  requestProgressMonth = "",
  requestProgressQuery = "",
  requestProgressPage = 0;
let progressGroup = "all",
  progressQuery = "",
  progressPage = 0;
let inboxKind = "all",
  inboxQuery = "",
  inboxOrder = "oldest";
let inboxMode = "pending",
  processedResult = "all",
  processedPage = 0,
  processedFrom = "",
  processedTo = "",
  processedPreset = "all";
function processedRangeError() {
  try {
    validateDateRange(processedFrom, processedTo);
    return "";
  } catch (e) {
    return e.message;
  }
}
function processedOptions() {
  return {
    kind: inboxKind,
    query: inboxQuery,
    result: processedResult,
    order: inboxOrder,
    from: processedFrom,
    to: processedTo,
  };
}
function filteredProcessed() {
  return processedRangeError() ? [] : currentProcessed(processedOptions());
}
function currentProcessed(options = {}) {
  return processedRows(items, requests, currentActor(), options);
}
function approvalCenterView() {
  const tabs = `<div class="tabs approval-view-tabs"><button data-inbox-view="pending" class="${inboxMode === "pending" ? "chosen" : ""}">待我处理 (${currentInbox().length})</button><button data-inbox-view="processed" class="${inboxMode === "processed" ? "chosen" : ""}">我已处理 (${currentProcessed().length})</button></div>`;
  return (
    tabs +
    (inboxMode === "processed"
      ? processedView(
          currentProcessed(),
          filteredProcessed(),
          currentActor(),
          inboxKind,
          inboxQuery,
          processedResult,
          inboxOrder,
          requestStoreHealthy,
          processedPage,
          {
            from: processedFrom,
            to: processedTo,
            preset: processedPreset,
            error: processedRangeError(),
            timeZone: processingTimeZone(),
          },
        )
      : inboxView(
          currentInbox(),
          currentInbox({
            kind: inboxKind,
            query: inboxQuery,
            order: inboxOrder,
          }),
          currentActor(),
          inboxKind,
          inboxQuery,
          inboxOrder,
          requestStoreHealthy,
        ))
  );
}
function currentInbox(options = {}) {
  return inboxRows(items, requests, currentActor(), options);
}
function resetInboxFilters() {
  messageType = "all";
  messageUnread = "all";
  messageQuery = "";
  messagePage = 0;
  requestProgressStatus = "全部";
  requestProgressMonth = "";
  requestProgressQuery = "";
  requestProgressPage = 0;
  progressGroup = "all";
  progressQuery = "";
  progressPage = 0;
  inboxKind = "all";
  inboxQuery = "";
  processedResult = "all";
  processedPage = 0;
  processedFrom = "";
  processedTo = "";
  processedPreset = "all";
  paymentSelected.clear();
  paymentFilter = "待付款";
  paymentQuery = "";
}
function saveConfiguration(next) {
  if (!configHealthy)
    throw Error("组织/流程存储无法读取，原始数据未改动，请恢复有效配置备份");
  if (!enterpriseHealthy)
    throw Error("企业业务存储异常，不能核对对公在途人员，原配置未改动");
  assertOrgChange(configuration.org, next.org, [
    ...items,
    ...requests,
    ...enterprise.payments,
  ]);
  validateFlows(next.flows, next.org);
  localStorage.setItem("qingbao-configuration-v1", JSON.stringify(next));
  configuration = next;
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
function expensePrecheck(x) {
  return evaluatePrecheck("expense", x, { items }, policy);
}
function requirePolicyForApproval(status) {
  if (!policyHealthy && ["待财务审核", "待总账复核", "待付款"].includes(status))
    throw Error(
      "预审规则存储异常，不能通过财务/总账/付款；原规则已保留，请恢复有效备份",
    );
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
      (role !== "员工" || x.employee === currentEmployee()) &&
      (filter === "全部" || x.status === filter) &&
      (!query || [x.name, x.id, x.employee].join(" ").includes(query)),
  );
}
function render() {
  const navigationScroll = document.querySelector("aside")?.scrollTop || 0;
  actorId = currentActor()?.id || actorId;
  const pending = items.filter((x) =>
    ["待主管审批", "待财务审核", "待总账复核", "待付款"].includes(x.status),
  );
  app.innerHTML = `
<aside><a class="brand" href="#"><b>轻</b><span>轻报<small>QINGBAO EXPENSE</small></span></a><div class="workspace">星河科技 <span>演示空间</span></div><div class="nav-label">工作空间</div>${[
    ["工作台", "◫"],
    ["报销管理", "▤"],
    ["报销进度", "↗"],
    ["费用申请", "◇"],
    ["申请进度", "◎"],
    ["审批中心", "✓"],
    ["消息中心", "♧"],
    ["付款工作台", "¤"],
    ["对公支付单", "▣"],
    ["合同审查", "§"],
    ["供应商管理", "♙"],
    ["费用洞察", "◷"],
    ["预算管理", "▥"],
    ["发票台账", "▧"],
    ["规则配置", "⚙"],
    ["差旅标准", "✈"],
    ["组织架构", "♧"],
    ["审批流程", "⌘"],
    ["操作记录", "≡"],
    ["数据管理", "⇅"],
    ["演示指南", "▷"],
    ["项目案例", "◈"],
    ["体验测试", "◎"],
    ["产品说明", "◇"],
  ]
    .map(
      ([p, i]) =>
        `<button class="nav ${page === p ? "active" : ""}" data-page="${p}"><span>${i}</span>${p}${p === "审批中心" ? `<em>${currentInbox().length}</em>` : p === "消息中心" ? `<em>${messageReadHealthy && requestStoreHealthy ? currentMessages().filter((r) => r.unread).length : "?"}</em>` : ""}</button>`,
    )
    .join(
      "",
    )}<div class="sidebar-bottom"><span class="green-dot"></span> 本地演示 · 数据保存在浏览器<p>为 200 人成长型企业设计</p></div></aside>
<div class="shell"><header><div>工作空间 <span>/</span> ${page}</div><div class="header-right"><span class="demo-tag">产品原型</span><label>体验角色 <select id="role">${roles.map((r) => `<option ${r === role ? "selected" : ""}>${r}</option>`).join("")}</select></label><label>模拟身份 <select id="actor">${configuration.org.people
    .filter((p) => p.active && p.role === role)
    .map(
      (p) =>
        `<option value="${esc(p.id)}" ${p.id === actorId ? "selected" : ""}>${esc(p.name)}</option>`,
    )
    .join(
      "",
    )}</select></label><div class="avatar">${esc(currentEmployee()[0] || "人")}</div></div></header>
<main><div class="page-heading"><div><div class="eyebrow">让每一笔费用，都清晰有序</div><h1>${page === "工作台" ? "工作台" : page}</h1><p>${esc(currentEmployee())}，你好。${role === "管理员" ? "维护虚构组织与审批配置，查看发布结果。" : role === "员工" ? "提交费用、追踪进度，让报销更轻松。" : "查看待办，按节点分工处理费用。"}</p></div>${enterprisePages.includes(page) ? "" : `<button class="primary" id="create">＋ 新建报销</button>`}</div>
${
  enterprisePages.includes(page)
    ? enterpriseView(
        page,
        enterprise,
        currentActor(),
        enterpriseHealthy,
        configuration.flows,
        policy,
        policyHealthy,
      )
    : page === "消息中心"
      ? messagesView(
          currentMessages(),
          currentActor(),
          {
            type: messageType,
            unread: messageUnread,
            query: messageQuery,
            page: messagePage,
          },
          messageReadHealthy,
          requestStoreHealthy,
        )
      : page === "申请进度"
        ? requestProgressView(
            requests,
            items,
            currentActor(),
            configuration.org,
            {
              status: requestProgressStatus,
              month: requestProgressMonth,
              query: requestProgressQuery,
              page: requestProgressPage,
            },
            requestStoreHealthy,
          )
        : page === "差旅标准"
          ? travelStandardsView()
          : page === "报销进度"
            ? expenseProgressView(items, currentActor(), configuration.org, {
                group: progressGroup,
                query: progressQuery,
                page: progressPage,
              })
            : page === "付款工作台"
              ? paymentView(
                  items,
                  currentActor(),
                  paymentFilter,
                  paymentQuery,
                  paymentSelected,
                )
              : page === "审批中心"
                ? approvalCenterView()
                : page === "组织架构"
                  ? orgChartView(
                      configuration.org,
                      role,
                      orgMode,
                      orgChartState,
                    )
                  : page === "审批流程"
                    ? flowView(
                        role === "管理员" ? flowDraft : configuration.flows,
                        configuration.flows,
                        configuration.org,
                        role,
                        flowTarget,
                      )
                    : page === "费用申请"
                      ? requestsView(requests, items, role, currentEmployee())
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
    ? `${role === "员工" ? '<div class="review-box"><b>想知道报销到哪一步？</b><p>查看当前节点、待处理人及退回说明。</p><button class="link" data-page="报销进度">打开我的报销进度 →</button></div>' : ""}<section class="stats">${[
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
          items.filter((x) => expensePrecheck(x).findings.length).length,
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
        )}</section><section class="assistant"><div class="spark">✧</div><div><h3>报销预审助手 <span>规则演示</span></h3><p>发现 ${items.filter((x) => expensePrecheck(x).findings.length).length} 笔报销需要关注。超标费用与重复票据已标记，建议优先核查。</p></div><button id="risks">查看风险单 →</button></section>`
    : ""
}
<section class="panel"><div class="panel-title"><div><h3>报销记录</h3><span>跟踪每一笔费用的处理进度</span></div><button class="quiet" id="export">↓ 导出 CSV</button></div><div class="toolbar"><div class="tabs">${["全部", "草稿", "待主管审批", "待财务审核", "待总账复核", "待付款", "已付款", "已退回", "已撤回"].map((s) => `<button data-filter="${s}" class="${filter === s ? "chosen" : ""}">${s === "待主管审批" ? "待审批" : s === "待财务审核" ? "待审核" : s}</button>`).join("")}</div><input id="search" aria-label="搜索报销" placeholder="⌕ 搜索名称、单号或姓名" value="${esc(query)}"></div><div class="table-wrap"><table><thead><tr><th>报销事项 / 单号</th><th>申请人</th><th>费用类型</th><th class="amount">报销金额</th><th>状态</th><th>预审结果</th><th>操作</th></tr></thead><tbody>${
                                              visible()
                                                .map(
                                                  (x) =>
                                                    `<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.id)} · ${x.date}</small></td><td><div class="person"><span>${esc(x.employee[0])}</span><div>${esc(x.employee)}<small>${esc(x.department)}</small></div></div></td><td>${esc(x.type)}</td><td class="amount"><strong>${money(x.amount)}</strong></td><td><span class="badge s${["待主管审批", "待财务审核", "待总账复核", "待付款", "已付款", "已退回", "已撤回"].indexOf(x.status)}">${x.status}</span>${x.approval && ["待主管审批", "待财务审核", "待总账复核", "待付款"].includes(x.status) ? `<small>待 ${esc((x.status === "待付款" ? x.approval.paymentActor || x.approval.nodes.at(-1) : x.approval.nodes[x.approval.cursor] || x.approval.nodes.at(-1)).actorName)} 处理</small>` : ""}</td><td>${policyHealthy ? precheckBadge(expensePrecheck(x)) : '<span class="risk">规则无法读取</span>'}</td><td><button class="link" data-detail="${esc(x.id)}">查看 →</button></td></tr>`,
                                                )
                                                .join("") ||
                                              '<tr><td colspan="7" class="empty">暂无符合条件的报销记录</td></tr>'
                                            }</tbody></table></div><div class="table-footer">共 ${visible().length} 条记录<span>所有金额均为人民币 CNY</span></div></section><div class="footnote">ⓘ 演示使用虚构人员与票据；预审为规则计算，未接入大模型、发票验真或银行付款。</div>`
}</main><footer>轻报 QINGBAO <span>让费用管理回归简单</span><button id="reset">重置演示数据</button></footer></div><div id="overlay"></div>`;
  bind();
  document.querySelector("aside").scrollTop = navigationScroll;
}
function about() {
  return `<section class="panel prose"><h2>用 AI 辅助构建，让产品思考可见</h2><p>轻报面向 200 人成长型企业的费控演示作品，覆盖员工差旅与对公支付两条业务线。产品假设和自动化测试不代表真实用户研究或生产效果。</p><h3>员工费用闭环</h3><p>费用申请与出差行程 → 多项费用明细及酒店水单等附件 → 报销提交 → 具名审批 → 财务审核 → 总账复核 → 模拟付款。管理员先发布财务分工模板，新单按版本生成审批快照；旧单保留原路径。</p><h3>对公支付闭环</h3><p>管理员维护供应商和虚构收款账户 → 员工提交合同 → 本地规则初筛 → 财务或管理员阅读全文并复核 → 员工按本人已复核合同发起对公支付单 → 部门业务节点、财务、总账、指定付款人员逐级办理。合同在途与已付共同占用额度，退回或撤回释放；供应商变更不改写已提交单据收款快照。</p><h3>报销与对公规则预审</h3><p>可配置10条补充规则、阈值及提醒/拦截，展示触发依据、关联单号和核对建议。当前规则在财务、总账和付款时重新检查，主管仍可转交财务；每次处理保留规则参数与结果，历史不随当前配置改写。它不是AI、发票验真或自动审批。</p><h3>合同审查范围</h3><p>支持粘贴正文与UTF-8 TXT导入，对主体、付款、验收、发票、违约及争议条款做透明规则初筛，显示片段与人工核对建议。不是大模型或法律意见；真实 AI 尚未连接，PDF/DOCX正文提取尚未提供。</p><h3>存储与使用范围</h3><p>数据与报销附件原文件保存在本浏览器，可下载备份后迁移。浏览器OCR不上传图片，发票识别不等于验真。角色选择是演示机制，没有生产鉴权、后端并发或跨设备实时同步。只使用虚构资料，模拟付款不执行转账。</p><h3>当前模块边界</h3><p>对公任务在对公支付单办理，尚未统一到原审批中心、消息中心和报销付款工作台；对公合同额度与原部门报销预算分别统计。对公履约附件与发票验真、真实银行支付、总账凭证、真实 AI 待后续接入。</p></section>`;
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
    )}<h3>流程分布</h3><div class="flow">${["待主管审批", "待财务审核", "待总账复核", "待付款", "已付款", "已退回", "已撤回"].map((s) => `<div><h2>${items.filter((x) => x.status === s).length}</h2>${s}</div>`).join("")}</div></section>`;
}
function canLeaveOrgEditor() {
  return (
    !document.querySelector("#org-inspector-form")?.dataset.dirty ||
    confirm("节点修改尚未保存，是否放弃修改并切换？")
  );
}
function bind() {
  mountEnterprise({
    page,
    getState: () => enterprise,
    actor: currentActor(),
    org: configuration.org,
    flows: configuration.flows,
    healthy: enterpriseHealthy,
    policy,
    policyHealthy,
    requirePolicy: requirePolicyForApproval,
    expenseItems: () => items,
    save: saveEnterprise,
    modal,
    render,
    toast,
    download: downloadFile,
    go: (next) => {
      page = next;
      render();
    },
  });
  for (const [id, set] of [
    ["message-type", (v) => (messageType = v)],
    ["message-unread", (v) => (messageUnread = v)],
  ])
    document.querySelector("#" + id)?.addEventListener("change", (e) => {
      set(e.target.value);
      messagePage = 0;
      render();
    });
  document.querySelector("#message-search")?.addEventListener("input", (e) => {
    messageQuery = e.target.value;
    const pos = e.target.selectionStart;
    messagePage = 0;
    render();
    const el = document.querySelector("#message-search");
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  document.querySelectorAll("[data-message-page]").forEach(
    (b) =>
      (b.onclick = () => {
        messagePage = Number(b.dataset.messagePage);
        render();
      }),
  );
  document.querySelector("#message-clear")?.addEventListener("click", () => {
    messageType = "all";
    messageUnread = "all";
    messageQuery = "";
    messagePage = 0;
    render();
  });
  document.querySelectorAll("[data-message-read]").forEach(
    (b) =>
      (b.onclick = () => {
        try {
          markVisibleMessages([b.dataset.messageRead]);
          render();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document
    .querySelector("#message-read-filtered")
    ?.addEventListener("click", () => {
      try {
        markVisibleMessages(
          filterMessages(currentMessages(), {
            type: messageType,
            unread: messageUnread,
            query: messageQuery,
          })
            .filter((r) => r.unread)
            .map((r) => r.key),
        );
        render();
        toast("当前筛选的全部消息已标为已读，业务待办未改变");
      } catch (e) {
        toast(e.message);
      }
    });
  document.querySelectorAll("[data-message-open]").forEach(
    (b) =>
      (b.onclick = () => {
        const r = currentMessages().find(
          (r) => r.key === b.dataset.messageOpen,
        );
        if (!r) return toast("消息状态已变化，请重新查看");
        try {
          markVisibleMessages([r.key]);
          render();
        } catch (e) {
          toast(e.message);
        }
        if (r.kind === "expense") detail(r.doc.id);
        else requestDetail(r.doc.id);
      }),
  );
  for (const [id, set] of [
    ["request-progress-status", (v) => (requestProgressStatus = v)],
    ["request-progress-month", (v) => (requestProgressMonth = v)],
  ])
    document.querySelector("#" + id)?.addEventListener("change", (e) => {
      set(e.target.value);
      requestProgressPage = 0;
      render();
    });
  document
    .querySelector("#request-progress-search")
    ?.addEventListener("input", (e) => {
      requestProgressQuery = e.target.value;
      const pos = e.target.selectionStart;
      requestProgressPage = 0;
      render();
      const el = document.querySelector("#request-progress-search");
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  document.querySelectorAll("[data-request-progress-page]").forEach(
    (b) =>
      (b.onclick = () => {
        requestProgressPage = Number(b.dataset.requestProgressPage);
        render();
      }),
  );
  document
    .querySelector("#request-progress-clear")
    ?.addEventListener("click", () => {
      requestProgressStatus = "全部";
      requestProgressMonth = "";
      requestProgressQuery = "";
      requestProgressPage = 0;
      render();
    });
  document
    .querySelector("#request-progress-export")
    ?.addEventListener("click", () => {
      if (!requestStoreHealthy)
        return toast("费用申请存储无法完整读取，不能导出");
      const options = {
        status: requestProgressStatus,
        month: requestProgressMonth,
        query: requestProgressQuery,
      };
      downloadFile(
        requestProgressCsv(
          requestProgressRows(
            requests,
            items,
            currentActor(),
            configuration.org,
            options,
          ),
          options,
        ),
        "轻报-本人申请进度.csv",
        "text/csv;charset=utf-8",
      );
    });
  document.querySelectorAll("[data-progress-group]").forEach(
    (b) =>
      (b.onclick = () => {
        progressGroup = b.dataset.progressGroup;
        progressPage = 0;
        render();
      }),
  );
  document.querySelectorAll("[data-progress-page]").forEach(
    (b) =>
      (b.onclick = () => {
        progressPage = Number(b.dataset.progressPage);
        render();
      }),
  );
  document.querySelector("#progress-clear")?.addEventListener("click", () => {
    progressGroup = "all";
    progressQuery = "";
    progressPage = 0;
    render();
  });
  document.querySelector("#progress-search")?.addEventListener("input", (e) => {
    progressQuery = e.target.value;
    const pos = e.target.selectionStart;
    progressPage = 0;
    render();
    const el = document.querySelector("#progress-search");
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  bindConfiguration();
  bindInbox();
  bindPayments();
  document.querySelector("#actor").onchange = (e) => {
    if (!canLeaveOrgEditor()) {
      e.target.value = actorId;
      return;
    }
    actorId = e.target.value;
    resetInboxFilters();
    render();
  };
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
        if (!canLeaveOrgEditor()) return;
        page = b.dataset.page;
        resetInboxFilters();
        filter = "全部";
        query = "";
        render();
      }),
  );
  document.querySelector("#role").onchange = (e) => {
    if (!canLeaveOrgEditor()) {
      e.target.value = role;
      return;
    }
    role = e.target.value;
    resetInboxFilters();
    render();
  };
  document.querySelector("#create")?.addEventListener("click", () => form());
  document.querySelector("#reset").onclick = () => {
    if (!policyHealthy)
      return toast("预审规则无法读取，原值已保留，请恢复有效备份");
    if (
      !enterpriseHealthy ||
      enterprise.suppliers.length ||
      enterprise.contracts.length ||
      enterprise.payments.length
    )
      return toast(
        "企业业务已有记录或无法读取，不能重置其关联组织；请先导出完整备份，换浏览器演示新空间。原数据未改动",
      );
    if (confirm("重置后将清除当前浏览器中的演示修改，是否继续？")) {
      configuration = { org: defaultOrg(), flows: defaultFlows() };
      configHealthy = true;
      saveConfiguration(configuration);
      flowDraft = structuredClone(configuration.flows);
      localStorage.setItem("qingbao-flow-draft-v1", JSON.stringify(flowDraft));
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
    const item = items.find((x) => expensePrecheck(x).findings.length);
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
      !confirm("本次填写尚未保存，确定关闭并放弃吗？")
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
  if (
    !x ||
    (role === "员工" && !ownsExpense(x, currentActor(), configuration.org))
  ) {
    toast("仅可查看本人的报销");
    return;
  }
  const precheck = expensePrecheck(x);
  const can = canHandleExpense(x);
  modal(
    `<div class="modal-title"><div><small>${esc(x.id)}</small><h2>${esc(x.name)}</h2></div><button data-close aria-label="关闭">✕</button></div><div class="detail-amount">${money(x.amount)} <span class="badge">${x.status}</span></div><div class="detail-grid"><p>申请人<b>${esc(x.employee)} · ${esc(x.department)}</b></p><p>费用类型<b>${esc(x.type)}</b></p><p>发票号码<b>${esc(x.invoice || "未填写")}</b></p><p>原票据附件名称（旧入口）<b>${esc(x.receipt || "未提供")}</b></p></div><p>${esc(x.note)}</p>${precheckPanel(precheck, { healthy: policyHealthy })}${precheckHistory(x.history)}${x.payment ? `<div class="review-box payment-summary"><h3>付款登记信息</h3><p>方式：${esc(x.payment.method)} · 日期：${esc(x.payment.date)}</p><p>参考号：${esc(x.payment.reference)}</p><small>仅作模拟登记，未连接银行或执行转账。</small></div>` : x.status === "已付款" ? '<p class="footnote">历史演示记录未提供付款参考号。</p>' : ""}${x.ocr ? '<p class="footnote">曾使用浏览器 OCR 辅助并由员工核对，识别不代表发票真实或字段准确。</p>' : ""}${x.requestId ? `<div class="review-box"><h3>关联费用申请</h3><p>${esc(requests.find((r) => r.id === x.requestId)?.name || x.requestId)}</p><small>提交时占用申请额度，付款后转为实际支出；未核销余额仍预留。</small></div>` : ""}${attachmentDetails(x.attachments)}${travelSummary(x.travel)}${x.ledgerReview ? `<div class="review-box ledger-summary"><h3>总账复核记录</h3><p>科目：${esc(x.ledgerReview.account)} · 核算归属：${esc(x.ledgerReview.costCenter)}</p><small>复核时间：${esc(new Date(x.ledgerReview.at).toLocaleString("zh-CN"))}；仅模拟记录，未生成会计凭证。</small></div>` : ""}${approvalTimeline(x)}<h3>流转记录</h3><div class="timeline">${x.history.map((h) => `<p>${esc(h.text)}<small>${esc(h.operation ? new Date(h.operation.at).toLocaleString("zh-CN") : h.time)}${h.operation ? " · " + esc(h.operation.actorName) + " · " + (h.operation.flowVersion ? "v" + h.operation.flowVersion : "历史固定流程") : ""}</small></p>`).join("")}</div>${role === "员工" && x.employee === currentEmployee() && x.status === "待主管审批" && (x.approval?.cursor || 0) === 0 ? '<div class="review-box"><label>撤回原因<textarea id="withdraw-reason" maxlength="200" placeholder="如金额填写有误，需要修改"></textarea></label><button id="withdraw">撤回并修改</button><p>仅主管审批前可撤回，之后需由审核人退回。</p></div>' : ""}${can ? `${x.status === "待付款" ? paymentFields() : x.status === "待总账复核" ? '<div class="review-box"><h3>总账复核信息</h3><label>总账科目<input id="ledger-account" maxlength="100" placeholder="如 6602 管理费用（仅演示）"></label><label>核算归属<input id="ledger-costcenter" maxlength="100" placeholder="如 法报中心 / 示例项目"></label><small>只记录复核信息，不生成会计凭证或自动记账。</small></div>' : ""}<label>处理备注<textarea id="reason" placeholder="退回时必须填写原因"></textarea></label><div class="actions"><button id="reject">退回修改</button><button class="primary" id="approve">${x.status === "待付款" ? "登记付款" : "审核通过"}</button></div>` : role === "员工" && x.employee === currentEmployee() && ["已退回", "草稿", "已撤回"].includes(x.status) ? `<button class="primary" id="edit">${x.status === "草稿" ? "继续填写草稿" : "修改并重新提交"}</button>` : '<p class="footnote">切换到审批路径中指定的角色和具体人员后处理。</p>'}`,
  );
  bindAttachmentDetails(document.querySelector("#overlay"), x.attachments);
  if (can) {
    document.querySelector("#reject").onclick = () => act("reject");
    document.querySelector("#approve").onclick = () => act("approve");
  }
  document.querySelector("#edit")?.addEventListener("click", () => form(x));
  document.querySelector("#withdraw")?.addEventListener("click", () => {
    try {
      const reason = document.querySelector("#withdraw-reason").value;
      const next = withdraw(x, currentEmployee(), reason);
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
    if (action === "approve") requirePolicyForApproval(items[i].status);
    const nextDoc = transition(
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
      currentActor(),
      selected.status === "待总账复核" && action === "approve"
        ? {
            account: document.querySelector("#ledger-account").value,
            costCenter: document.querySelector("#ledger-costcenter").value,
          }
        : null,
      { items, policy },
    );
    if (nextDoc.status === "已付款") {
      if (!enterpriseHealthy)
        throw Error("企业业务存储异常，不能核对付款参考号，未保存付款");
      assertUniqueReference(nextDoc.payment.reference, [
        ...items.filter((p) => p.id !== nextDoc.id),
        ...enterprise.payments,
      ]);
    }
    const nextItems = items.map((d, index) => (index === i ? nextDoc : d));
    persistExpenseItems(localStorage, nextItems);
    items = nextItems;
    let auditWarning = "";
    try {
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
    } catch {
      auditWarning = "；操作日志写入失败，请及时备份";
    }
    paymentSelected.clear();
    render();
    toast(
      (action === "reject"
        ? "已退回，员工可修改后重新提交"
        : "处理成功，报销已进入下一阶段") + auditWarning,
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
    `<div class="modal-title"><h2>${existing ? "编辑报销" : "新建报销"}</h2><button data-close aria-label="关闭">✕</button></div><p class="muted">申请人：${esc(currentEmployee())} · ${esc(currentDepartment())}</p><form id="expense-form"><label>报销事项<input name="name" maxlength="60" required value="${esc(existing?.name || "")}" placeholder="例如：上海客户拜访差旅"></label><div class="form-grid"><label>费用类型<select name="type">${["差旅交通", "业务招待", "办公采购", "其他费用"].map((t) => `<option ${existing?.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>金额（元）<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required value="${existing?.amount || ""}"></label></div><label>发票号码<input name="invoice" maxlength="40" value="${esc(existing?.invoice || "")}" placeholder="用于重复报销检测"></label><label>发票OCR / 原票据名称<input name="receipt" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"><small>图片可在浏览器中识别，不上传原图；此旧入口仅记录文件名；要保留原文件，请使用下方“报销附件”。${existing?.receipt ? "当前：" + esc(existing.receipt) : ""}</small></label>${attachmentEditor()}${requestOptions(requests, items, existing, new Date().toLocaleDateString("sv-SE"), currentEmployee())}${travelForm("expense", existing?.travel)}${ocrPanel()}${existing?.receipt ? '<label class="check-line"><input type="checkbox" name="removeReceipt">移除当前附件名称</label>' : ""}<label>业务说明<textarea name="note" maxlength="500" required placeholder="说明费用用途">${esc(existing?.note || "")}</textarea></label><div id="form-review" class="review-box"></div><div class="actions"><button type="button" id="draft">保存草稿</button><button type="submit" class="primary">提交报销 →</button></div></form>`,
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
      employee: currentEmployee(),
      department: currentDepartment(),
      date: existing?.date || new Date().toLocaleDateString("sv-SE"),
      status: "待主管审批",
      history: existing?.history || [],
      ...(d.get("requestId") ? { requestId: d.get("requestId") } : {}),
      ...(ocrEvidence ? { ocr: ocrEvidence } : {}),
      attachments: attachmentFiles.read(),
      ...(travelEditor.read() ? { travel: travelEditor.read() } : {}),
    };
  };
  const preview = () => {
    travelEditor.refresh();
    const x = collect();
    const f = flags(x);
    document.querySelector("#form-review").innerHTML =
      `<h3>提交前预审 · 规则计算</h3>${f.length ? f.map((t) => `<p class="risk">⚑ ${esc(t)}</p>`).join("") : '<p class="safe">✓ 当前未触发规则预警</p>'}<small>单笔额度 ${money(policy.limit)}；仅检查已填写的信息，提交仍需完整填写必填项。风险单可提交说明情况，财务审核前须解决。</small>`;
  };
  const attachmentFiles = mountAttachmentEditor(
    formEl,
    existing?.attachments,
    () => preview(),
  );
  const travelEditor = mountTravelForm(formEl, () => preview());
  formEl.elements.requestId.addEventListener("change", () => {
    const r = requests.find((r) => r.id === formEl.elements.requestId.value);
    if (r) {
      formEl.elements.type.value = r.type;
      if (r.trip) travelEditor.setTrip(r.trip);
    }
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
    if (attachmentFiles.isBusy()) return toast("附件正在读取，请稍后保存");
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
      if (x.travel) {
        validateTravel(x.travel, x.amount, x.type);
        if (!draft) assertTravelSubmission(x.travel, x.amount, x.type);
      }
      assertClaimLink(x, requests, items);
      if (!draft) {
        if (!configHealthy) throw Error("组织/流程存储异常，请先恢复有效配置");
        x.approval = compileApproval(
          x,
          "expense",
          configuration.org,
          configuration.flows,
        );
        x.status = approvalStatus(x.approval);
      }
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
    const nextItems = existing
      ? items.map((i) => (i.id === x.id ? x : i))
      : [x, ...items];
    try {
      persistExpenseItems(localStorage, nextItems);
    } catch (e) {
      return toast(e.message);
    }
    items = nextItems;
    let auditWarning = "";
    try {
      record(
        draft ? "保存草稿" : "提交报销",
        x.id,
        x.name + (x.ocr ? " · 曾使用OCR辅助并人工核对" : ""),
      );
    } catch {
      auditWarning = "；操作记录写入失败，请及时备份";
    }

    render();
    toast(
      (draft
        ? "草稿已保存，可在草稿标签继续填写"
        : "报销已提交，预审结果可在详情查看") + auditWarning,
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
  return `<section class="panel prose"><div class="budget-heading"><div><h2>预算有边界，支出有依据</h2><p>部门月度额度 · 已付款 + 在途占用 = 已使用预算</p></div><label>查看月份 <input type="month" id="budget-month" value="${budgetMonth}"></label></div><div class="budget-cards">${rows.map((x) => `<article class="budget-card"><div class="budget-card-title"><h3>${esc(x.department)}</h3><span class="badge ${x.ratio >= 1 ? "s4" : x.ratio >= 0.8 ? "s0" : "s3"}">${!x.limit ? "未设置额度" : x.ratio >= 1 ? "预算已耗尽" : x.ratio >= 0.8 ? "接近额度" : "额度充足"}</span></div><p>月度预算 <b>${money(x.limit)}</b></p><div class="budget-total">${money(x.paid + x.reserved)}<small>已使用 · ${(x.ratio * 100).toFixed(1)}%</small></div><div class="budget-bar"><span style="width:${Math.min(100, x.ratio * 100)}%;background:${x.ratio >= 1 ? "#dd8173" : x.ratio >= 0.8 ? "#e3ad55" : "#6c85e4"}"></span></div><dl><div><dt>已付款</dt><dd>${money(x.paid)}</dd></div><div><dt>报销在途</dt><dd>${money(x.reimbursementReserved)}</dd></div><div><dt>申请剩余预留</dt><dd>${money(x.applicationReserved)}</dd></div><div><dt>${x.available < 0 ? "超出额度" : "可用余额"}</dt><dd class="${x.available < 0 ? "risk" : ""}">${money(Math.abs(x.available))}</dd></div></dl>${role === "财务" ? `<button data-budget="${esc(x.department)}">调整预算额度</button>` : '<small class="muted">切换财务角色可调整额度</small>'}</article>`).join("")}</div><div class="review-box"><h3>预算口径说明</h3>已批准申请按申请月份预留未核销余额，关联报销不重复占用；结束申请释放余额。按报销提交日期归属月份；待审批、待审核和待付款计入在途占用，已付款计入实际支出，退回单释放占用，重提后重新占用。当前额度为各月份共用的演示标准，调整会影响所有月份。预算为软预警，不阻止提交或审批，也未按部门外的费用类型细分。</div></section>`;
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
  return `<section class="panel prose"><div class="section-intro"><span class="section-mark">⚙</span><div><h2>将费用制度，转成清晰规则</h2><p>审批路径可配置；财务分工模板支持部门总 → 财务 → 总账 → 付款工作台</p></div></div><form id="policy-form"><div class="settings-row"><div><h3>单笔费用上限</h3><p>此项为报销旧硬规则：超额阻止财务/总账/付款通过；对公单笔阈值在下方单独设置。</p></div><label>金额（元）<input type="number" name="limit" min="0.01" max="1000000" step="0.01" required value="${policy.limit}" ${role !== "财务" ? "disabled" : ""}></label></div><div class="settings-row"><div><h3>附件完整性</h3><p>旧票据名称或发票类原文件满足此项。是否留存原文件由下方补充规则单独检查；不验真。</p></div><label class="check-line"><input type="checkbox" name="requireReceipt" ${policy.requireReceipt ? "checked" : ""} ${role !== "财务" ? "disabled" : ""}>启用检查</label></div><div class="settings-row"><div><h3>发票号码查重</h3><p>与其他已提交且未退回单据比较；草稿不参与查重。</p></div><label class="check-line"><input type="checkbox" name="checkDuplicate" ${policy.checkDuplicate ? "checked" : ""} ${role !== "财务" ? "disabled" : ""}>启用检查</label></div>${precheckSettings(policy, role === "财务" && policyHealthy, policyHealthy)}${role === "财务" ? '<label>变更原因<textarea name="reason" required maxlength="200" placeholder="填写本次规则调整的业务原因"></textarea></label><div class="actions"><button class="primary" type="submit">保存规则</button></div>' : '<p class="footnote">切换财务角色可配置规则。</p>'}</form><div class="review-box">规则变更立即重新计算报销和对公的当前提示，不改既有审批结论。新版每次处理保留当时的规则版本、阈值和命中结果；旧记录不补造。预算仍为独立软预警。</div></section>`;
}
function auditView() {
  const legacy = JSON.parse(
    localStorage.getItem("qingbao-budget-audit") || "[]",
  );
  return `<section class="panel"><div class="panel-title"><div><h3>操作记录</h3><span>记录本浏览器中的关键业务动作 · 最新在前 · 最多 1000 条</span></div><span class="badge">${audit.length} 条</span></div><div class="table-wrap"><table><thead><tr><th>时间</th><th>角色</th><th>动作</th><th>对象</th><th>说明</th></tr></thead><tbody>${audit.map((x) => `<tr><td>${esc(x.time)}</td><td>${esc(x.actor)}</td><td>${esc(x.action)}</td><td>${esc(x.target)}</td><td class="wrap-cell">${esc(x.note || "—")}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">暂无记录，创建报销或调整规则后会显示在这里</td></tr>'}</tbody></table></div>${legacy.length ? `<div class="prose"><h3>早期预算调整记录</h3>${legacy.map((x) => `<p>${esc(x.time)} · ${esc(x.department)} · ${money(x.limit)} · ${esc(x.reason)}</p>`).join("")}</div>` : ""}<div class="footnote prose">演示记录保存在浏览器，可随备份迁移；不具备服务端防篡改审计能力。早期报销记录请查看各单据的流转记录。</div></section>`;
}
function dataView() {
  return `<section class="panel prose"><div class="section-intro"><span class="section-mark">⇅</span><div><h2>让演示数据，随作品一起迁移</h2><p>无需真实财务资料。备份用于更换浏览器、设备或演示前留档。</p></div></div><div class="data-cards"><article><h3>导出完整备份</h3><p>包含供应商、合同正文与复核、对公支付单、报销、附件原文件、费用申请、组织架构、已发布审批流程、规则、部门预算及操作记录，JSON 格式。附件仅在本浏览器与备份中保留。角色为演示身份，导出不代表真实数据权限。</p><button id="backup" class="primary">下载数据备份</button></article><article><h3>导入已有备份</h3><p>校验格式后替换当前数据。建议先导出；浏览器会要求你确认覆盖。</p><label>选择轻报 JSON 备份<input id="restore" type="file" accept=".json,application/json"></label></article></div><div class="review-box"><h3>使用范围</h3>所有记录仅在当前浏览器中存储，清理浏览器数据会丢失。不同设备不会同步。本原型不是生产财务系统，请使用虚构票据。</div><h3>面试演示路线</h3><div class="demo-steps"><div><b>01</b><h3>完成一笔报销</h3><p>员工创建 → 主管通过 → 财务审核 → 付款登记。</p></div><div><b>02</b><h3>处理一笔异常</h3><p>发现重复票据 → 退回 → 员工修正 → 重提审批。</p></div><div><b>03</b><h3>解释产品决策</h3><p>调整预算查看预警，配置规则观察变化，在操作记录追踪动作。</p></div></div></section>`;
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
      if (!policyHealthy)
        throw Error("预审规则存储异常，原值已保留，请恢复有效备份");
      const next = validatePolicy({
        limit: Number(d.get("limit")),
        requireReceipt: d.has("requireReceipt"),
        checkDuplicate: d.has("checkDuplicate"),
        precheck: collectPrecheck(e.target, policy),
      });
      if (!d.get("reason").trim()) return toast("请填写变更原因");
      try {
        localStorage.setItem("qingbao-policy", JSON.stringify(next));
      } catch {
        throw Error("规则保存失败或浏览器容量不足，原规则未改动");
      }
      policy = next;
      let warning = "";
      try {
        record(
          "调整预审规则",
          "费用政策",
          `${d.get("reason").trim()}；规则 v${next.precheck.version}；单笔上限 ${next.limit}，补充规则同时作用报销与对公`,
        );
      } catch {
        warning = "；操作日志保存失败，业务规则已保存，请及时备份";
      }
      render();
      toast("规则已保存，预审提示已重新计算" + warning);
    } catch (e) {
      toast(e.message);
    }
  });
  document.querySelector("#backup")?.addEventListener("click", () => {
    if (!policyHealthy)
      return toast("预审规则存储异常，不能生成完整备份；原始值已保留");
    if (!configHealthy)
      return toast("组织/流程存储无法读取，不能导出完整备份；原始数据未改动");
    if (!requestStoreHealthy)
      return toast("费用申请存储无法读取，不能导出完整备份；原始数据未改动");
    if (!messageReadHealthy)
      return toast("消息已读存储异常，不能生成完整备份；原始值已保留");
    if (!enterpriseHealthy)
      return toast("企业业务存储异常，不能生成完整备份；原始值已保留");
    const backup = {
      format: "qingbao-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      messageRead,
      enterprise,
      configuration,
      requests,
      items,
      budgets,
      policy,
      audit,
    };
    const backupJson = JSON.stringify(backup, null, 2);
    if (new Blob([backupJson]).size > 5 * 1024 * 1024)
      return toast("完整备份超过5 MB，请减少本次附件规模；当前数据仍保留");
    downloadFile(backupJson, "轻报-数据备份.json", "application/json");
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
      if (data.configuration === undefined && !configHealthy)
        throw Error("旧备份未包含组织和流程，不能覆盖未知配置");
      if (data.enterprise === undefined && !enterpriseHealthy)
        throw Error("旧备份未包含企业业务，不能覆盖无法读取的原企业数据");
      const nextEnterprise =
        data.enterprise === undefined
          ? enterprise
          : validateEnterprise(data.enterprise);
      for (const p of nextEnterprise.payments.filter(
        (p) => p.status === "已付款",
      ))
        assertUniqueReference(p.payment.reference, data.items);
      const nextConfiguration = data.configuration || configuration;
      validateFlows(nextConfiguration.flows, nextConfiguration.org);
      assertOrgChange(nextConfiguration.org, nextConfiguration.org, [
        ...data.items,
        ...(data.requests || requests),
        ...nextEnterprise.payments,
      ]);
      if (
        [...nextEnterprise.contracts, ...nextEnterprise.payments].some(
          (p) =>
            !nextConfiguration.org.departments.some(
              (d) => d.name === p.department,
            ),
        )
      )
        throw Error("恢复的组织缺少企业业务所属部门");
      const nextRequests =
        data.requests === undefined ? requests : data.requests;
      if (
        nextRequests.some(
          (r) =>
            !nextConfiguration.org.departments.some(
              (d) => d.name === r.department,
            ),
        )
      )
        throw Error("恢复的组织缺少保留申请所属部门，请使用包含完整组织的备份");
      validateRequestSet(nextRequests, data.items);
      if (
        !confirm(
          `将使用备份中的 ${data.items.length} 笔报销替换当前数据。${data.requests === undefined ? "旧备份不含申请，保留现有费用申请" : `同时替换为 ${nextRequests.length} 笔费用申请`}；${data.configuration ? "同时恢复组织和已发布流程" : "不含组织/流程，保留现有配置"}；${data.enterprise ? "同时替换供应商、合同和对公单" : "旧备份不含企业业务，保留已有记录"}，继续吗？`,
        )
      ) {
        input.value = "";
        return;
      }
      const nextBudgets = { ...data.budgets };
      for (const d of nextConfiguration.org.departments)
        if (d.parentId !== null && nextBudgets[d.name] === undefined)
          nextBudgets[d.name] = 0;
      const nextDraft = structuredClone(nextConfiguration.flows);
      const nextAudit = [
        {
          actor: `${currentEmployee()}（${role}）`,
          action: "导入备份",
          target: "演示空间",
          note: `导入 ${data.items.length} 笔报销；${data.enterprise ? "恢复" : "保留"}企业业务`,
          time: new Date().toLocaleString("zh-CN"),
        },
        ...data.audit,
      ].slice(0, 1000);
      writeStorageBatch(localStorage, [
        [enterpriseKey, JSON.stringify(nextEnterprise)],
        ["qingbao-v1", serializeExpenseItems(data.items)],
        ["qingbao-configuration-v1", JSON.stringify(nextConfiguration)],
        ["qingbao-requests-v1", JSON.stringify(nextRequests)],
        ["qingbao-budgets", JSON.stringify(nextBudgets)],
        ["qingbao-policy", JSON.stringify(data.policy)],
        ["qingbao-flow-draft-v1", JSON.stringify(nextDraft)],
        ["qingbao-audit", JSON.stringify(nextAudit)],
        ["qingbao-budget-audit", null],
        ...(data.messageRead !== undefined
          ? [["qingbao-message-read-v1", JSON.stringify(data.messageRead)]]
          : []),
      ]);
      enterprise = nextEnterprise;
      enterpriseHealthy = true;
      configuration = nextConfiguration;
      configHealthy = true;
      requests = nextRequests;
      requestStoreHealthy = true;
      items = data.items;
      budgets = nextBudgets;
      flowDraft = nextDraft;
      policy = validatePolicy(data.policy);
      policyHealthy = true;
      audit = nextAudit;
      if (data.messageRead !== undefined) {
        messageRead = data.messageRead;
        messageReadHealthy = true;
      }
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
  return `<div class="review-box"><h3>登记线下付款</h3><div class="form-grid"><label>付款日期<input type="date" id="payment-date" value="${new Date().toLocaleDateString("sv-SE")}"></label><label>付款方式<select id="payment-method"><option>银行转账</option><option>其他线下付款</option></select></label></div><label>付款参考号<input id="payment-reference" maxlength="60" placeholder="例如 DEMO-202610-001（仅演示）"></label><label class="check-line"><input id="payment-confirm" type="checkbox">确认仅登记模拟记录，不会实际转账</label><small>新登记参考号会与已有已付款记录核对（忽略首尾空格和字母大小写）；旧重复记录不自动修改。</small></div>`;
}
function matchingInvoices() {
  return invoiceRows(items, role === "员工" ? currentEmployee() : null).filter(
    (x) =>
      (invoiceFilter === "全部" || x.duplicate) &&
      [
        x.invoice,
        x.receipt,
        ...(x.attachments || []).map((f) => f.name),
        x.employee,
        x.name,
      ]
        .join(" ")
        .includes(invoiceQuery),
  );
}
function invoiceView() {
  const rows = matchingInvoices();
  return `<section class="panel"><div class="panel-title"><div><h3>发票与报销，一处追踪</h3><span>票据与材料索引 · 原文件请到报销详情预览或下载，不验证真伪</span></div><button id="invoice-export">↓ 导出台账</button></div><div class="toolbar"><div class="tabs">${["全部", "重复号码"].map((t) => `<button data-invoice-filter="${t}" class="${invoiceFilter === t ? "chosen" : ""}">${t}</button>`).join("")}</div><input id="invoice-search" aria-label="搜索发票台账" value="${esc(invoiceQuery)}" placeholder="搜索号码、附件、姓名或事项"></div><div class="table-wrap"><table><thead><tr><th>发票号码 / 附件名称</th><th>关联报销</th><th>申请人</th><th class="amount">关联报销金额</th><th>报销状态</th><th>号码检查</th><th>操作</th></tr></thead><tbody>${rows.map((x) => `<tr><td><strong>${esc(x.invoice || "未填写号码")}</strong><small>${esc([x.receipt, ...(x.attachments || []).map((f) => f.name)].filter(Boolean).join(" / ") || "未提供附件")}</small></td><td><strong>${esc(x.name)}</strong><small>${esc(x.id)}</small></td><td>${esc(x.employee)}</td><td class="amount">${money(x.amount)}</td><td><span class="badge">${x.status}</span>${x.approval && ["待主管审批", "待财务审核", "待总账复核", "待付款"].includes(x.status) ? `<small>待 ${esc((x.status === "待付款" ? x.approval.paymentActor || x.approval.nodes.at(-1) : x.approval.nodes[x.approval.cursor] || x.approval.nodes.at(-1)).actorName)} 处理</small>` : ""}</td><td><span class="${x.duplicate ? "risk" : "safe"}">${x.duplicate ? "⚑ 疑似重复" : !x.invoice ? "未填写号码" : ["已退回", "已撤回"].includes(x.status) ? "不参与查重" : "✓ 未发现重复"}</span></td><td><button class="link" data-detail="${esc(x.id)}">查看报销 →</button></td></tr>`).join("") || '<tr><td colspan="7" class="empty">没有符合条件的关联票据</td></tr>'}</tbody></table></div><div class="table-footer">共 ${rows.length} 条关联记录<span>金额为报销金额，并非独立票面金额</span></div><p class="footnote prose">同一号码的有效报销将同时标记。草稿不展示；退回、撤回单保留索引，但不占用号码。预审规则关闭查重后，此台账仍展示号码重复情况，供人工核对。</p></section>`;
}
function guideView() {
  return `<section class="panel prose"><div class="section-intro"><span class="section-mark">▷</span><div><h2>按场景，讲清产品设计与闭环</h2><p>按场景操作，展示问题、方案与取舍。所有样例均为虚构数据。</p></div></div><div class="guide-grid">${[
    [
      "01",
      "员工提交与纠错",
      "体验如何减少返工",
      "员工",
      "报销管理",
      "可先载入虚构样票体验 OCR，核对后填入；在报销附件区上传酒店水单、行程单等材料，保存草稿并补充用途后提交；审核人可预览图片或下载原文件。发现错误可在主管审批前撤回再修改；到报销进度查看当前待处理人，退回后在“待我完善”核对原因并重提。差旅场景可先申请行程，再关联住宿/餐补等明细自动合计，到差旅标准查看超标口径；申请进度可查看当前审批人、额度占用和本人关联报销。",
      "设计理由：区分草稿、撤回和退回，既降低输入成本，也保持审批状态清晰。",
    ],
    [
      "02",
      "主管与财务协作",
      "完成从审批到付款的闭环",
      "主管",
      "审批中心",
      "审批中心集中处理报销、申请和付款，也可到消息中心查看并打开待办；标已读不改变审批状态。完成后切到“我已处理”回看本人结果与当时摘要，可用今天、近7天或起止日期筛选，导出全部匹配记录。财务审核后仍需登记付款；切其他人员验证历史记录归属。",
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
      "在规则配置设置报销原文件检查、疑似重复、时效，以及对公大额、账户变更等提醒或拦截，填写原因保存。新建仅有票据名称的报销，主管通过后财务看到依据与建议；设为拦截时不能通过，可退回补件。对公在途档案变更只提示或拦截，不改收款快照。处理后查看当时规则与结果，调阈值不回改历史快照。用数据管理备份保留现场。",
      "设计理由：提醒和拦截承担不同职责；关联匹配只是待核对线索，不是违规结论。自动化验证不能替代真实用户研究。",
    ],
    [
      "05",
      "组织与审批树",
      "验证配置和在途流程的关系",
      "管理员",
      "组织架构",
      "在组织架构折叠 CFO 后搜索叶禾，点结果展开上级并定位；可按岗位或部门查找，点击路径回到祖先。侧栏维护资料，未保存切页时可选择继续编辑。",
      "设计理由：按人员而非只有角色授权，提交时保留流程快照，避免组织变化打乱在途单据。",
    ],
    [
      "06",
      "事前申请与多级审批",
      "演示费用计划如何预留预算",
      "员工",
      "费用申请",
      "林晓提交 4000 元申请，主管身份依次选择赵航、许明通过；批准后查看预算预留，再关联报销并结束计划。当前流程修改过时先用试算确认审批人。",
      "设计理由：最后一位审批人通过后才批准并预留；申请额度硬校验，部门预算保持软预警。",
    ],
    [
      "07",
      "总账复核与付款工作台",
      "展示完整财务岗位分工",
      "管理员",
      "审批流程",
      "载入财务分工模板，填写原因发布；叶禾提交 200 元报销，沈岚审批、周宁审核、高璇填写科目及核算归属复核，最后杜川在付款工作台登记模拟付款；多笔可勾选后核对独立参考号并批量模拟登记，再导出筛选清单。旧组织可先添加 CFO 示例组织。",
      "设计理由：部门业务审批、财务票据审核、总账复核和付款是不同职责；发布不改变旧单据路径。",
    ],
    [
      "08",
      "合同到对公支付",
      "展示供应商、规则初筛与合同额度",
      "管理员",
      "供应商管理",
      "新增远帆服务有限公司（虚构），统一代码 DEMO-CREDIT-001，户名与全称一致，开户行演示银行，账号 DEMO-SUPPLIER-001。先在审批流程载入并发布财务分工模板；切员工林晓到合同审查提交 HT-DEMO-001、10000元并载入虚构正文。切财务周宁阅读全文、填意见和确认后通过；林晓新建4000元对公单，按页面指定人依次切主管许明、财务周宁、总账高璇（填科目/归属）、付款杜川（填参考号并确认模拟）办理。在合同查看在途转已付、可用6000元。",
      "设计理由：对公收款人为供应商；独立单据保留合同版本、账户及路径快照。规则初筛不等于 AI 或法律意见，真实 AI 暂缓。",
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
        [x.receipt, ...(x.attachments || []).map((f) => f.name)]
          .filter(Boolean)
          .join(" / "),
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
    `<div class="modal-title"><h2>新建费用申请</h2><button data-close aria-label="关闭">✕</button></div><p class="muted">${esc(currentEmployee())} · ${esc(currentDepartment())} · 尚未批准前不占用预算</p><form id="request-form"><label>申请事项<input name="name" maxlength="60" required placeholder="例如：华东客户拜访"></label><div class="form-grid"><label>计划月份<input type="month" name="month" required value="${new Date().toLocaleDateString("sv-SE").slice(0, 7)}"></label><label>申请额度（元）<input type="number" name="amount" min="0.01" max="1000000" step="0.01" required></label></div><label>费用类型<select name="type">${["差旅交通", "业务招待", "办公采购", "其他费用"].map((t) => `<option>${t}</option>`).join("")}</select></label>${travelForm("request")}<label>用途说明<textarea name="note" required maxlength="500" placeholder="说明业务必要性、预计费用和使用范围"></textarea></label><div class="actions"><button type="submit" class="primary">提交申请</button></div></form>`,
  );
  const f = document.querySelector("#request-form");
  const tripEditor = mountTravelForm(f);
  f.addEventListener("input", () => (f.dataset.dirty = "true"));
  f.onsubmit = (e) => {
    e.preventDefault();
    const d = new FormData(f);
    try {
      const r = validateRequest({
        id: "SQ" + crypto.randomUUID(),
        name: d.get("name").trim(),
        month: d.get("month"),
        ...(tripEditor.read() ? { trip: tripEditor.read() } : {}),
        amount: Number(d.get("amount")),
        type: d.get("type"),
        note: d.get("note").trim(),
        employee: currentEmployee(),
        department: currentDepartment(),
        status: "待审批",
        history: [
          {
            text: "员工提交费用申请",
            time: new Date().toLocaleString("zh-CN"),
          },
        ],
      });
      if (!configHealthy) throw Error("组织/流程存储异常，请先恢复有效配置");
      r.approval = compileApproval(
        r,
        "request",
        configuration.org,
        configuration.flows,
      );
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
  if (
    !r ||
    (role === "员工" && !ownsExpense(r, currentActor(), configuration.org))
  )
    return toast("仅可查看本人的费用申请");
  const departmentBudget = budgetRows(items, budgets, r.month, requests).find(
    (b) => b.department === r.department,
  ) || { limit: 0, available: 0 };
  const approvalAvailable =
    departmentBudget.available - (r.status === "待审批" ? r.amount : 0);
  const b = requestBalance(r, items),
    linked = items.filter((x) => x.requestId === r.id);
  const approval = canHandleDocument(r, "request", currentActor()),
    close =
      role === "员工" &&
      r.employee === currentEmployee() &&
      ["待审批", "已批准"].includes(r.status);
  modal(
    `<div class="modal-title"><div><small>${esc(r.id)}</small><h2>${esc(r.name)}</h2></div><button data-close aria-label="关闭">✕</button></div><div class="detail-amount">${money(r.amount)} <span class="badge">${r.status}</span></div><p>${esc(r.employee)} · ${esc(r.department)} · ${esc(r.month)} · ${esc(r.type)}</p><p>${esc(r.note)}</p>${tripSummary(r.trip)}<div class="review-box">已关联 ${money(b.used)} · 剩余额度 ${money(b.remaining)}<p>${r.status === "已批准" ? "余额正在预留预算" : "当前不预留预算"}。${b.unpaid ? "仍有在途报销，不能结束申请。" : "可结束申请并释放尚未使用的余额。"}</p></div><div class="review-box"><h3>部门预算影响</h3><p>月度预算 ${money(departmentBudget.limit)} · 当前可用 ${money(departmentBudget.available)}</p>${r.status === "待审批" ? `<p class="${approvalAvailable < 0 ? "risk" : "safe"}">批准后预计可用 ${money(approvalAvailable)}</p>` : ""}<small>部门预算为软预警，不阻止批准；关联报销不能超过申请本身的批准额度。</small></div><h3>关联报销</h3>${linked.length ? linked.map((x) => `<p>${esc(x.name)} · ${money(x.amount)} · ${x.status}</p>`).join("") : '<p class="muted">暂无关联报销</p>'}${approvalTimeline(r)}<h3>申请流转记录</h3><div class="timeline">${r.history.map((h) => `<p>${esc(h.text)}<small>${esc(h.operation ? new Date(h.operation.at).toLocaleString("zh-CN") : h.time)}${h.operation ? " · " + esc(h.operation.actorName) + " · " + (h.operation.flowVersion ? "v" + h.operation.flowVersion : "历史固定流程") : ""}</small></p>`).join("")}</div>${approval || close ? `<label>处理原因<textarea id="request-reason" maxlength="200" placeholder="驳回或结束时必填"></textarea></label><div class="actions">${approval ? '<button data-request-action="reject">驳回申请</button><button class="primary" data-request-action="approve">批准申请</button>' : '<button data-request-action="close">结束申请并释放余额</button>'}</div>` : '<p class="footnote">切换至当前节点指定人员才能审批；员工可在无在途报销时结束自己的申请。</p>'}`,
  );
  document.querySelectorAll("[data-request-action]").forEach(
    (button) =>
      (button.onclick = () => {
        try {
          const next = requestAction(
            r,
            button.dataset.requestAction,
            role,
            currentEmployee(),
            items,
            document.querySelector("#request-reason").value,
            currentActor(),
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
function bindConfiguration() {
  const admin = () => {
    if (role !== "管理员") throw Error("只有管理员可修改组织与流程");
    if (!configHealthy)
      throw Error("配置存储异常，原数据未改动，请恢复有效备份");
  };
  const updateOrg = (next) => {
    admin();
    assertOrgChange(configuration.org, next, [
      ...items,
      ...requests,
      ...enterprise.payments,
    ]);
    const nextConfiguration = { ...configuration, org: next };
    validateFlows(nextConfiguration.flows, next);
    const newBudgets = { ...budgets };
    for (const d of next.departments)
      if (d.parentId !== null && newBudgets[d.name] === undefined)
        newBudgets[d.name] = 0;
    saveConfiguration(nextConfiguration);
    budgets = newBudgets;
    localStorage.setItem("qingbao-budgets", JSON.stringify(budgets));
    record("调整组织架构", "组织配置", "保留历史名称与在途审批快照");
    render();
    toast("组织已保存，后续提交按新组织解析");
  };
  const editPerson = (id, managerId, departmentId) => {
    try {
      admin();
      const old = configuration.org.people.find((p) => p.id === id);
      modal(personForm(configuration.org, id));
      const form = document.querySelector("#person-form");
      if (!old && managerId) form.elements.managerId.value = managerId;
      if (!old && departmentId) form.elements.departmentId.value = departmentId;
      form.addEventListener("input", () => (form.dataset.dirty = "true"));
      form.onsubmit = (e) => {
        e.preventDefault();
        try {
          const d = new FormData(form),
            p = {
              id: old?.id || "P" + crypto.randomUUID(),
              name: old?.name || d.get("name").trim(),
              title: d.get("title").trim(),
              departmentId: d.get("departmentId"),
              role: d.get("role"),
              managerId: d.get("managerId") || null,
              active: d.has("active"),
            };
          const next = structuredClone(configuration.org);
          if (old) next.people[next.people.findIndex((x) => x.id === id)] = p;
          else next.people.push(p);
          updateOrg(next);
        } catch (e) {
          toast(e.message);
        }
      };
    } catch (e) {
      toast(e.message);
    }
  };
  const editDepartment = (id, parentId) => {
    try {
      admin();
      const old = configuration.org.departments.find((d) => d.id === id);
      modal(departmentForm(configuration.org, id));
      const form = document.querySelector("#department-form");
      if (!old && parentId) form.elements.parentId.value = parentId;
      form.addEventListener("input", () => (form.dataset.dirty = "true"));
      form.onsubmit = (e) => {
        e.preventDefault();
        try {
          const d = new FormData(form),
            department = {
              id: old?.id || "D" + crypto.randomUUID(),
              name: old?.name || d.get("name").trim(),
              parentId: d.get("parentId") || null,
              headId: d.get("headId") || null,
            };
          const next = structuredClone(configuration.org);
          if (old)
            next.departments[next.departments.findIndex((x) => x.id === id)] =
              department;
          else next.departments.push(department);
          updateOrg(next);
        } catch (e) {
          toast(e.message);
        }
      };
    } catch (e) {
      toast(e.message);
    }
  };
  document
    .querySelector("#add-person")
    ?.addEventListener("click", () => editPerson());
  document
    .querySelectorAll("[data-edit-person]")
    .forEach((b) => (b.onclick = () => editPerson(b.dataset.editPerson)));
  document
    .querySelector("#add-department")
    ?.addEventListener("click", () => editDepartment());
  document
    .querySelectorAll("[data-edit-department]")
    .forEach(
      (b) => (b.onclick = () => editDepartment(b.dataset.editDepartment)),
    );
  document.querySelectorAll("[data-org-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        if (
          document.querySelector("#org-inspector-form")?.dataset.dirty &&
          !confirm("节点修改尚未保存，是否放弃修改并切换？")
        )
          return;
        orgMode = b.dataset.orgMode;
        orgChartState.selected = null;
        orgChartState.scrollLeft = null;
        orgChartState.scrollTop = 0;
        render();
      }),
  );
  const rememberChart = () => {
    const view = document.querySelector(".chart-viewport");
    if (view) {
      orgChartState.scrollLeft = view.scrollLeft;
      orgChartState.scrollTop = view.scrollTop;
    }
  };
  const canLeaveInspector = canLeaveOrgEditor;
  const view = document.querySelector(".chart-viewport");
  if (view) {
    if (orgChartState.scrollLeft === null) {
      const nodes = [...document.querySelectorAll(".chart-node")];
      const root =
        (orgMode === "reports"
          ? document
              .querySelector('[data-org-select="person:cfo-lu"]')
              ?.closest(".chart-node")
          : null) || nodes.sort((a, b) => a.offsetTop - b.offsetTop)[0];
      view.scrollLeft = root
        ? (root.offsetLeft + 104) * orgChartState.zoom - view.clientWidth / 2
        : 0;
      orgChartState.scrollLeft = view.scrollLeft;
    } else view.scrollLeft = orgChartState.scrollLeft;
    view.scrollTop = orgChartState.scrollTop;
    if (orgChartState.focusKey) {
      const target = [...document.querySelectorAll("[data-org-select]")].find(
        (b) => b.dataset.orgSelect === orgChartState.focusKey,
      );
      if (target) {
        const node = target.closest(".chart-node");
        view.scrollLeft =
          (node.offsetLeft + 104) * orgChartState.zoom - view.clientWidth / 2;
        view.scrollTop =
          (node.offsetTop + 54) * orgChartState.zoom - view.clientHeight / 2;
        orgChartState.scrollLeft = view.scrollLeft;
        orgChartState.scrollTop = view.scrollTop;
        target.focus({ preventScroll: true });
      }
      orgChartState.focusKey = null;
    }
  }
  const locate = (key) => {
    if (!canLeaveInspector()) return;
    try {
      rememberChart();
      const result = locateOrganization(
        configuration.org,
        orgMode,
        key,
        orgChartState.collapsed,
      );
      orgMode = result.mode;
      orgChartState.selected = result.selected;
      orgChartState.collapsed = result.collapsed;
      orgChartState.focusKey = key;
      orgChartState.zoom = Math.max(0.65, orgChartState.zoom);
      render();
      toast("已定位：" + result.path.at(-1).name + "，上级路径已展开");
    } catch (e) {
      toast(e.message);
    }
  };
  document
    .querySelectorAll("[data-org-locate]")
    .forEach((b) => (b.onclick = () => locate(b.dataset.orgLocate)));
  document.querySelector("#chart-selected")?.addEventListener("click", () => {
    if (orgChartState.selected)
      locate(orgChartState.selected.type + ":" + orgChartState.selected.id);
  });
  document.querySelector("#org-search")?.addEventListener("input", (e) => {
    if (!canLeaveInspector()) {
      e.target.value = orgChartState.searchQuery;
      return;
    }
    rememberChart();
    orgChartState.searchQuery = e.target.value;
    const position = e.target.selectionStart;
    render();
    const input = document.querySelector("#org-search");
    input.focus({ preventScroll: true });
    if (position !== null) input.setSelectionRange(position, position);
  });
  document
    .querySelector("#org-search-type")
    ?.addEventListener("change", (e) => {
      if (!canLeaveInspector()) {
        e.target.value = orgChartState.searchType;
        return;
      }
      rememberChart();
      orgChartState.searchType = e.target.value;
      render();
    });
  document.querySelector("#org-search-clear")?.addEventListener("click", () => {
    if (!canLeaveInspector()) return;
    rememberChart();
    orgChartState.searchQuery = "";
    orgChartState.searchType = "all";
    render();
    document.querySelector("#org-search")?.focus({ preventScroll: true });
  });
  document.querySelectorAll("[data-org-select]").forEach(
    (b) =>
      (b.onclick = () => {
        if (!canLeaveInspector()) return;
        rememberChart();
        const { type, id } = parseChartKey(b.dataset.orgSelect);
        orgChartState.selected = { type, id };
        render();
      }),
  );
  document.querySelectorAll("[data-org-collapse]").forEach(
    (b) =>
      (b.onclick = () => {
        if (!canLeaveInspector()) return;
        rememberChart();
        const key = b.dataset.orgCollapse;
        orgChartState.collapsed.has(key)
          ? orgChartState.collapsed.delete(key)
          : orgChartState.collapsed.add(key);
        render();
      }),
  );
  document.querySelectorAll("[data-chart-zoom]").forEach(
    (b) =>
      (b.onclick = () => {
        if (!canLeaveInspector()) return;
        rememberChart();
        orgChartState.zoom = Math.max(
          0.2,
          Math.min(
            1.4,
            orgChartState.zoom + (b.dataset.chartZoom === "in" ? 0.1 : -0.1),
          ),
        );
        render();
      }),
  );
  document.querySelector("#chart-fit")?.addEventListener("click", () => {
    if (!canLeaveInspector()) return;
    const width = Number(
      document.querySelector("[data-chart-width]").dataset.chartWidth,
    );
    orgChartState.zoom = Math.min(
      1,
      document.querySelector(".chart-viewport").clientWidth / width,
    );
    orgChartState.scrollLeft = 0;
    orgChartState.scrollTop = 0;
    render();
  });
  document.querySelector("#chart-expand")?.addEventListener("click", () => {
    if (!canLeaveInspector()) return;
    orgChartState.collapsed.clear();
    render();
  });
  document.querySelectorAll("[data-org-add]").forEach(
    (b) =>
      (b.onclick = () => {
        const { type, id } = parseChartKey(b.dataset.orgAdd);
        if (type === "department") {
          const d = configuration.org.departments.find((d) => d.id === id);
          editPerson(undefined, d.headId || "admin-gu", d.id);
        } else {
          const p = configuration.org.people.find((p) => p.id === id);
          if (!["主管", "管理员"].includes(p.role))
            return toast("只有主管或管理员可作为直属上级");
          editPerson(undefined, p.id, p.departmentId);
        }
      }),
  );
  document
    .querySelectorAll("[data-org-add-department]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          editDepartment(undefined, b.dataset.orgAddDepartment)),
    );
  const inspector = document.querySelector("#org-inspector-form");
  if (inspector) {
    inspector.addEventListener(
      "input",
      () => (inspector.dataset.dirty = "true"),
    );
    inspector.onsubmit = (e) => {
      e.preventDefault();
      try {
        admin();
        rememberChart();
        const data = new FormData(inspector),
          next = structuredClone(configuration.org),
          selected = orgChartState.selected;
        if (selected.type === "person") {
          const p = next.people.find((p) => p.id === selected.id);
          Object.assign(p, {
            title: data.get("title").trim(),
            departmentId: data.get("departmentId"),
            role: data.get("role"),
            managerId: data.get("managerId") || null,
            active: data.has("active"),
          });
        } else {
          const d = next.departments.find((d) => d.id === selected.id);
          Object.assign(d, {
            parentId: data.get("parentId") || null,
            headId: data.get("headId") || null,
          });
        }
        updateOrg(next);
      } catch (e) {
        toast(e.message);
      }
    };
  }
  document.querySelector("#add-finance-org")?.addEventListener("click", () => {
    try {
      admin();
      updateOrg(addFinanceOrganization(configuration.org));
    } catch (e) {
      toast(e.message);
    }
  });
  document
    .querySelector("#finance-flow-template")
    ?.addEventListener("click", () => {
      try {
        admin();
        flowDraft = financeDivisionFlows(flowDraft, configuration.org);
        flowTarget = "expense";
        render();
        toast("财务分工模板已载入草稿，请填写原因后发布");
      } catch (e) {
        toast(e.message + "；可先在组织架构添加总账与付款人员");
      }
    });
  const form = document.querySelector("#flow-form");
  const read = () =>
    form
      ? collectFlow(form, flowDraft, flowTarget)
      : structuredClone(flowDraft);
  document.querySelectorAll("[data-flow-target]").forEach(
    (b) =>
      (b.onclick = () => {
        if (role === "管理员") flowDraft = read();
        flowTarget = b.dataset.flowTarget;
        render();
      }),
  );
  if (form) {
    form.onsubmit = (e) => e.preventDefault();
    form.addEventListener("input", () => {
      if (role !== "管理员") return;
      flowDraft = read();
      const description = form.querySelector(
        ".flow-branch:last-child .branch-title small",
      );
      if (description)
        description.textContent = `金额 > ${flowDraft[flowTarget].threshold} 且类型为 ${flowDraft[flowTarget].type}`;
    });
    form.querySelectorAll("[data-selector]").forEach(
      (select) =>
        (select.onchange = () => {
          flowDraft = read();
          render();
        }),
    );
    document.querySelectorAll("[data-add-node]").forEach(
      (b) =>
        (b.onclick = () => {
          try {
            admin();
            const next = read(),
              branch = next[flowTarget][b.dataset.addNode];
            if (branch.length >= 4) throw Error("每个分支最多4个顺序审批节点");
            branch.push({ selector: "manager" });
            flowDraft = next;
            render();
          } catch (e) {
            toast(e.message);
          }
        }),
    );
    document.querySelectorAll("[data-remove-node]").forEach(
      (b) =>
        (b.onclick = () => {
          try {
            admin();
            const [branch, index] = b.dataset.removeNode.split("-"),
              next = read();
            next[flowTarget][branch].splice(Number(index), 1);
            flowDraft = next;
            render();
          } catch (e) {
            toast(e.message);
          }
        }),
    );
    document
      .querySelector("#save-flow-draft")
      ?.addEventListener("click", () => {
        try {
          admin();
          flowDraft = read();
          localStorage.setItem(
            "qingbao-flow-draft-v1",
            JSON.stringify(flowDraft),
          );
          toast("草稿已保存，尚未影响运行中的流程");
        } catch (e) {
          toast(e.message);
        }
      });
    document.querySelector("#publish-flow")?.addEventListener("click", () => {
      try {
        admin();
        const reason = form.elements.publishReason.value.trim();
        if (!reason) throw Error("请填写流程发布原因");
        const next = read();
        next.version = configuration.flows.version + 1;
        validateFlows(next, configuration.org);
        saveConfiguration({ ...configuration, flows: next });
        flowDraft = structuredClone(next);
        localStorage.setItem(
          "qingbao-flow-draft-v1",
          JSON.stringify(flowDraft),
        );
        record("发布审批流程", "v" + next.version, reason);
        render();
        toast("流程校验通过，已发布 v" + next.version + "，在途快照保持不变");
      } catch (e) {
        toast(e.message);
      }
    });
  }
  document.querySelector("#test-route")?.addEventListener("click", () => {
    const out = document.querySelector("#route-output");
    try {
      const person = configuration.org.people.find(
          (p) => p.id === document.querySelector("#route-applicant").value,
        ),
        amount = Number(document.querySelector("#route-amount").value);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000)
        throw Error("请输入0～1000000之间的正金额");
      const a = compileApproval(
        {
          employee: person.name,
          department: configuration.org.departments.find(
            (d) => d.id === person.departmentId,
          ).name,
          amount,
          type: document.querySelector("#route-type").value,
        },
        flowTarget,
        configuration.org,
        role === "管理员" ? read() : configuration.flows,
      );
      out.innerHTML = `<div class="review-box">${a.branch === "high" ? "条件分支" : "默认分支"}：${a.nodes.map((n) => esc(n.actorName) + "（" + esc(n.label) + "）").join(" → ")} → ${flowTarget === "expense" ? (a.paymentActor ? esc(a.paymentActor.actorName) + "（付款工作台）" : "付款登记") : "申请批准"}</div>`;
    } catch (e) {
      out.textContent = "试算未通过：" + e.message;
    }
  });
}

function bindInbox() {
  document.querySelectorAll("[data-date-preset]").forEach(
    (b) =>
      (b.onclick = () => {
        const range = datePreset(b.dataset.datePreset);
        processedFrom = range.from;
        processedTo = range.to;
        processedPreset = b.dataset.datePreset;
        processedPage = 0;
        render();
      }),
  );
  for (const id of ["processed-from", "processed-to"])
    document.querySelector("#" + id)?.addEventListener("change", (e) => {
      if (id === "processed-from") processedFrom = e.target.value;
      else processedTo = e.target.value;
      processedPreset = processedFrom || processedTo ? "custom" : "all";
      processedPage = 0;
      render();
    });

  document.querySelectorAll("[data-processed-page]").forEach(
    (b) =>
      (b.onclick = () => {
        processedPage = Number(b.dataset.processedPage);
        render();
      }),
  );
  document.querySelectorAll("[data-inbox-view]").forEach(
    (b) =>
      (b.onclick = () => {
        inboxMode = b.dataset.inboxView;
        resetInboxFilters();
        inboxOrder = inboxMode === "processed" ? "newest" : "oldest";
        render();
      }),
  );
  document
    .querySelector("#processed-result")
    ?.addEventListener("change", (e) => {
      processedResult = e.target.value;
      processedPage = 0;
      render();
    });
  document.querySelector("#processed-export")?.addEventListener("click", () => {
    if (!requestStoreHealthy)
      return toast("申请存储异常，不能导出完整处理记录；请先恢复有效备份");
    if (processedRangeError()) return toast(processedRangeError());
    downloadFile(
      processedCsv(currentProcessed(processedOptions()), {
        from: processedFrom,
        to: processedTo,
      }),
      "轻报-我的处理记录.csv",
      "text/csv;charset=utf-8",
    );
    toast("已导出当前身份和筛选范围内的处理记录");
  });

  document.querySelectorAll("[data-inbox-kind]").forEach(
    (button) =>
      (button.onclick = () => {
        inboxKind = button.dataset.inboxKind;
        processedPage = 0;
        render();
      }),
  );
  document.querySelector("#inbox-order")?.addEventListener("change", (e) => {
    inboxOrder = e.target.value;
    processedPage = 0;
    render();
  });
  document.querySelector("#inbox-search")?.addEventListener("input", (e) => {
    inboxQuery = e.target.value;
    processedPage = 0;
    const position = e.target.selectionStart;
    render();
    const input = document.querySelector("#inbox-search");
    input.focus();
    input.setSelectionRange(position, position);
  });
  document.querySelector("#inbox-clear")?.addEventListener("click", () => {
    resetInboxFilters();
    render();
  });
  document.querySelector("#inbox-export")?.addEventListener("click", () => {
    if (!requestStoreHealthy)
      return toast("申请存储异常，不能导出完整统一待办；请先恢复有效备份");
    downloadFile(
      inboxCsv(
        currentInbox({ kind: inboxKind, query: inboxQuery, order: inboxOrder }),
      ),
      "轻报-当前审批待办.csv",
      "text/csv;charset=utf-8",
    );
    toast("已导出当前身份和筛选范围内的待办");
  });
}

function openPaymentBatch() {
  const ids = paymentRows(items, currentActor(), paymentFilter, paymentQuery)
    .filter(
      (d) =>
        paymentSelected.has(d.id) &&
        d.status === "待付款" &&
        canHandleDocument(d, "expense", currentActor()),
    )
    .map((d) => d.id);
  if (!ids.length || ids.length > 20) return toast("请勾选1～20笔待付款单据");
  const prefix =
    "DEMO-" +
    new Date().toLocaleDateString("sv-SE").replaceAll("-", "") +
    "-" +
    crypto.randomUUID().slice(0, 6).toUpperCase();
  modal(
    `<div class="modal-title"><h2>批量模拟付款登记</h2><button data-close aria-label="关闭">✕</button></div><p>已选 ${ids.length} 笔，合计 ${money(items.filter((d) => ids.includes(d.id)).reduce((n, d) => n + d.amount, 0))}。这里只登记模拟记录，不转账、不确认到账。每笔生成独立参考号，请逐笔核对。</p><form id="batch-payment-form"><label>模拟批次前缀<input name="prefix" maxlength="48" required value="${prefix}"></label><div class="form-grid"><label>登记日期<input name="date" type="date" required value="${new Date().toLocaleDateString("sv-SE")}"></label><label>付款方式<select name="method"><option>银行转账</option><option>其他线下付款</option></select></label></div><div id="batch-preview" aria-live="polite"></div><label>批量备注<textarea name="note" maxlength="400"></textarea></label><label class="check-line"><input name="confirmed" type="checkbox" required>已逐笔核对金额和参考号，确认仅登记模拟付款，不会真实转账</label><button type="submit" class="primary">确认登记这 ${ids.length} 笔</button></form>`,
  );
  const form = document.querySelector("#batch-payment-form");
  const preview = () => {
    try {
      const refs = batchReferences(form.elements.prefix.value, ids.length);
      document.querySelector("#batch-preview").innerHTML =
        '<ul class="batch-preview">' +
        ids
          .map((id, i) => {
            const d = items.find((d) => d.id === id);
            return `<li><b>${esc(d.name)}</b> · ${money(d.amount)}<small>${esc(id)} → ${esc(refs[i])}</small></li>`;
          })
          .join("") +
        "</ul>";
    } catch (e) {
      document.querySelector("#batch-preview").textContent = e.message;
    }
  };
  preview();
  form.addEventListener("input", () => {
    form.dataset.dirty = "true";
    preview();
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    try {
      const data = new FormData(form);
      requirePolicyForApproval("待付款");
      if (!enterpriseHealthy)
        throw Error("企业业务存储异常，不能核对付款参考号，未保存付款");
      for (const ref of batchReferences(data.get("prefix"), ids.length))
        assertUniqueReference(ref, enterprise.payments);
      const next = batchPayment(
        items,
        ids,
        currentActor(),
        {
          prefix: data.get("prefix"),
          date: data.get("date"),
          method: data.get("method"),
          confirmed: data.get("confirmed") === "on",
          note: data.get("note"),
        },
        policy,
      );
      persistExpenseItems(localStorage, next);
      items = next;
      let warning = "";
      try {
        record("批量模拟付款", `${ids.length}笔`, data.get("prefix"));
      } catch {
        warning = "；操作日志写入失败，请及时备份";
      }
      paymentSelected.clear();
      render();
      toast(`已登记 ${ids.length} 笔模拟付款，每笔处理记录已保留` + warning);
    } catch (err) {
      toast(err.message);
    }
  };
}
function bindPayments() {
  document.querySelectorAll("[data-payment-select]").forEach(
    (input) =>
      (input.onchange = () => {
        if (input.checked) {
          if (paymentSelected.size >= 20) {
            input.checked = false;
            return toast("每批最多20笔");
          }
          paymentSelected.add(input.dataset.paymentSelect);
        } else paymentSelected.delete(input.dataset.paymentSelect);
        render();
      }),
  );
  document
    .querySelector("#payment-select-all")
    ?.addEventListener("click", () => {
      const eligible = paymentRows(
        items,
        currentActor(),
        paymentFilter,
        paymentQuery,
      ).filter(
        (d) =>
          d.status === "待付款" &&
          canHandleDocument(d, "expense", currentActor()),
      );
      if (eligible.length > 20) return toast("请缩小搜索范围至20笔以内");
      paymentSelected = new Set(eligible.map((d) => d.id));
      render();
    });
  document
    .querySelector("#payment-select-clear")
    ?.addEventListener("click", () => {
      paymentSelected.clear();
      render();
    });
  document
    .querySelector("#payment-batch")
    ?.addEventListener("click", openPaymentBatch);
  document.querySelector("#payment-export")?.addEventListener("click", () => {
    downloadFile(
      paymentCsv(
        paymentRows(items, currentActor(), paymentFilter, paymentQuery),
        { filter: paymentFilter, query: paymentQuery },
      ),
      "轻报-付款清单.csv",
      "text/csv;charset=utf-8",
    );
  });
  document.querySelectorAll("[data-payment-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        paymentFilter = b.dataset.paymentFilter;
        paymentSelected.clear();
        render();
      }),
  );
  document.querySelector("#payment-search")?.addEventListener("input", (e) => {
    paymentQuery = e.target.value;
    paymentSelected.clear();
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector("#payment-search");
    input.focus();
    input.setSelectionRange(pos, pos);
  });
}
