import { humanReviewCard, ruleLinks } from "../shared/audit-ui";
import "../shared/rule-links.css";
import "./style.css";
import { GRADES } from "./types";
import type {
  AuditRecord,
  AuditStatus,
  LodgingInput,
  R001State,
} from "./types";
import { calculateNights, centsToYuan } from "./rule";
import {
  appendRecord,
  createExampleState,
  loadState,
  makeRecord,
  replaceRecord,
  reviewRecord,
  saveState,
  t03Input,
  upsertStandard,
} from "./model";

type Page = "entry" | "results" | "review" | "standards";
const root = document.querySelector<HTMLDivElement>("#r001-app")!;
const loaded = loadState(localStorage);
let state: R001State = loaded.ok ? loaded.state : createExampleState();
let savedRaw = loaded.ok ? loaded.raw : undefined;
let healthy = loaded.ok,
  page: Page = "entry",
  selectedId = state.records[0]?.id || "",
  message = "";
const now = () => new Date().toISOString();
const newId = () =>
  `R001-${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const emptyInput = (): LodgingInput => ({
  documentId: newId(),
  employeeName: "",
  grade: "",
  city: "深圳",
  checkIn: "",
  checkOut: "",
  amountYuan: "",
});
let draft = emptyInput();
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const yuan = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "无法计算"
    : `¥ ${centsToYuan(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const statusLabel: Record<AuditStatus, string> = {
  passed: "通过本项审核",
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
const labels: Record<Page, [string, string, string]> = {
  entry: [
    "01",
    "住宿报销单录入",
    "填写住宿信息，系统查询适用标准并计算住宿限额。",
  ],
  results: ["02", "自动审核结果", "查看原始审核结论、标准快照与完整计算依据。"],
  review: ["03", "人工复核", "独立记录财务判断，保留原始自动审核结果。"],
  standards: [
    "04",
    "模拟住宿标准",
    "按城市和职级维护制度；修改只影响下一次审核。",
  ],
};
const icon = (name: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ entry: '<path d="M14 3H5v18h14V8z"/><path d="M14 3v5h5M8 12h8M8 16h5"/>', results: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>', review: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M15 8l2 2 4-4"/><circle cx="9" cy="7" r="4"/>', standards: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="19" r="2" fill="currentColor"/>' } as Record<string, string>)[name] || ""}</svg>`;
function commit(next: R001State, restoring = false): void {
  saveState(localStorage, next, restoring ? undefined : savedRaw);
  state = next;
  savedRaw = JSON.stringify(next);
}
const selected = () =>
  state.records.find((r) => r.id === selectedId) || state.records[0];
const badge = (record: AuditRecord) =>
  `<span class="badge ${statusClass[record.automatic.status]}">${statusLabel[record.automatic.status]}</span>`;
function humanResult(record: AuditRecord): string {
  const h = record.humanReview;
  if (!h)
    return `<p class="muted">${record.automatic.status === "review_required" ? "等待财务填写原因并复核。" : "此单无需进入人工复核；数据错误需补充后重新审核。"}</p>`;
  return humanReviewCard(h);
}
function recordSelector(reviewOnly = false): string {
  const rows = reviewOnly
    ? state.records.filter((r) => r.automatic.status === "review_required")
    : state.records;
  return `<label class="record-picker">${reviewOnly ? "选择需复核单据（含已处理）" : "选择已审核单据"}<select id="r001-record-select">${rows.map((r) => `<option value="${esc(r.id)}" ${r.id === selectedId ? "selected" : ""}>${esc(r.id)} · ${esc(r.input.employeeName || "资料待补充")} · ${statusLabel[r.automatic.status]}${r.humanReview ? " / " + (r.humanReview.decision === "approved" ? "人工通过" : "人工驳回") : ""}</option>`).join("")}</select></label>`;
}
function entryView(): string {
  const nights = calculateNights(draft.checkIn, draft.checkOut);
  return `<div class="two-columns"><section class="card"><div class="card-heading"><div><h2>填写住宿信息</h2><p>仅支持中国境内、人民币、单城市连续住宿。</p></div><span class="badge neutral">规则 R001</span></div><form id="r001-entry-form" novalidate><label>单据编号<input id="r001-document-id" value="${esc(draft.documentId)}" readonly><small>系统自动生成，执行审核后保留本次输入与结果。</small></label><div class="form-grid"><label>员工姓名 <span class="required">*</span><input name="employeeName" maxlength="40" autocomplete="off" placeholder="请输入虚构员工姓名" value="${esc(draft.employeeName)}"></label><label>员工职级 <span class="required">*</span><select name="grade"><option value="">请选择员工职级</option>${GRADES.map((g) => `<option ${g === draft.grade ? "selected" : ""}>${g}</option>`).join("")}</select></label></div><label>住宿城市 <span class="required">*</span><input name="city" list="r001-city-list" maxlength="40" autocomplete="off" placeholder="选择城市，或输入未配置城市" value="${esc(draft.city)}"><datalist id="r001-city-list">${[...new Set(state.standards.rows.map((r) => r.city))].map((city) => `<option value="${esc(city)}"></option>`).join("")}</datalist><small>可输入未配置城市测试，系统将提示人工复核，不套用其他城市标准。</small></label><div class="form-grid"><label>入住日期 <span class="required">*</span><input name="checkIn" type="date" value="${esc(draft.checkIn)}"></label><label>退房日期 <span class="required">*</span><input name="checkOut" type="date" value="${esc(draft.checkOut)}"></label></div><div class="nights-box"><div><span class="muted">系统计算住宿晚数</span><strong id="r001-nights">${nights === null ? "—" : nights}<small>${nights === null ? "待填写有效日期" : "晚"}</small></strong></div><span class="calendar-symbol" aria-hidden="true">▦</span></div><label>申请报销金额 <span class="required">*</span><div class="currency-input"><span>¥</span><input name="amountYuan" inputmode="decimal" maxlength="40" placeholder="0.00" value="${esc(draft.amountYuan)}"><span>CNY</span></div><small>金额单位为元，最多两位小数；按多晚总金额审核，不逐晚判断。</small></label><div class="form-actions"><button type="button" class="secondary" id="r001-load-t03">载入 T03 超标示例</button><button type="submit" class="primary">执行自动审核 <span aria-hidden="true">→</span></button></div><p class="form-error" id="r001-entry-error" role="alert"></p></form></section><aside class="context-column"><section class="card context-card"><span class="eyebrow">自动审核逻辑</span><h2>让每一笔限额<br>都有计算依据</h2><ol class="logic-list"><li><b>匹配标准</b><span>住宿城市 × 员工职级</span></li><li><b>计算限额</b><span>每晚标准 × 实际住宿晚数</span></li><li><b>识别超标</b><span>申请金额超过限额时转人工复核</span></li></ol><div class="note">缺少标准不自动通过；资料不完整时先补充；0元申请需人工确认。</div></section><section class="card mini-card"><span class="eyebrow">当前模拟制度</span><h3>版本 v${state.standards.version}</h3><p>${new Set(state.standards.rows.map((r) => r.city)).size} 个城市 · ${state.standards.rows.length} 条标准</p><button type="button" class="text-button" data-page="standards">查看城市与职级标准 →</button></section></aside></div>`;
}
function resultDetails(record: AuditRecord): string {
  const a = record.automatic,
    s = a.standardSnapshot;
  const title =
    a.status === "passed"
      ? "申请金额在住宿限额内"
      : a.reasons.includes("over_limit")
        ? "住宿费用超过适用限额"
        : a.reasons.includes("missing_standard")
          ? "未找到适用住宿标准"
          : a.reasons.includes("zero_amount")
            ? "0元申请，请人工确认"
            : a.status === "incomplete"
              ? "请补充必填信息后重新审核"
              : "请修正数据后重新审核";
  return `<section class="status-card ${statusClass[a.status]}" data-testid="auto-result"><div class="status-icon" aria-hidden="true">${a.status === "passed" ? "✓" : "!"}</div><div>${badge(record)}<h2>${title}</h2><p>${esc(record.id)} · ${esc(record.input.employeeName || "姓名未填写")}</p></div><div class="status-amount"><small>${a.excessCents === null ? "超标金额" : "本次超标"}</small><strong data-testid="excess">${a.excessCents === null ? "无法计算" : yuan(a.excessCents)}</strong></div></section>${a.issues.length ? `<section class="card error-card"><h3>待处理的数据问题</h3><ul>${a.issues.map((i) => `<li>${esc(i.message)}</li>`).join("")}</ul><p>未完成本项审核，不输出有效限额或超标结论。请修正以上问题后重新审核。</p></section>` : ""}<section class="card"><div class="card-heading"><div><h2>金额与标准</h2><p>保留本次审核时的标准快照，不随之后的制度修改而变化。</p></div>${s ? `<span class="badge neutral">标准版本 v${s.catalogVersion}</span>` : ""}</div><dl class="result-grid"><div><dt>匹配城市</dt><dd>${esc(s?.city || record.input.city || "未填写")}</dd></div><div><dt>员工职级</dt><dd>${esc(s?.grade || record.input.grade || "未填写")}</dd></div><div><dt>每晚住宿标准</dt><dd data-testid="nightly-rate">${s?.matched ? yuan(s.nightlyRateCents) + " / 晚" : s ? "未配置标准" : "未匹配"}</dd></div><div><dt>住宿晚数</dt><dd>${a.nights === null ? "日期待修正" : a.nights + " 晚"}</dd></div><div><dt>最高报销限额</dt><dd data-testid="limit">${yuan(a.limitCents)}</dd></div><div><dt>申请报销金额</dt><dd data-testid="claimed">${a.amountCents === null ? "金额待修正" : yuan(a.amountCents)}</dd></div></dl><div class="calculation"><span class="eyebrow">计算过程</span>${s?.matched && a.limitCents !== null ? `<p>${yuan(s.nightlyRateCents)} / 晚 × ${a.nights} 晚 ＝ <b>${yuan(a.limitCents)}</b></p><p>超标金额＝max(0，${yuan(a.amountCents)} − ${yuan(a.limitCents)})＝<b>${yuan(a.excessCents)}</b></p>` : `<p>${s && !s.matched ? "城市与职级未匹配标准，最高限额、超标金额均无法计算，不以0元代替。" : "先补充或修正数据，再执行限额计算。"}</p>`}</div><div class="basis"><h3>审核依据</h3><ul><li>R001 v1：以单城市连续住宿总金额与总限额比较，相等时通过本项。</li><li>入住 ${esc(record.input.checkIn || "未填写")}，退房 ${esc(record.input.checkOut || "未填写")}；退房日不计住宿晚数。</li>${s ? `<li>本次查询：${esc(s.city)} × ${esc(s.grade)}；${s.matched ? "标准编号 " + esc(s.standardId) : "未匹配标准（需人工复核）"}。</li>` : ""}${a.reasons.includes("zero_amount") ? '<li class="zero-warning">金额为0，请财务确认；0元不判为超标。</li>' : ""}<li>本项通过只代表住宿金额规则通过，不代表整单审批通过、发票验真或付款。</li></ul><small>自动审核时间：${esc(new Date(record.auditedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }))}（上海）</small></div></section>`;
}
function resultsView(): string {
  const r = selected();
  if (!r)
    return '<section class="card empty-state"><h2>还没有审核记录</h2><button class="primary" data-page="entry">录入第一笔住宿报销</button></section>';
  return `${recordSelector()}${resultDetails(r)}<section class="card"><div class="card-heading"><div><h2>人工复核结果</h2><p>人工结论独立留存，自动结果保持原样。</p></div></div>${humanResult(r)}<div class="form-actions">${r.automatic.status === "review_required" && !r.humanReview ? '<button class="primary" data-page="review">进入人工复核 →</button>' : ""}<button class="secondary" id="r001-copy">复制为新单重新审核</button></div></section>`;
}
function reviewView(): string {
  const candidates = state.records.filter(
    (r) => r.automatic.status === "review_required",
  );
  const r = candidates.find((r) => r.id === selectedId) || candidates[0];
  if (!r)
    return '<section class="card empty-state"><div class="empty-check">✓</div><h2>暂无需要人工复核的单据</h2><p>金额超标、标准缺失或0元待确认的单据会出现在这里。</p><button class="secondary" data-page="results">查看自动审核结果</button></section>';
  selectedId = r.id;
  return `${recordSelector(true)}${resultDetails(r)}<section class="card"><div class="card-heading"><div><h2>财务复核意见</h2><p>请结合实际制度人工判断，通过和驳回均需填写原因。</p></div><span class="badge neutral">演示财务</span></div>${r.humanReview ? humanResult(r) : `<form id="r001-review-form" novalidate><label>复核原因 <span class="required">*</span><textarea name="reason" rows="4" maxlength="500" placeholder="例如：经核对，展会期间住宿涨价，批准本次例外。或：超出公司标准，请调整金额后重提。"></textarea></label><div class="note">两种操作均会保留原始自动审核结论、复核原因及操作时间。本原型不执行付款。</div><div class="form-actions"><button class="danger-button" name="decision" value="rejected" type="submit">人工驳回</button><button class="primary" name="decision" value="approved" type="submit">人工通过</button></div><p id="r001-review-error" class="form-error" role="alert"></p></form>`}</section>`;
}
function standardsView(): string {
  return `<div class="notice">模拟制度，仅用于作品演示。单位：人民币元/晚。保存后下一次审核使用新标准，历史审核保留原快照。</div><section class="card"><div class="card-heading"><div><h2>城市 × 员工职级</h2><p>当前制度版本 v${state.standards.version} · 共 ${state.standards.rows.length} 条标准</p></div><span class="badge neutral">可编辑模拟标准</span></div><div class="table-scroll"><table><thead><tr><th>住宿城市</th><th>员工职级</th><th>住宿标准（元/晚）</th><th>操作</th></tr></thead><tbody>${state.standards.rows.map((r) => `<tr><td><b>${esc(r.city)}</b></td><td>${esc(r.grade)}</td><td class="numeric">${centsToYuan(r.nightlyRateCents)}</td><td><button class="text-button" data-edit-standard="${esc(r.id)}">修改</button></td></tr>`).join("")}</tbody></table></div></section><section class="card"><div class="card-heading"><div><h2>增加 / 修改模拟标准</h2><p>同一城市、同一职级保存为修改；未配置的组合将新增。</p></div></div><form id="r001-standard-form" novalidate><div class="form-grid three"><label>城市 <span class="required">*</span><input name="city" maxlength="40" placeholder="例如：深圳"></label><label>员工职级 <span class="required">*</span><select name="grade">${GRADES.map((g) => `<option>${g}</option>`).join("")}</select></label><label>每晚标准（元） <span class="required">*</span><input name="nightlyYuan" inputmode="decimal" maxlength="40" placeholder="例如：500.00"></label></div><div class="form-actions"><button class="secondary" type="reset">清空填写</button><button class="primary" type="submit">保存模拟标准</button></div><p class="form-error" id="r001-standard-error" role="alert"></p></form></section>`;
}
function render(): void {
  root.innerHTML = `<div class="r001-layout"><aside class="sidebar"><a class="brand" href="./r001.html"><span class="brand-mark">轻</span><span>轻报<small>智能费用审核</small></span></a><div class="scope-tag">R001 · 住宿费超标审核</div>${ruleLinks("R001")}<p class="nav-label">审核工作空间</p><nav>${(Object.keys(labels) as Page[]).map((p) => `<button data-page="${p}" class="nav-button ${p === page ? "active" : ""}">${icon(p)}<span>${labels[p][1]}</span>${p === "review" && healthy ? `<em>${state.records.filter((r) => r.automatic.status === "review_required" && !r.humanReview).length}</em>` : ""}</button>`).join("")}</nav><div class="sidebar-footer"><span class="local-dot"></span> 模拟数据 · 本浏览器保存<p>不连接公司正式系统</p><button class="reset-button" id="r001-reset">恢复 R001 模拟数据</button></div></aside><div class="main-shell"><header><div class="breadcrumb">费用审核 <span>/</span> R001</div><div class="operator"><span class="demo-pill">原型 v1</span><span class="operator-avatar">财</span><span>财务审核员<small>模拟身份</small></span></div></header><main><div class="page-title"><div><span class="eyebrow">LODGING EXPENSE REVIEW · ${labels[page][0]}</span><h1>${labels[page][1]}</h1><p>${labels[page][2]}</p></div>${page !== "entry" ? '<button class="secondary" id="r001-new">＋ 新建住宿报销</button>' : ""}</div>${message ? `<div class="feedback" role="status">${esc(message)}</div>` : ""}${healthy ? { entry: entryView, results: resultsView, review: reviewView, standards: standardsView }[page]() : `<section class="card error-card"><h2>本地数据需要处理</h2><p>${esc(loaded.ok ? "数据异常，请恢复R001模拟数据" : loaded.message)}</p><button class="primary" id="r001-recover">恢复 R001 模拟数据</button></section>`}<footer>仅支持中国境内 · 人民币 · 单城市连续住宿　|　请使用虚构资料</footer></main></div></div>`;
  bind();
}
function navigate(next: Page): void {
  const dirty =
    root.querySelector<HTMLFormElement>(
      "#r001-standard-form, #r001-review-form",
    )?.dataset.dirty === "true";
  if (dirty && !confirm("本次填写尚未保存，是否放弃并切换？")) return;
  page = next;
  message = "";
  render();
  window.scrollTo({ top: 0 });
}
function restoreExamples(): void {
  if (
    !confirm(
      "恢复R001模拟数据将替换本模块的住宿标准、审核单据和人工复核记录。轻报其他模块的数据不受影响。是否继续？",
    )
  )
    return;
  try {
    commit(createExampleState(), true);
    healthy = true;
    draft = emptyInput();
    selectedId = state.records[0]!.id;
    page = "entry";
    message = "已恢复15条模拟住宿标准和2笔示例审核，仅替换R001数据。";
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
  root.querySelector<HTMLButtonElement>("#r001-reset")!.onclick =
    restoreExamples;
  root
    .querySelector<HTMLButtonElement>("#r001-recover")
    ?.addEventListener("click", restoreExamples);
  root
    .querySelector<HTMLButtonElement>("#r001-new")
    ?.addEventListener("click", () => {
      draft = emptyInput();
      navigate("entry");
    });
  root
    .querySelector<HTMLButtonElement>("#r001-load-t03")
    ?.addEventListener("click", () => {
      draft = t03Input(draft.documentId);
      message = "已载入T03：深圳、普通员工、3晚、1800元。点击执行自动审核。";
      render();
    });
  const entry = root.querySelector<HTMLFormElement>("#r001-entry-form");
  if (entry) {
    const collect = (): LodgingInput =>
      ({
        documentId: draft.documentId,
        ...Object.fromEntries(
          [
            "employeeName",
            "grade",
            "city",
            "checkIn",
            "checkOut",
            "amountYuan",
          ].map((k) => [
            k,
            (entry.elements.namedItem(k) as HTMLInputElement).value,
          ]),
        ),
      }) as LodgingInput;
    entry.oninput = () => {
      draft = collect();
      const nights = calculateNights(draft.checkIn, draft.checkOut);
      root.querySelector("#r001-nights")!.innerHTML =
        nights === null
          ? "—<small>待填写有效日期</small>"
          : `${nights}<small>晚</small>`;
    };
    entry.onsubmit = (e) => {
      e.preventDefault();
      try {
        draft = collect();
        const record = makeRecord(draft, state.standards, now());
        commit(appendRecord(state, record));
        selectedId = record.id;
        page = "results";
        message = "本次自动审核已保存，原始结果独立留存。";
        render();
        window.scrollTo({ top: 0 });
      } catch (error) {
        root.querySelector("#r001-entry-error")!.textContent = (
          error as Error
        ).message;
      }
    };
  }
  root
    .querySelector<HTMLSelectElement>("#r001-record-select")
    ?.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      const previous = selectedId;
      if (
        root.querySelector<HTMLFormElement>("#r001-review-form")?.dataset
          .dirty === "true" &&
        !confirm("复核原因尚未保存，是否放弃并切换单据？")
      ) {
        select.value = previous;
        return;
      }
      selectedId = select.value;
      message = "";
      render();
    });
  root
    .querySelector<HTMLButtonElement>("#r001-copy")
    ?.addEventListener("click", () => {
      const r = selected();
      if (!r) return;
      draft = { ...r.input, documentId: newId() };
      navigate("entry");
    });
  const review = root.querySelector<HTMLFormElement>("#r001-review-form");
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
        const record = reviewRecord(
          selected()!,
          decision,
          (review.elements.namedItem("reason") as HTMLTextAreaElement).value,
          "演示财务",
          now(),
        );
        commit(replaceRecord(state, record));
        review.dataset.dirty = "false";
        message =
          decision === "approved"
            ? "已记录人工通过，原始自动审核结果未覆盖。"
            : "已记录人工驳回，原始自动审核结果未覆盖。";
        render();
      } catch (error) {
        root.querySelector("#r001-review-error")!.textContent = (
          error as Error
        ).message;
      }
    };
  }
  const standard = root.querySelector<HTMLFormElement>("#r001-standard-form");
  if (standard) {
    standard.oninput = () => {
      standard.dataset.dirty = "true";
    };
    standard.onreset = () => {
      standard.dataset.dirty = "false";
      root.querySelector("#r001-standard-error")!.textContent = "";
    };
    root.querySelectorAll<HTMLButtonElement>("[data-edit-standard]").forEach(
      (b) =>
        (b.onclick = () => {
          if (
            standard.dataset.dirty === "true" &&
            !confirm("标准填写尚未保存，是否放弃并载入这条标准？")
          )
            return;
          const row = state.standards.rows.find(
            (r) => r.id === b.dataset.editStandard,
          )!;
          (standard.elements.namedItem("city") as HTMLInputElement).value =
            row.city;
          (standard.elements.namedItem("grade") as HTMLSelectElement).value =
            row.grade;
          (
            standard.elements.namedItem("nightlyYuan") as HTMLInputElement
          ).value = centsToYuan(row.nightlyRateCents);
          standard.dataset.dirty = "false";
          standard.scrollIntoView({ behavior: "smooth", block: "center" });
        }),
    );
    standard.onsubmit = (e) => {
      e.preventDefault();
      try {
        const data = new FormData(standard);
        commit(
          upsertStandard(
            state,
            String(data.get("city")),
            String(data.get("grade")),
            String(data.get("nightlyYuan")),
            `STD-${crypto.randomUUID()}`,
            now(),
          ),
        );
        standard.dataset.dirty = "false";
        message = `模拟标准已保存为v${state.standards.version}。下一次审核使用新标准，历史结果不变。`;
        render();
      } catch (error) {
        root.querySelector("#r001-standard-error")!.textContent = (
          error as Error
        ).message;
      }
    };
  }
}
window.addEventListener("beforeunload", (e) => {
  if (
    root.querySelector<HTMLFormElement>(
      "#r001-standard-form, #r001-review-form",
    )?.dataset.dirty === "true"
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
render();
