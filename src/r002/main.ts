import "../r001/style.css";
import "../shared/rule-links.css";
import "./style.css";
import { centsToYuan } from "../r001/rule";
import {
  displayTime,
  escapeHtml as esc,
  formatYuan as yuan,
  humanReviewCard,
  ruleLinks,
} from "../shared/audit-ui";
import { HISTORY_STATUSES, INVOICE_TYPES } from "./invoiceTypes";
import type {
  AuditStatus,
  AuditVersion,
  CurrentClaim,
  HistoryInvoice,
  HistoryStatus,
  InvoiceDocument,
  InvoiceInput,
  InvoiceIssue,
  R002State,
} from "./invoiceTypes";
import { emptyInvoiceInput, t02Input } from "./invoiceMockData";
import {
  auditAndSave,
  boundInvoice,
  createR002State,
  historyForAudit,
  historyFromInput,
  latestAudit,
  loadR002,
  restoreLibraryAndSave,
  reviewAndSave,
  saveR002,
  upsertHistory,
} from "./invoiceRepository";
import { inspectInput } from "./invoiceDuplicateRule";

type Page = "entry" | "results" | "review" | "library";
const root = document.querySelector<HTMLDivElement>("#r002-app")!,
  initial = loadR002(localStorage);
let state: R002State = initial.ok ? initial.state : createR002State(),
  savedRaw = initial.ok ? initial.raw : null,
  healthy = initial.ok,
  page: Page = "entry",
  message = "",
  selectedDocId = "",
  selectedAuditId = "",
  editingVersion = 0,
  entryIssues: readonly InvoiceIssue[] = [],
  libraryIssues: readonly InvoiceIssue[] = [],
  query = "",
  statusFilter = "";
const now = () => new Date().toISOString(),
  uuid = () => crypto.randomUUID(),
  today = () =>
    new Date()
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
      .replaceAll("-", "");
const newClaim = (): CurrentClaim => ({
  documentId: `BX-R002-${today()}-${uuid().slice(0, 8).toUpperCase()}`,
  invoiceRecordId: `INV-R002-${uuid()}`,
  submittedAt: now(),
  input: emptyInvoiceInput(),
});
let draft = newClaim();
type LibraryDraft = {
  editingId: string;
  rowId: string;
  claim: CurrentClaim;
  businessStatus: HistoryStatus;
};
const newLibrary = (): LibraryDraft => ({
  editingId: "",
  rowId: `H-${uuid()}`,
  claim: {
    ...newClaim(),
    documentId: `BX-R002-H-${uuid().slice(0, 8).toUpperCase()}`,
  },
  businessStatus: "已通过",
});
let libraryDraft = newLibrary();
const statusText: Record<AuditStatus, string> = {
  passed: "通过 R002 查重",
  review_required: "需要人工复核",
  incomplete: "待补充资料",
  invalid: "数据错误",
};
const statusClass: Record<AuditStatus, string> = {
  passed: "success",
  review_required: "warning",
  incomplete: "neutral",
  invalid: "danger",
};
const titles: Record<Page, [string, string, string]> = {
  entry: [
    "01",
    "发票报销单录入",
    "一张发票、一笔报销，按票面标识比对当前本地记录。",
  ],
  results: [
    "02",
    "R002 自动审核结果",
    "区分精确票面重复、潜在标识冲突与数据不足。",
  ],
  review: [
    "03",
    "人工复核",
    "对风险作独立判断，保留每个版本的自动结论与证据。",
  ],
  library: [
    "04",
    "模拟历史发票库",
    "搜索、筛选和维护模拟历史；既有审核证据不会随库修改。",
  ],
};
const selectedDoc = (): InvoiceDocument | undefined =>
  state.documents.find((d) => d.id === selectedDocId) || state.documents[0];
const selectedAudit = (doc: InvoiceDocument): AuditVersion =>
  doc.audits.find((a) => a.id === selectedAuditId) || latestAudit(doc);
const badge = (status: AuditStatus) =>
  `<span class="badge ${statusClass[status]}">${statusText[status]}</span>`;
const canLeave = () =>
  !root.querySelector<HTMLFormElement>("form[data-dirty=true]") ||
  confirm("本次录入/复核/历史库修改尚未保存，是否放弃并切换？");
