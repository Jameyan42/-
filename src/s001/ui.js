import { current, load, save, saveDraft, execute, review } from "./model.ts";
import { registry } from "./rules.ts";
import { loadState } from "../r001/model";
import { loadR002, historyForAudit } from "../r002/invoiceRepository";
import { calculateNights } from "../r001/rule";
import {
  escapeHtml as esc,
  formatYuan as yuan,
  displayTime,
} from "../shared/audit-ui";
import { parseYuan } from "../r001/rule";
import { startRecognition } from "../ocr.js";
import { readAttachment, validateAttachments } from "../attachments.js";
import "../s001/style.css";
export const unifiedPages = ["报销单管理", "财务审核", "审核历史", "审核规则"];
let mountedPage = "",
  dirty = false,
  job = null,
  view = "list",
  draft = null,
  selected = "",
  batch = "",
  search = "",
  filter = "";
export function resetUnifiedNavigation() {
  mountedPage = "";
}
export function canLeaveUnified() {
  return !dirty || confirm("统一报销表单或复核意见尚未保存，是否放弃？");
}
export function disposeUnified() {
  job?.cancel();
  job = null;
  dirty = false;
}
const statuses = [
  "草稿",
  "审核失败",
  "待人工复核",
  "规则检查通过（待财务确认）",
  "已通过",
  "已驳回",
];
const labels = {
  PASS: "通过",
  REVIEW: "需要人工复核",
  BLOCK: "拦截",
  INSUFFICIENT_DATA: "信息不足",
  NOT_APPLICABLE: "不适用",
  ERROR: "执行失败",
};
const moneyText = (v) => {
  const n = parseYuan(v);
  return n.ok ? yuan(n.cents) : "未有效填写";
};
const fresh = () => ({
  id: "BX-S001-" + crypto.randomUUID(),
  employee: "",
  grade: "普通员工",
  department: "",
  expenseType: "住宿费",
  amountYuan: "",
  currency: "CNY",
  city: "",
  checkIn: "",
  checkOut: "",
  hotel: "",
  hotelAmountYuan: "",
  partialReason: "",
  invoices: [],
});
const invoice = () => ({
  id: crypto.randomUUID(),
  type: "数电发票",
  code: "",
  number: "",
  amountYuan: "",
  currency: "CNY",
  date: "",
  sellerName: "",
  buyerName: "",
  sellerTaxId: "",
  buyerTaxId: "",
  source: "manual",
});
const input = (name, label, value, type = "text") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
const select = (name, label, options, value) =>
  `<label>${label}<select name="${name}">${options.map((x) => `<option ${x === value ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>`;
function duplicateEvidence(r) {
  if (r.ruleId !== "R002" || !Array.isArray(r.evidence)) return "";
  const matches = r.evidence.flatMap((x) => x.matches || []);
  return matches.length
    ? `<div class="table-wrap"><table><thead><tr><th>关联单号 / 人员</th><th>票号 / 金额</th><th>历史状态 / 匹配依据</th></tr></thead><tbody>${matches.map((m) => `<tr><td>${esc(m.historical.documentId.split("::")[0])}<small>${esc(m.historical.employeeName)}</small></td><td>${esc(m.historical.invoice.number)}<small>${yuan(m.historical.invoice.amountCents)}</small></td><td>${esc(m.historical.businessStatus)}<small>${esc(m.reason)}；${esc(m.statusExplanation)}</small></td></tr>`).join("")}</tbody></table></div>`
    : "";
}
export function unifiedView() {
  return '<div id="s001-root" class="s001"></div>';
}
export function mountUnified({ page, actor, legacy, openLegacy }) {
  const root = document.querySelector("#s001-root");
  if (!root) return;
  let state,
    raw,
    broken = "",
    message = "";
  try {
    ({ state, raw } = load(localStorage));
    for (const d of state.claims)
      validateAttachments(
        d.input.invoices.flatMap((i) => (i.attachment ? [i.attachment] : [])),
      );
  } catch (err) {
    broken = String(err);
  }
  if (page !== mountedPage) {
    view =
      page === "审核历史" ? "history" : page === "审核规则" ? "rules" : "list";
    mountedPage = page;
  }
  const persist = (next) => {
    save(localStorage, next, raw);
    state = next;
    raw = JSON.stringify(next);
    dirty = false;
  };
  const go = (next) => {
    if (!canLeaveUnified()) return;
    dirty = false;
    view = next;
    message = "";
    render();
  };
  const getDoc = () =>
    state.claims.find((d) => d.id === selected) || state.claims[0];
  const collect = () => {
    const f = root.querySelector("#s001-form");
    if (!f) return;
    const data = Object.fromEntries(new FormData(f));
    for (const key of Object.keys(draft))
      if (key !== "invoices" && key !== "id" && data[key] !== undefined)
        draft[key] = data[key];
    root.querySelectorAll("[data-invoice]").forEach((row) => {
      const i = draft.invoices.find((i) => i.id === row.dataset.invoice);
      row
        .querySelectorAll("[data-field]")
        .forEach((x) => (i[x.dataset.field] = x.value));
    });
  };
  function list() {
    const query = search.trim().toLowerCase(),
      rows = state.claims.filter(
        (d) =>
          (!filter || d.status === filter) &&
          [d.id, d.input.employee, d.status]
            .join(" ")
            .toLowerCase()
            .includes(query),
      );
    const old =
      page === "财务审核"
        ? []
        : legacy.filter(
            (d) =>
              (!filter || d.status === filter) &&
              [d.id, d.employee, d.status]
                .join(" ")
                .toLowerCase()
                .includes(query),
          );
    return `<section class="panel"><div class="panel-title"><h3>统一报销单</h3><button id="s001-new" class="primary">新建报销单</button></div><p>一张报销单，一次执行所有适用规则；自动通过后仍需财务确认。人民币演示，不执行付款。</p><div class="toolbar"><input id="s001-search" aria-label="搜索统一报销" placeholder="单号、报销人或状态" value="${esc(search)}"><select id="s001-filter"><option value="">全部状态</option>${statuses.map((x) => `<option ${x === filter ? "selected" : ""}>${x}</option>`).join("")}</select></div><div class="table-wrap"><table><thead><tr><th>编号 / 报销人</th><th>类型</th><th>金额</th><th>创建时间</th><th>业务状态</th><th>操作</th></tr></thead><tbody>${rows.map((d) => `<tr><td>${esc(d.id)}<small>${esc(d.input.employee || "未填姓名")}</small></td><td>${d.input.expenseType}</td><td>${moneyText(d.input.amountYuan)}</td><td>${esc(displayTime(d.createdAt))}</td><td>${d.status}</td><td><button data-detail-s001="${esc(d.id)}">审核详情</button> <button data-edit-s001="${esc(d.id)}">编辑</button></td></tr>`).join("")}${old.map((d) => `<tr class="s001-legacy"><td>${esc(d.id)}<small>${esc(d.employee)}</small></td><td>${esc(d.type)}<small>原流程历史单</small></td><td>${yuan(Math.round(d.amount * 100))}</td><td>${esc(d.date)}</td><td>${esc(d.status)}<small>未执行统一规则</small></td><td><button data-legacy="${esc(d.id)}">查看原流程</button></td></tr>`).join("")}</tbody></table></div><p class="footnote">旧单保留原审批路径及数据，不伪造迁移或追补审核。统一流程使用新报销对象，旧系统预算/付款不自动承接本期单据。</p></section>`;
  }
  function form() {
    return `<section class="panel"><h3>创建及编辑报销单</h3><p>${esc(draft.id)}</p><form id="s001-form" novalidate><div class="form-grid">${input("employee", "报销人", draft.employee)}${input("department", "所属部门", draft.department)}${select("grade", "员工职级", ["普通员工", "部门经理", "高级管理人员"], draft.grade)}${select("expenseType", "费用类型", ["住宿费", "其他费用"], draft.expenseType)}${input("amountYuan", "申请报销金额（元）", draft.amountYuan)}${select("currency", "报销币种", ["CNY"], draft.currency)}</div>${draft.expenseType === "住宿费" ? `<h4>住宿费用</h4><div class="form-grid">${input("city", "出差城市", draft.city)}${input("hotel", "酒店名称", draft.hotel)}${input("checkIn", "入住日期", draft.checkIn, "date")}${input("checkOut", "退房日期", draft.checkOut, "date")}${input("hotelAmountYuan", "住宿金额（元）", draft.hotelAmountYuan)}</div><p id="s001-nights">住宿晚数：${calculateNights(draft.checkIn, draft.checkOut) ?? "待有效日期"}</p>` : ""}${input("partialReason", "部分报销原因（适用时）", draft.partialReason)}<h4>关联发票（最多5张）</h4>${draft.invoices
      .map(
        (i, k) =>
          `<fieldset data-invoice="${i.id}"><legend>发票 ${k + 1} · ${i.source === "ocr-assisted" ? "OCR辅助后待核对" : "手工录入"}</legend><div class="form-grid">${[
            [
              "type",
              "发票类型",
              [
                "数电发票",
                "增值税电子普通发票",
                "增值税电子专用发票",
                "纸质发票",
                "其他",
              ],
            ],
            ["code", "发票代码"],
            ["number", "发票号码"],
            ["amountYuan", "发票金额（元）"],
            ["currency", "发票币种", ["CNY", "USD", "EUR"]],
            ["date", "开票日期"],
            ["sellerName", "销售方名称"],
            ["buyerName", "购买方名称"],
            ["sellerTaxId", "销售方税号"],
            ["buyerTaxId", "购买方税号"],
          ]
            .map(
              ([name, label, opts]) =>
                `<label>${label}${opts ? `<select data-field="${name}">${opts.map((o) => `<option ${o === i[name] ? "selected" : ""}>${o}</option>`).join("")}</select>` : `<input data-field="${name}" ${name === "date" ? 'type="date"' : ""} value="${esc(i[name])}">`}</label>`,
            )
            .join(
              "",
            )}</div><label>发票原件（可选，单份1MB）<input type="file" data-file="${i.id}" accept=".png,.jpg,.jpeg,.webp,.pdf"></label><small>${esc(i.attachment?.name || "未保留原件")}</small><label>PDF识别页码<input type="number" data-pdf-page="${i.id}" min="1" max="20" value="1"></label><button type="button" data-ocr="${i.id}">复用现有OCR识别原件</button> <button type="button" data-remove-invoice="${i.id}">移除此票</button><p>OCR仅提供候选，请对照原件核对；未识别不代表0元。币种不匹配时不得比较。</p></fieldset>`,
      )
      .join(
        "",
      )}<button type="button" id="s001-add-invoice">添加发票</button><p>每单原件合计1.5MB以内。未填写金额可保存草稿，审核时明确提示资料不足。</p><div class="enterprise-buttons"><button type="button" id="s001-draft">保存草稿</button><button class="primary" type="submit">开始自动审核</button><button type="button" id="s001-example">载入正常模拟案例</button></div><p id="s001-error" role="alert"></p></form></section>`;
  }
  function detail(history = false) {
    const d = getDoc();
    if (!d) return '<section class="panel">暂无审核记录。</section>';
    selected = d.id;
    const b =
      (history ? d.batches.find((x) => x.id === batch) : current(d)) ||
      (history ? d.batches.at(-1) : null);
    if (history && b) batch = b.id;
    const invalidated = b && b.revision !== d.revision;
    return `<section class="panel"><h3>${esc(d.id)} · ${esc((b?.input || d.input).employee)}</h3><p data-testid="s001-business">${d.status}</p><p>申请金额 ${moneyText((b?.input || d.input).amountYuan)} · ${esc((b?.input || d.input).department)} · 提交时间 ${esc(d.submittedAt ? displayTime(d.submittedAt) : "未提交")}</p>${!current(d) ? '<p class="risk">当前审核未执行或已失效，必须重新审核；旧批准不可沿用。</p>' : ""}${history ? `<label>审核批次<select id="s001-batch">${d.batches.map((x) => `<option value="${x.id}" ${x.id === b?.id ? "selected" : ""}>v${x.version} · ${x.id} · ${displayTime(x.at)}</option>`).join("")}</select></label>` : ""}<button data-edit-s001="${d.id}">编辑 / 重新审核</button> <button id="s001-history">查看审核历史</button></section>${b ? `<section class="panel"><h3>统一审核报告 · v${b.version}</h3><p>批次 ${esc(b.id)} · ${esc(displayTime(b.at))} · 风险规则数 ${b.results.filter((r) => ["REVIEW", "BLOCK", "INSUFFICIENT_DATA", "ERROR"].includes(r.status)).length}${invalidated ? " · 历史结果已失效（仅留证）" : ""}</p>${b.results.map((r) => `<details open class="s001-rule ${r.status}" data-rule-key="${r.ruleKey}"><summary>${r.ruleId} ${r.ruleName}：<b>${labels[r.status]}</b></summary><p>风险等级：${({none:"无风险",low:"低",medium:"中",high:"高"})[r.severity]} · ${esc(r.message)}</p>${r.ruleId === "R001" && r.evidence?.limitCents !== undefined ? `<p>限额 ${yuan(r.evidence.limitCents)} · 超标 ${yuan(r.evidence.excessCents)}</p>` : ""}${duplicateEvidence(r)}${r.ruleId === "R003" && r.evidence?.amountCents !== undefined ? `<p>报销金额 ${yuan(r.evidence.amountCents)} · 发票合计 ${yuan(r.evidence.invoiceTotalCents)} · 差异 ${yuan(Math.abs(r.evidence.differenceCents))} · 原因 ${esc(r.evidence.partialReason || "未填写")}</p>` : ""}<p>建议：${esc(r.suggestedAction)}</p><details><summary>审核依据及证据快照</summary><pre>${esc(JSON.stringify(r.evidence, null, 2))}</pre></details></details>`).join("")}</section><section class="panel"><h3>财务最终复核</h3>${b.review ? `<div data-testid="s001-review"><b>${b.review.decision === "approved" ? "财务复核通过" : "财务复核驳回"}</b><p>${esc(b.review.reason)}</p><p>${esc(b.review.reviewer)} · ${esc(displayTime(b.review.at))}</p></div>` : !history && current(d)?.id === b.id ? `<form id="s001-review-form">${input("reviewer", "财务人员", actor?.role === "财务" ? actor.name : "")}<label>复核意见（必填）<textarea name="reason" maxlength="500"></textarea></label><button value="approved" class="primary" ${actor?.role !== "财务" ? "disabled" : ""}>财务复核通过</button> <button value="rejected" ${actor?.role !== "财务" ? "disabled" : ""}>财务复核驳回</button><p>需切换为财务角色。BLOCK、信息不足和ERROR禁止普通通过，本期不提供例外授权。REVIEW经核查并填写意见可批准。</p><p id="s001-review-error" role="alert"></p></form>` : "<p>历史批次只读。</p>"}</section>` : ""}`;
  }
  function historyList() {
    return `<section class="panel"><h3>审核记录</h3><div class="table-wrap"><table><thead><tr><th>单号 / 批次</th><th>时间</th><th>各规则</th><th>财务处理</th><th>操作</th></tr></thead><tbody>${state.claims.flatMap((d) => d.batches.map((b) => `<tr><td>${esc(d.id)}<small>v${b.version} / ${esc(b.id)}</small></td><td>${esc(displayTime(b.at))}</td><td>${b.results.map((r) => `${r.ruleId} ${labels[r.status]}`).join("<br>")}</td><td>${b.review ? `${b.review.decision === "approved" ? "已通过" : "已驳回"}<small>${esc(b.review.reason)} / ${esc(displayTime(b.review.at))}</small>` : "未复核"}${b.revision !== d.revision ? "<small>资料修改，旧批次失效</small>" : ""}</td><td><button data-history-doc="${d.id}" data-batch="${b.id}">查看</button></td></tr>`)).join("")}</tbody></table></div></section>`;
  }
  function render() {
    root.innerHTML = `${message ? `<p class="review-box" role="status">${esc(message)}</p>` : ""}${broken ? `<section class="panel"><h3>本地数据无法安全读取</h3><p>${esc(broken)}</p><p>已暂停保存，不清除或用种子覆盖原值。</p></section>` : view === "form" ? form() : view === "detail" ? detail() : view === "history-detail" ? detail(true) : view === "history" ? historyList() : view === "rules" ? `<section class="panel"><h3>已启用审核规则</h3>${registry.map((r) => `<p>${r.ruleId} ${r.ruleName} · ${r.ruleKey}</p>`).join("")}<p>原合同付款R003保留在旧独立入口，金额规则使用invoice.amount-support内部标识，不覆盖合同数据。</p><p>R001读取独立标准；R002保留独立历史库并增加统一流程已审核单。旧主应用票据尚未自动联查。规则通过仅检查通过，财务需最终确认。</p></section>` : list()}`;
    bind();
  }
  function mutate(action, target = "#s001-error") {
    try {
      action();
    } catch (err) {
      const el = root.querySelector(target);
      if (el) el.textContent = String(err);
      else {
        message = String(err);
        render();
      }
    }
  }
  function persistDraft(run) {
    if (job) throw Error("OCR正在处理，请等待完成或离开表单取消后再提交");
    collect();
    validateAttachments(
      draft.invoices.flatMap((i) => (i.attachment ? [i.attachment] : [])),
    );
    const latest = load(localStorage);
    if (
      JSON.stringify(latest.state.claims.find((d) => d.id === draft.id)) !==
      JSON.stringify(state.claims.find((d) => d.id === draft.id))
    )
      throw Error("单据已变化，请刷新，不覆盖新版本");
    raw = latest.raw;
    let next = saveDraft(latest.state, draft, new Date().toISOString());
    if (run) {
      if (!draft.employee.trim() || !draft.department.trim())
        throw Error("请填写报销人和部门");
      const r1 = loadState(localStorage),
        r2 = loadR002(localStorage);
      next = execute(
        next,
        draft.id,
        {
          at: new Date().toISOString(),
          standards: r1.ok ? r1.state.standards : null,
          invoiceHistory: r2.ok ? historyForAudit(r2.state) : null,
        },
        crypto.randomUUID(),
      );
    }
    persist(next);
    selected = draft.id;
    view = run ? "detail" : "list";
    draft = null;
    message = run
      ? "统一审核已保存；请查看每条规则及财务确认要求。"
      : "草稿已保存，历史记录保留。";
    render();
  }
  function bind() {
    if (broken) return;
    root
      .querySelectorAll("form")
      .forEach((f) => (f.oninput = () => (dirty = true)));
    root.querySelector("#s001-new")?.addEventListener("click", () => {
      if (!canLeaveUnified()) return;
      dirty = false;
      draft = fresh();
      view = "form";
      render();
    });
    root.querySelector("#s001-search")?.addEventListener("input", (e) => {
      search = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const q = root.querySelector("#s001-search");
      q.focus();
      q.setSelectionRange(pos, pos);
    });
    root.querySelector("#s001-filter")?.addEventListener("change", (e) => {
      filter = e.target.value;
      render();
    });
    root.querySelectorAll("[data-detail-s001]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = b.dataset.detailS001;
          go("detail");
        }),
    );
    root.querySelectorAll("[data-edit-s001]").forEach(
      (b) =>
        (b.onclick = () => {
          if (!canLeaveUnified()) return;
          draft = structuredClone(
            state.claims.find((d) => d.id === b.dataset.editS001).input,
          );
          dirty = false;
          view = "form";
          render();
        }),
    );
    root
      .querySelectorAll("[data-legacy]")
      .forEach((b) => (b.onclick = () => openLegacy(b.dataset.legacy)));
    root.querySelectorAll("[data-history-doc]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = b.dataset.historyDoc;
          batch = b.dataset.batch;
          go("history-detail");
        }),
    );
    root.querySelector("#s001-batch")?.addEventListener("change", (e) => {
      batch = e.target.value;
      render();
    });
    root
      .querySelector("#s001-history")
      ?.addEventListener("click", () => go("history-detail"));
    root.querySelector("#s001-add-invoice")?.addEventListener("click", () =>
      mutate(() => {
        collect();
        if (draft.invoices.length >= 5) throw Error("最多5张发票");
        draft.invoices.push(invoice());
        render();
        dirty = true;
      }),
    );
    root.querySelectorAll("[data-remove-invoice]").forEach(
      (b) =>
        (b.onclick = () => {
          collect();
          draft.invoices = draft.invoices.filter(
            (i) => i.id !== b.dataset.removeInvoice,
          );
          render();
          dirty = true;
        }),
    );
    root.querySelector("[name=expenseType]")?.addEventListener("change", () => {
      collect();
      render();
      dirty = true;
    });
    for (const n of ["checkIn", "checkOut"])
      root.querySelector(`[name=${n}]`)?.addEventListener("input", () => {
        collect();
        root.querySelector("#s001-nights").textContent =
          "住宿晚数：" +
          (calculateNights(draft.checkIn, draft.checkOut) ?? "待有效日期");
      });
    root.querySelectorAll("[data-file]").forEach(
      (f) =>
        (f.onchange = async () => {
          try {
            collect();
            const file = f.files[0];
            if (!file) return;
            const editingId = draft.id;
            const item = await readAttachment(file, "发票");
            if (!root.isConnected || draft?.id !== editingId) return;
            const i = draft.invoices.find((i) => i.id === f.dataset.file);
            validateAttachments([
              ...draft.invoices
                .filter((x) => x.id !== i.id)
                .flatMap((x) => (x.attachment ? [x.attachment] : [])),
              item,
            ]);
            i.attachment = item;
            render();
            dirty = true;
          } catch (err) {
            job = null;
            if (root.isConnected)
              root.querySelector("#s001-error").textContent = String(err);
          }
        }),
    );
    root.querySelectorAll("[data-ocr]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            collect();
            const i = draft.invoices.find((i) => i.id === b.dataset.ocr);
            if (!i.attachment) throw Error("请先保留发票原件");
            const binary = atob(i.attachment.data.split(",")[1]),
              bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
            const file = new File([bytes], i.attachment.name, {
                type: i.attachment.type,
              }),
              pdfPage = Number(
                root.querySelector(`[data-pdf-page="${i.id}"]`).value,
              );
            job?.cancel();
            job = startRecognition(file, () => {}, {
              rotation: 0,
              crop: { left: 0, right: 0, top: 0, bottom: 0 },
              pdfPage,
            });
            message = "OCR识别中，请稍候，结果需人工核对。";
            root.querySelector("#s001-error").textContent = message;
            const r = await job.promise;
            job = null;
            if (!root.isConnected) return;
            const map = {
              number: "number",
              code: "code",
              date: "date",
              buyerName: "buyerName",
              sellerName: "sellerName",
              buyerTaxId: "buyerTaxId",
              sellerTaxId: "sellerTaxId",
              amount: "amountYuan",
            };
            for (const [from, to] of Object.entries(map))
              if (r.structured?.[from]) i[to] = r.structured[from];
            i.source = "ocr-assisted";
            message = "OCR候选已填入，请逐字段核对后再保存或提交。";
            dirty = true;
            render();
          } catch (err) {
            job = null;
            if (root.isConnected)
              root.querySelector("#s001-error").textContent = String(err);
          }
        }),
    );
    root
      .querySelector("#s001-draft")
      ?.addEventListener("click", () => mutate(() => persistDraft(false)));
    root.querySelector("#s001-form")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      mutate(() => persistDraft(true));
    });
    root.querySelector("#s001-example")?.addEventListener("click", () => {
      const d = fresh();
      draft = {
        ...d,
        employee: "李四（模拟）",
        department: "财务部",
        grade: "普通员工",
        city: "深圳",
        checkIn: "2026-10-20",
        checkOut: "2026-10-22",
        hotel: "模拟酒店",
        hotelAmountYuan: "600",
        amountYuan: "600",
        invoices: [
          {
            ...invoice(),
            number: "9900" + Date.now(),
            amountYuan: "600",
            date: "2026-10-22",
            sellerName: "模拟酒店",
            buyerName: "模拟企业",
          },
        ],
      };
      dirty = true;
      render();
    });
    root
      .querySelector("#s001-review-form")
      ?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        mutate(() => {
          if (actor?.role !== "财务") throw Error("请切换财务模拟身份");
          const values = Object.fromEntries(new FormData(ev.currentTarget));
          const latest = load(localStorage);
          raw = latest.raw;
          persist(
            review(
              latest.state,
              selected,
              current(state.claims.find((d) => d.id === selected)).id,
              ev.submitter.value,
              values.reason,
              values.reviewer,
              new Date().toISOString(),
            ),
          );
          message = "财务结论已独立保存，自动审核结果未覆盖。";
          render();
        }, "#s001-review-error");
      });
  }
  render();
  return {
    create: () => {
      if (!canLeaveUnified()) return;
      draft = fresh();
      dirty = false;
      view = "form";
      render();
    },
  };
}