function setState(next: R002State): void {
  state = next;
  savedRaw = JSON.stringify(next);
  healthy = true;
}
function navigate(next: Page): void {
  if (!canLeave()) return;
  page = next;
  message = "";
  render();
  window.scrollTo(0, 0);
}
function selectDocument(doc: InvoiceDocument, audit = latestAudit(doc)): void {
  selectedDocId = doc.id;
  selectedAuditId = audit.id;
}
function issue(
  field: keyof InvoiceInput,
  issues: readonly InvoiceIssue[],
  prefix: string,
): string {
  return `<small class="field-error" data-error-field="${field}" id="${prefix}-${field}-error">${issues
    .filter((i) => i.field === field)
    .map((i) => esc(i.message))
    .join("；")}</small>`;
}
function invoiceFields(
  input: InvoiceInput,
  issues: readonly InvoiceIssue[],
  prefix: string,
  locked = false,
): string {
  const value = (field: keyof InvoiceInput) => esc(input[field]);
  return `<div class="form-grid"><label>员工姓名 <span class="required">*</span><input name="employeeName" maxlength="40" value="${value("employeeName")}" autocomplete="off" aria-describedby="${prefix}-employeeName-error">${issue("employeeName", issues, prefix)}</label><label>员工部门（可选）<input name="department" maxlength="80" value="${value("department")}"></label></div><h3 class="form-section">票面信息</h3><div class="form-grid"><label>发票类型 <span class="required">*</span><select name="invoiceType" ${locked ? "disabled" : ""} aria-describedby="${prefix}-invoiceType-error">${INVOICE_TYPES.map((t) => `<option ${t === input.invoiceType ? "selected" : ""}>${t}</option>`).join("")}</select>${issue("invoiceType", issues, prefix)}</label><label>发票代码<input name="invoiceCode" ${locked ? "readonly" : ""} maxlength="40" inputmode="numeric" class="identifier" value="${value("invoiceCode")}" aria-describedby="${prefix}-invoiceCode-error"><small>无代码数电发票可留空；传统电子/纸质发票必须补代码。</small>${issue("invoiceCode", issues, prefix)}</label></div><label>发票号码 <span class="required">*</span><input name="invoiceNumber" ${locked ? "readonly" : ""} maxlength="40" class="identifier invoice-number-input" inputmode="numeric" autocomplete="off" value="${value("invoiceNumber")}" aria-describedby="${prefix}-invoiceNumber-error"><small>按文本保存，保留20位号码及前导零，不转换成数字。</small>${issue("invoiceNumber", issues, prefix)}</label><div class="form-grid"><label>开票日期 <span class="required">*</span><input name="issueDate" type="date" value="${value("issueDate")}" aria-describedby="${prefix}-issueDate-error">${issue("issueDate", issues, prefix)}</label><label>发票含税金额（元） <span class="required">*</span><div class="currency-input"><span>¥</span><input name="amountYuan" inputmode="decimal" maxlength="40" value="${value("amountYuan")}" aria-describedby="${prefix}-amountYuan-error"><span>CNY</span></div>${issue("amountYuan", issues, prefix)}</label></div><label>销售方名称 <span class="required">*</span><input name="sellerName" maxlength="120" value="${value("sellerName")}" aria-describedby="${prefix}-sellerName-error">${issue("sellerName", issues, prefix)}</label><div class="form-grid"><label>销售方税号（可选）<input name="sellerTaxId" maxlength="40" value="${value("sellerTaxId")}">${issue("sellerTaxId", issues, prefix)}</label><label>购买方名称（可选）<input name="buyerName" maxlength="120" value="${value("buyerName")}">${issue("buyerName", issues, prefix)}</label></div><label>发票备注（可选）<textarea name="remark" maxlength="500" rows="2">${value("remark")}</textarea>${issue("remark", issues, prefix)}</label>`;
}
function readInput(form: HTMLFormElement): InvoiceInput {
  return Object.fromEntries(
    Object.keys(emptyInvoiceInput()).map((k) => [
      k,
      (form.elements.namedItem(k) as HTMLInputElement).value,
    ]),
  ) as unknown as InvoiceInput;
}
function entryView(): string {
  const locked = !!state.documents.find(
    (d) => d.id === draft.documentId && boundInvoice(d),
  );
  return `<div class="two-columns"><section class="card"><div class="card-heading"><div><h2>${editingVersion ? "修改资料 / 同单新版本审核" : "新建发票报销单"}</h2><p>${editingVersion ? `当前已有${editingVersion}个审核版本；再审不覆盖旧版。` : "提交日期由系统生成，发票记录编号唯一。"}</p></div><span class="badge neutral">R002</span></div><form id="r002-entry-form" novalidate><label>报销单编号<input value="${esc(draft.documentId)}" readonly id="r002-document-id"><small>发票记录编号 ${esc(draft.invoiceRecordId)}<br>提交时间 ${esc(displayTime(draft.submittedAt))}</small></label>${locked ? '<p class="note">同单已绑定有效票面标识；只补充/修正其他资料。更换发票类型、代码或号码请新建单据。</p>' : ""}${invoiceFields(draft.input, entryIssues, "entry", locked)}<div class="form-actions">${locked ? "" : '<button type="button" class="secondary" id="r002-load-t02">载入 T02 重复示例</button>'}<button type="submit" class="primary">执行自动审核 →</button></div><p id="r002-entry-error" class="form-error" role="alert"></p>${entryIssues.length ? '<p class="note">本次数据问题已保存为审核版本，未执行可靠查重；修正后再次审核会生成新版本。</p>' : ""}</form></section><aside class="context-column"><section class="card context-card"><span class="eyebrow">INVOICE DUPLICATE CHECK</span><h2>识别重复风险<br>让证据可追溯</h2><ol class="logic-list"><li><b>传统发票</b><span>同类型，代码＋号码匹配</span></li><li><b>无代码数电发票</b><span>相同类型按完整号码匹配</span></li><li><b>跨类型同号</b><span>潜在冲突，交财务核查</span></li></ol><div class="note">不按金额相同判重。驳回或撤回的历史记录也需复核，不自动放行。</div></section><section class="card mini-card"><span class="eyebrow">当前可访问范围</span><h3>${historyForAudit(state).length} 笔本地记录</h3><p>${state.library.length} 笔模拟历史＋本地R002有效单据。待补充版本本身不加入可靠查重；已有有效版本仍保留在历史范围。</p><button class="text-button" data-page="library">查看本地发票库 →</button></section></aside></div>`;
}
function selectors(): string {
  if (!state.documents.length) return "";
  const d = selectedDoc()!;
  return `<div class="form-grid selectors"><label>选择报销单<select id="r002-document-select">${state.documents.map((doc) => `<option value="${esc(doc.id)}" ${doc.id === d.id ? "selected" : ""}>${esc(doc.id)} · ${esc(doc.input.employeeName || "待补充姓名")} · ${doc.businessStatus}</option>`).join("")}</select></label><label>选择审核版本<select id="r002-version-select">${[
    ...d.audits,
  ]
    .reverse()
    .map(
      (a) =>
        `<option value="${esc(a.id)}" ${a.id === selectedAudit(d).id ? "selected" : ""}>v${a.version} · ${statusText[a.automatic.status]}${a.humanReview ? " / 人工" + (a.humanReview.decision === "approved" ? "通过" : "驳回") : ""}${a.id !== latestAudit(d).id ? "（历史只读）" : ""}</option>`,
    )
    .join("")}</select></label></div>`;
}
function resultDetails(doc: InvoiceDocument, audit: AuditVersion): string {
  const r = audit.automatic,
    i = r.currentInvoice,
    e = r.evidence;
  return `<section class="status-card ${statusClass[r.status]}" data-testid="r002-auto-result"><div class="status-icon">${r.status === "passed" ? "✓" : "!"}</div><div>${badge(r.status)}<h2>${esc(r.explanation)}</h2><p>${esc(doc.id)} · 审核v${audit.version} · ${esc(audit.inputSnapshot.input.employeeName || "姓名待补充")}</p></div></section><div class="notice">单据当前业务状态：<b data-testid="r002-business-status">${doc.businessStatus}</b>；以下自动/人工结论属于审核v${audit.version}。通过R002不代表整单审批通过，二者分别记录。</div><section class="card"><div class="card-heading"><div><h2>本次发票与匹配策略</h2><p>${esc(displayTime(r.at))} · R002 v1 · 审核版本v${audit.version}</p></div><span class="badge neutral">原始自动结论</span></div><dl class="result-grid"><div><dt>发票类型</dt><dd>${esc(i.type || "未填写")}</dd></div><div><dt>发票号码</dt><dd class="identifier" data-testid="r002-invoice-number">${esc(i.number || "未填写")}</dd></div><div><dt>发票代码</dt><dd class="identifier">${esc(i.code || "无代码/未填写")}</dd></div><div><dt>含税金额</dt><dd data-testid="r002-amount">${yuan(i.amountCents)}</dd></div><div><dt>开票日期</dt><dd>${esc(i.issueDate || "未填写")}</dd></div><div><dt>销售方</dt><dd>${esc(i.sellerName || "未填写")}</dd></div><div><dt>销售方税号</dt><dd>${esc(i.sellerTaxId || "未填写")}</dd></div><div><dt>购买方</dt><dd>${esc(i.buyerName || "未填写")}</dd></div></dl>${i.remark ? `<p>备注：${esc(i.remark)}</p>` : ""}<div class="calculation"><span class="eyebrow">实际匹配策略</span><p>${esc(r.strategy)}</p><p>金额不参与票面身份匹配；不因金额相同就判定重复。</p></div>${r.issues.length ? `<div class="error-card inline-error"><h3>待补充 / 数据错误</h3><ul>${r.issues.map((issue) => `<li>${esc(issue.message)}</li>`).join("")}</ul><p>本次未执行可靠查重，不能把未执行当作“没有重复”。</p></div>` : ""}${r.zeroAmount ? '<p class="zero-warning">金额为0，请人工确认，不直接认定重复或正常通过。</p>' : ""}</section><section class="card"><div class="card-heading"><div><h2>关联历史报销证据</h2><p>${r.searchPerformed ? `命中${r.matchCount}笔：${r.exactCount}笔票面标识重复，${r.potentialCount}笔潜在冲突。` : "数据不完整，查重尚未执行。"}</p></div></div><div class="evidence-counts"><span>精确票面标识重复 <b data-testid="r002-exact-count">${r.searchPerformed ? r.exactCount : "未执行"}</b></span><span>潜在标识冲突 <b data-testid="r002-potential-count">${r.searchPerformed ? r.potentialCount : "未执行"}</b></span><span>总命中 <b data-testid="r002-match-count">${r.searchPerformed ? r.matchCount : "未执行"}</b></span></div>${r.matches.length ? `<div class="table-scroll"><table class="evidence-table" data-testid="r002-matches"><thead><tr><th>历史单号/员工</th><th>类型/代码</th><th>发票号码</th><th>金额</th><th>历史业务状态</th><th>匹配原因</th></tr></thead><tbody>${r.matches.map((m) => `<tr><td><b>${esc(m.historical.documentId)}</b><small>${esc(m.historical.employeeName)} / ${esc(m.historical.department)}</small></td><td>${esc(m.historical.invoice.type)}<small class="identifier">${esc(m.historical.invoice.code || "无代码")}</small></td><td class="identifier">${esc(m.historical.invoice.number)}</td><td>${yuan(m.historical.invoice.amountCents)}</td><td>${m.historical.businessStatus}</td><td class="reason-cell"><b class="badge ${m.kind === "exact" ? "warning" : "neutral"}">${m.kind === "exact" ? "票面标识重复" : "潜在冲突"} · ${m.strategy}</b><p>${esc(m.reason)}</p><p>${esc(m.statusExplanation)}</p></td></tr>`).join("")}</tbody></table></div>` : r.searchPerformed ? '<p class="empty-note">未发现当前模拟历史记录中的重复发票。</p>' : '<p class="empty-note">请补充或修正资料后重新执行查重。</p>'}<details class="evidence-summary"><summary>查重范围与必要证据摘要</summary><p>当时本地数据版本v${e.dataRevision}；来源${e.sourceCount}笔，排除自身${e.excludedSelfCount}笔，实际比较${e.checkedCount}笔，同号码候选${e.candidates.length}笔。</p><p>已保存所有同号码候选及命中时的单号、人员、票面标识、金额和业务状态；库修改或恢复不改此处证据。</p>${e.candidates.length ? `<ul>${e.candidates.map((c) => `<li>${esc(c.documentId)} / ${esc(c.invoice.type)} / 代码${esc(c.invoice.code || "无")} / 号码${esc(c.invoice.number)} / ${c.businessStatus}</li>`).join("")}</ul>` : ""}</details><div class="note">本规则仅对当前浏览器可访问的R002模拟历史库和本地R002单据查重。不是税务验真，不保证跨企业、跨系统或其他浏览器未报销；命中不是违规结论。</div></section>`;
}
function reviewSection(
  doc: InvoiceDocument,
  audit: AuditVersion,
  editable: boolean,
): string {
  const latest = latestAudit(doc).id === audit.id;
  return `<section class="card"><div class="card-heading"><div><h2>人工复核结论</h2><p>单独保存复核人员、原因与时间，不覆盖自动审核版本。</p></div></div>${audit.humanReview ? humanReviewCard(audit.humanReview) : !latest ? '<p class="muted">历史版本只读；请在最新版本进行复核，原始结果仍保留。</p>' : audit.automatic.status !== "review_required" ? '<p class="muted">此版本无需风险复核。资料错误请修改后重新审核；本项通过不自动批准整张报销单。</p>' : editable ? `<form id="r002-review-form" novalidate><label>复核人员姓名 <span class="required">*</span><input name="reviewer" maxlength="40" placeholder="请输入模拟财务姓名"></label><label>复核原因 <span class="required">*</span><textarea name="reviewReason" maxlength="500" rows="4" placeholder="例如：经核对，与BX-H001为同一发票，驳回本次重复提交。"></textarea></label><div class="form-actions"><button type="submit" name="decision" value="rejected" class="danger-button">人工驳回</button><button type="submit" name="decision" value="approved" class="primary">人工通过</button></div><p class="form-error" id="r002-review-error" role="alert"></p></form>` : '<button class="primary" data-page="review">进入人工复核 →</button>'}</section>`;
}
function resultsView(review = false): string {
  const doc = selectedDoc();
  if (!doc)
    return `<section class="card empty-state"><h2>暂无R002审核记录</h2><p>先录入一张模拟发票，执行自动审核。</p><button class="primary" data-page="entry">录入发票报销单</button></section>`;
  const audit = selectedAudit(doc);
  return `${selectors()}${resultDetails(doc, audit)}${reviewSection(doc, audit, review)}<section class="card"><div class="form-actions"><button class="secondary" id="r002-edit-document">修改资料后同单重审</button><button class="primary" id="r002-reaudit">重新审核（同单新版本）</button></div><p class="muted small-note">以当前单据最新资料和最新本地历史重新查重，排除自身。将生成v${doc.audits.length + 1}，当前业务状态回到审核中/待补充；旧版本及其复核保持只读可查看。</p></section>`;
}
function libraryView(): string {
  const all = historyForAudit(state),
    needle = query.normalize("NFKC").trim().toLowerCase(),
    rows = all.filter(
      (r) =>
        (!statusFilter || r.businessStatus === statusFilter) &&
        (!needle ||
          [r.documentId, r.invoice.number, r.invoice.code, r.employeeName].some(
            (v) => v.normalize("NFKC").toLowerCase().includes(needle),
          )),
    );
  return `<div class="notice">模拟数据环境：${state.library.length}笔可维护历史＋${all.length - state.library.length}笔本地R002单据。待补充版本不参与查重，已有有效版本仍保留。修改只影响下一次审核，既有证据按版本保留。</div><section class="card"><div class="card-heading"><div><h2>历史发票及关联单据</h2><p>共${all.length}笔，当前筛选${rows.length}笔。</p></div><button class="secondary" id="r002-restore-library">恢复初始化历史库</button></div><div class="form-grid library-filters"><label>搜索发票号码 / 历史单号<input id="r002-history-search" value="${esc(query)}" placeholder="可搜号码、代码、单号或员工"></label><label>业务状态筛选<select id="r002-history-status"><option value="">全部业务状态</option>${HISTORY_STATUSES.map((s) => `<option ${s === statusFilter ? "selected" : ""}>${s}</option>`).join("")}</select></label></div><div class="table-scroll"><table id="r002-history-table"><thead><tr><th>单号/员工</th><th>发票类型/代码</th><th>发票号码</th><th>金额</th><th>业务状态</th><th>来源/操作</th></tr></thead><tbody>${rows.map((r) => `<tr><td><b>${esc(r.documentId)}</b><small>${esc(r.employeeName)}</small></td><td>${esc(r.invoice.type)}<small class="identifier">${esc(r.invoice.code || "无代码")}</small></td><td class="identifier">${esc(r.invoice.number)}</td><td>${yuan(r.invoice.amountCents)}</td><td>${r.businessStatus}</td><td>${state.library.some((x) => x.id === r.id) ? `模拟历史<br><button class="text-button" data-edit-history="${esc(r.id)}">编辑模拟记录</button>` : `本地R002 · 有效v${r.sourceAuditVersion || "—"}<br><button class="text-button" data-open-document="${esc(r.documentId)}">查看审核版本</button>`}</td></tr>`).join("") || '<tr><td colspan="6">暂无匹配记录</td></tr>'}</tbody></table></div></section><section class="card"><div class="card-heading"><div><h2>${libraryDraft.editingId ? "编辑模拟历史记录" : "添加模拟历史记录"}</h2><p>该表为演示历史库；业务状态不等于自动审核结果。</p></div></div><form id="r002-history-form" novalidate><div class="form-grid"><label>模拟历史报销单编号<input name="historyDocumentId" maxlength="80" value="${esc(libraryDraft.claim.documentId)}" ${libraryDraft.editingId ? "readonly" : ""}></label><label>历史业务状态<select name="historyBusinessStatus">${HISTORY_STATUSES.map((s) => `<option ${s === libraryDraft.businessStatus ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>${invoiceFields(libraryDraft.claim.input, libraryIssues, "library")}<div class="form-actions"><button class="secondary" type="button" id="r002-new-history">新增另一条模拟历史</button><button class="primary" type="submit">保存模拟历史记录</button></div><p class="form-error" id="r002-history-error" role="alert"></p></form></section>`;
}
function render(): void {
  const current = selectedDoc();
  if (current) {
    selectedDocId = current.id;
    selectedAuditId = selectedAudit(current).id;
  }
  root.innerHTML = `<div class="r001-layout r002-layout"><aside class="sidebar"><a class="brand" href="./r002.html"><span class="brand-mark">轻</span><span>轻报<small>智能费用审核</small></span></a><div class="scope-tag">R002 · 发票重复报销审核</div>${ruleLinks("R002")}<p class="nav-label">审核工作空间</p><nav>${(Object.keys(titles) as Page[]).map((p) => `<button class="nav-button ${page === p ? "active" : ""}" data-page="${p}"><span class="nav-number">${titles[p][0]}</span><span>${titles[p][1]}</span></button>`).join("")}</nav><div class="sidebar-footer"><span class="local-dot"></span> 模拟数据 · 本浏览器保存<p>不连接税务或企业生产系统</p></div></aside><div class="main-shell"><header><div class="breadcrumb">费用审核 <span>/</span> R002</div><div class="operator"><span class="demo-pill">作品 v2</span><span class="operator-avatar">财</span><span>财务审核员<small>模拟身份</small></span></div></header><main><div class="page-title"><div><span class="eyebrow">INVOICE DUPLICATE REVIEW · ${titles[page][0]}</span><h1>${titles[page][1]}</h1><p>${titles[page][2]}</p></div>${healthy ? '<button class="secondary" id="r002-new">＋ 新建发票报销</button>' : ""}</div>${message ? `<div class="feedback" role="status">${esc(message)}</div>` : ""}${healthy ? { entry: entryView, results: () => resultsView(), review: () => resultsView(true), library: libraryView }[page]() : `<section class="card error-card"><h2>本地数据需要处理</h2><p>${esc(initial.ok ? "本地数据无法安全读取，请保留原值处理。" : initial.message)}</p><p>恢复只尝试修复模拟库；若已有单据或证据也损坏，将拒绝执行，不清空数据。</p><button class="secondary" id="r002-recover-library">在保留审核证据前提下恢复模拟库</button></section>`}<footer>仅境内人民币模拟查重 · 单票单单 · 不代表税务验真或违规认定</footer></main></div></div>`;
  bind();
}
function execute(claim: CurrentClaim, expectedVersion: number): void {
  const next = auditAndSave(
    localStorage,
    claim,
    now(),
    `AUD-R002-${uuid()}`,
    expectedVersion,
  );
  setState(next);
  const doc = state.documents.find((d) => d.id === claim.documentId)!;
  selectDocument(doc);
  draft = {
    documentId: doc.id,
    invoiceRecordId: doc.invoiceRecordId,
    submittedAt: doc.submittedAt,
    input: { ...doc.input },
  };
  editingVersion = doc.audits.length;
  entryIssues = latestAudit(doc).automatic.issues;
  page = entryIssues.length ? "entry" : "results";
  message = entryIssues.length
    ? `已保存审核v${editingVersion}的数据问题，请在字段附近修正；未执行可靠查重。`
    : `已保存R002审核v${editingVersion}；保存前已按最新本地数据重新查重，旧审核版本不覆盖。`;
  render();
  window.scrollTo(0, 0);
}
function restore(): void {
  if (
    !confirm(
      "将替换R002模拟历史库（包括新增和编辑的模拟记录），恢复5笔种子。R002已审核单据、所有审核版本与复核证据、R001数据均保留。是否继续？",
    )
  )
    return;
  try {
    setState(restoreLibraryAndSave(localStorage));
    libraryDraft = newLibrary();
    libraryIssues = [];
    message = "已恢复5笔模拟历史；R002审核/复核证据及R001数据未删除。";
    render();
  } catch (e) {
    message = (e as Error).message;
    render();
  }
}
function bind(): void {
  root
    .querySelectorAll<HTMLButtonElement>("[data-page]")
    .forEach((b) => (b.onclick = () => navigate(b.dataset.page as Page)));
  root
    .querySelector<HTMLButtonElement>("#r002-new")
    ?.addEventListener("click", () => {
      if (!canLeave()) return;
      draft = newClaim();
      editingVersion = 0;
      entryIssues = [];
      page = "entry";
      message = "";
      render();
      window.scrollTo(0, 0);
    });
  root
    .querySelector<HTMLButtonElement>("#r002-load-t02")
    ?.addEventListener("click", () => {
      draft = { ...draft, input: t02Input() };
      entryIssues = [];
      message =
        "已载入T02：李四提交BX-H001同代码/同号码500元发票。请核对当前模拟历史库后执行审核。";
      render();
      root.querySelector<HTMLFormElement>("#r002-entry-form")!.dataset.dirty =
        "true";
    });
  const entry = root.querySelector<HTMLFormElement>("#r002-entry-form");
  if (entry) {
    entry.oninput = (e) => {
      draft = { ...draft, input: readInput(entry) };
      entry.dataset.dirty = "true";
      const name = (e.target as HTMLInputElement).name;
      root
        .querySelectorAll<HTMLElement>(`[data-error-field="${name}"]`)
        .forEach((el) => (el.textContent = ""));
    };
    entry.onsubmit = (e) => {
      e.preventDefault();
      try {
        draft = { ...draft, input: readInput(entry) };
        execute(draft, editingVersion);
      } catch (error) {
        root.querySelector("#r002-entry-error")!.textContent = (
          error as Error
        ).message;
      }
    };
  }
  for (const [id, isVersion] of [
    ["#r002-document-select", false],
    ["#r002-version-select", true],
  ] as const) {
    root
      .querySelector<HTMLSelectElement>(id)
      ?.addEventListener("change", (e) => {
        const el = e.target as HTMLSelectElement;
        if (!canLeave()) {
          el.value = isVersion ? selectedAuditId : selectedDocId;
          return;
        }
        if (isVersion) selectedAuditId = el.value;
        else {
          selectedDocId = el.value;
          selectedAuditId = latestAudit(selectedDoc()!).id;
        }
        message = "";
        render();
      });
  }
  root
    .querySelector<HTMLButtonElement>("#r002-reaudit")
    ?.addEventListener("click", () => {
      if (!canLeave()) return;
      const doc = selectedDoc()!;
      try {
        execute(
          {
            documentId: doc.id,
            invoiceRecordId: doc.invoiceRecordId,
            submittedAt: doc.submittedAt,
            input: { ...doc.input },
          },
          doc.audits.length,
        );
      } catch (error) {
        message = (error as Error).message;
        render();
      }
    });
  root
    .querySelector<HTMLButtonElement>("#r002-edit-document")
    ?.addEventListener("click", () => {
      if (!canLeave()) return;
      const d = selectedDoc()!;
      draft = {
        documentId: d.id,
        invoiceRecordId: d.invoiceRecordId,
        submittedAt: d.submittedAt,
        input: { ...d.input },
      };
      const binding = boundInvoice(d);
      if (binding)
        draft = {
          ...draft,
          input: {
            ...draft.input,
            invoiceType: binding.type,
            invoiceCode: binding.code,
            invoiceNumber: binding.number,
          },
        };
      editingVersion = d.audits.length;
      entryIssues = [];
      page = "entry";
      message = "修改后重新审核将生成新版本，原始版本及其复核仍可查看。";
      render();
      window.scrollTo(0, 0);
    });
  const review = root.querySelector<HTMLFormElement>("#r002-review-form");
  if (review) {
    review.oninput = () => {
      review.dataset.dirty = "true";
    };
    review.onsubmit = (e) => {
      e.preventDefault();
      try {
        const decision = (e.submitter as HTMLButtonElement)?.value;
        if (decision !== "approved" && decision !== "rejected")
          throw Error("请选择人工通过或人工驳回");
        const d = selectedDoc()!,
          a = selectedAudit(d),
          form = new FormData(review);
        setState(
          reviewAndSave(
            localStorage,
            d.id,
            a.id,
            decision,
            String(form.get("reviewReason")),
            String(form.get("reviewer")),
            now(),
          ),
        );
        message =
          "已独立保存人工" +
          (decision === "approved" ? "通过" : "驳回") +
          "；原始自动结论与证据未覆盖。";
        render();
      } catch (error) {
        root.querySelector("#r002-review-error")!.textContent = (
          error as Error
        ).message;
      }
    };
  }
  root
    .querySelector<HTMLButtonElement>("#r002-restore-library")
    ?.addEventListener("click", restore);
  root
    .querySelector<HTMLButtonElement>("#r002-recover-library")
    ?.addEventListener("click", restore);
  root
    .querySelector<HTMLInputElement>("#r002-history-search")
    ?.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      query = el.value;
      const cursor = el.selectionStart,
        dirty =
          root.querySelector<HTMLFormElement>("#r002-history-form")?.dataset
            .dirty;
      render();
      if (dirty === "true")
        root.querySelector<HTMLFormElement>(
          "#r002-history-form",
        )!.dataset.dirty = "true";
      const next = root.querySelector<HTMLInputElement>(
        "#r002-history-search",
      )!;
      next.focus();
      next.setSelectionRange(cursor, cursor);
    });
  root
    .querySelector<HTMLSelectElement>("#r002-history-status")
    ?.addEventListener("change", (e) => {
      statusFilter = (e.target as HTMLSelectElement).value;
      const dirty =
        root.querySelector<HTMLFormElement>("#r002-history-form")?.dataset
          .dirty;
      render();
      if (dirty === "true")
        root.querySelector<HTMLFormElement>(
          "#r002-history-form",
        )!.dataset.dirty = "true";
    });
  const historyForm = root.querySelector<HTMLFormElement>("#r002-history-form");
  if (historyForm) {
    const collect = () => {
      libraryDraft = {
        ...libraryDraft,
        businessStatus: (
          historyForm.elements.namedItem(
            "historyBusinessStatus",
          ) as HTMLSelectElement
        ).value as HistoryStatus,
        claim: {
          ...libraryDraft.claim,
          documentId: (
            historyForm.elements.namedItem(
              "historyDocumentId",
            ) as HTMLInputElement
          ).value.trim(),
          input: readInput(historyForm),
        },
      };
    };
    historyForm.oninput = () => {
      collect();
      historyForm.dataset.dirty = "true";
    };
    historyForm.onsubmit = (e) => {
      e.preventDefault();
      try {
        collect();
        libraryIssues = inspectInput(libraryDraft.claim.input).issues;
        if (libraryIssues.length) {
          render();
          root.querySelector<HTMLFormElement>(
            "#r002-history-form",
          )!.dataset.dirty = "true";
          return;
        }
        const row = historyFromInput(
          libraryDraft.claim,
          libraryDraft.businessStatus,
          libraryDraft.rowId,
          now(),
        );
        const next = upsertHistory(state, row, libraryDraft.editingId);
        saveR002(localStorage, next, savedRaw);
        setState(next);
        libraryDraft = newLibrary();
        libraryIssues = [];
        message = "模拟历史已保存，下次审核使用新数据，历史审核证据不变。";
        render();
      } catch (error) {
        root.querySelector("#r002-history-error")!.textContent = (
          error as Error
        ).message;
      }
    };
    root.querySelector<HTMLButtonElement>("#r002-new-history")!.onclick =
      () => {
        if (!canLeave()) return;
        libraryDraft = newLibrary();
        libraryIssues = [];
        render();
      };
    root.querySelectorAll<HTMLButtonElement>("[data-edit-history]").forEach(
      (b) =>
        (b.onclick = () => {
          if (!canLeave()) return;
          const row = state.library.find(
            (r) => r.id === b.dataset.editHistory,
          )!;
          libraryDraft = {
            editingId: row.id,
            rowId: row.id,
            businessStatus: row.businessStatus,
            claim: {
              documentId: row.documentId,
              invoiceRecordId: row.invoice.id,
              submittedAt: row.submittedAt,
              input: {
                employeeName: row.employeeName,
                department: row.department,
                invoiceType: row.invoice.type,
                invoiceCode: row.invoice.code,
                invoiceNumber: row.invoice.number,
                issueDate: row.invoice.issueDate,
                sellerName: row.invoice.sellerName,
                sellerTaxId: row.invoice.sellerTaxId,
                buyerName: row.invoice.buyerName,
                amountYuan: centsToYuan(row.invoice.amountCents),
                remark: row.invoice.remark,
              },
            },
          };
          libraryIssues = [];
          render();
          root
            .querySelector("#r002-history-form")!
            .scrollIntoView({ behavior: "smooth", block: "start" });
        }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-open-document]").forEach(
      (b) =>
        (b.onclick = () => {
          if (!canLeave()) return;
          selectDocument(
            state.documents.find((d) => d.id === b.dataset.openDocument)!,
          );
          page = "results";
          message = "";
          render();
          window.scrollTo(0, 0);
        }),
    );
  }
}
window.addEventListener("beforeunload", (e) => {
  if (root.querySelector("form[data-dirty=true]")) {
    e.preventDefault();
    e.returnValue = "";
  }
});
render();
