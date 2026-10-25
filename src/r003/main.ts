import "../r001/style.css";
import "../shared/rule-links.css";
import "./style.css";
import {
  escapeHtml as e,
  formatYuan as yuan,
  humanReviewCard,
  ruleLinks,
  displayTime,
} from "../shared/audit-ui";
import { centsToYuan, parseYuan } from "../r001/rule";
import { KEY, load, save, append, review, restore } from "./contractRepository";
import type {
  Application,
  State,
  Contract,
  Payment,
  Version,
} from "./contractTypes";
const root = document.querySelector<HTMLDivElement>("#r003-app")!;
const today = () =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
  now = () => new Date().toISOString(),
  uuid = () => crypto.randomUUID();
const fresh = (): Application => ({
  id: "FK-R003-" + uuid(),
  applicant: "",
  department: "",
  contractId: "HT-002",
  stageId: "S2",
  amountYuan: "",
  date: today(),
  remark: "",
});
let state: State,
  raw: string | null = null,
  broken = "",
  page = "entry",
  message = "",
  draft = fresh(),
  selected = "",
  version = "",
  editContract = "",
  editPayment = "";
try {
  ({ state, raw } = load(localStorage, today()));
} catch (err) {
  broken = String(err);
}
const names = {
  entry: "合同付款申请录入",
  results: "自动审核结果",
  review: "人工复核",
  manage: "模拟合同与付款数据",
};
const status = {
  passed: "通过 R003 审核",
  review_required: "需要人工复核",
  invalid: "数据错误",
  incomplete: "待补充",
};
const options = (xs: string[], current: string) =>
  xs
    .map((x) => `<option ${x === current ? "selected" : ""}>${e(x)}</option>`)
    .join("");
const field = (name: string, label: string, value: string, type = "text") =>
  `<label>${label}<input name="${name}" type="${type}" value="${e(value)}"></label>`;
function persist(next: State) {
  save(localStorage, next, raw);
  state = next;
  raw = JSON.stringify(next);
}
function entry() {
  const c = state.contracts.find((c) => c.id === draft.contractId);
  return `<section class="card"><h2>新建 / 同单新版本</h2><p class="identifier">申请编号：${e(draft.id)}</p><form id="entry" novalidate><div class="form-grid">${field("applicant", "申请人（必填）", draft.applicant)}${field("department", "部门", draft.department)}<label>关联合同<select name="contractId">${options(
    state.contracts.map((c) => c.id),
    draft.contractId,
  )}</select></label>${field("amountYuan", "申请金额（人民币元，最多两位小数）", draft.amountYuan)}${field("date", "申请付款日期", draft.date, "date")}<label>付款阶段<select name="stageId"><option value="">不适用 / 请选择</option>${(c?.stages || []).map((s) => `<option value="${e(s.id)}" ${s.id === draft.stageId ? "selected" : ""}>${e(s.name)}</option>`).join("")}</select></label></div>${field("remark", "付款备注", draft.remark)}<p>供应商：${e(c?.supplier || "未找到")} · 付款模式：${e(c?.mode || "未找到")}</p>${evidence(c)}<button type="button" id="example" class="secondary">载入 T04 超额示例</button> <button class="primary">执行自动审核</button><p id="entry-error" role="alert"></p></form></section>`;
}
function evidence(c: Contract | undefined) {
  return `<h3>模拟证据清单（未核验真实性）</h3>${(c?.evidence || []).map((x) => `<p>${e(x.name)}：<b>${x.status}</b></p>`).join("")}<p class="note">仅结构化模拟状态，不上传文件、不从文件名判断真伪。可在数据管理中维护。</p>`;
}
function result() {
  const d =
    state.documents.find((d) => d.id === selected) || state.documents[0];
  if (!d) return '<section class="card">请先录入付款申请并审核。</section>';
  selected = d.id;
  const v = d.audits.find((v) => v.id === version) || d.audits.at(-1)!;
  version = v.id;
  const r = v.automatic,
    c = r.snapshot.contract,
    n = r.calculation;
  return `<section class="card"><label>付款申请<select id="document">${state.documents.map((x) => `<option value="${e(x.id)}" ${x.id === d.id ? "selected" : ""}>${e(x.input.applicant)} · ${e(x.id)}</option>`).join("")}</select></label><label>审核版本<select id="version">${d.audits.map((x) => `<option value="${x.id}" ${v.id === x.id ? "selected" : ""}>v${x.version} · ${status[x.automatic.status]}</option>`).join("")}</select></label></section><section class="card" data-testid="auto"><h2>${status[r.status]}</h2><p>R003 v1 · ${e(displayTime(r.at))} · 基准日 ${r.baselineDate}</p>${r.errors.map((x) => `<p class="form-error">${e(x)}</p>`).join("")}<h3>${e(c?.id)} ${e(c?.name)} / ${e(c?.supplier)}</h3><p>${e(c?.status)} · ${e(c?.mode)}</p>${
    n
      ? `<dl class="result-grid">${Object.entries({
          合同总额: n.totalCents,
          历史已支付: n.paidCents,
          历史待支付: n.pendingCents,
          合同剩余: n.remainingCents,
          阶段限额: n.stageLimitCents,
          本阶段已支付: n.stagePaidCents,
          本阶段待支付: n.stagePendingCents,
          阶段剩余: n.stageRemainingCents,
          阶段超额: n.stageExcessCents,
          已确认结算: n.settlementCents,
          结算剩余: n.settlementRemainingCents,
          结算超额: n.settlementExcessCents,
          本次申请: n.amountCents,
          潜在累计占用: n.potentialCents,
          合同超额: n.contractExcessCents,
        })
          .map(
            ([k, x]) =>
              `<div><dt>${k}</dt><dd>${x === null ? "不适用" : yuan(x)}</dd></div>`,
          )
          .join(
            "",
          )}</dl><div class="calculation">合同剩余＝${yuan(n.totalCents)} − 已支付${yuan(n.paidCents)}＝${yuan(n.remainingCents)}（负余额显示0并报异常）<br>潜在占用＝已支付${yuan(n.paidCents)}＋待支付${yuan(n.pendingCents)}＋本次${yuan(n.amountCents)}＝${yuan(n.potentialCents)}${n.stageLimitCents !== null ? `<br>阶段限额＝${yuan(n.totalCents)} × ${(c!.stages.find((s) => s.id === r.snapshot.application.stageId)!.basisPoints / 100).toFixed(2)}%＝${yuan(n.stageLimitCents)}；阶段剩余＝${yuan(n.stageLimitCents)} − ${yuan(n.stagePaidCents)}＝${yuan(n.stageRemainingCents)}；本次超出${yuan(n.stageExcessCents)}` : ""}</div>`
      : "<p>基础数据无效，未执行金额判断，不生成虚假限额。</p>"
  }<h3>全部异常规则</h3>${r.risks.map((x) => `<p class="risk"><b>${x.rule}</b> ${e(x.message)}${x.excessCents === undefined ? "" : `：${yuan(x.excessCents)}`}</p>`).join("") || "<p>无业务风险命中（资料错误时不代表通过）。</p>"}<h3>适用前置条件</h3>${r.snapshot.requirements.map((x) => `<p>${e(x.name)}：${x.status}</p>`).join("")}<details><summary>当时合同、付款和输入证据快照</summary><pre>${e(JSON.stringify(r.snapshot, null, 2))}</pre></details><p class="note">基点精确计算，前面阶段按分四舍五入，尾差归最后阶段，全部阶段合计等于合同金额。人工通过不产生真实支付。</p></section><section class="card"><h2>独立人工复核</h2>${v.humanReview ? humanReviewCard(v.humanReview) : r.status === "review_required" && v === d.audits.at(-1) ? (page === "review" ? `<form id="review">${field("reviewer", "复核人员姓名", "")}<label>复核原因（必填）<textarea name="reason" maxlength="500"></textarea></label><button name="decision" value="rejected" class="danger-button">人工驳回</button> <button name="decision" value="approved" class="primary">人工通过</button><p id="review-error" role="alert"></p></form>` : '<button data-page="review" class="primary">进入人工复核</button>') : "<p>此版本已只读或无需人工复核。</p>"}<button id="reaudit" class="secondary">以当前合同数据同单重审</button></section>`;
}
function manage() {
  const c = state.contracts.find((c) => c.id === editContract);
  const p = state.payments.find((p) => p.id === editPayment);
  return `<section class="card"><h2>模拟合同列表与详情</h2><div class="table-scroll"><table><thead><tr><th>编号/合同</th><th>供应商/模式</th><th>金额/状态</th><th>操作</th></tr></thead><tbody>${state.contracts.map((c) => `<tr><td>${e(c.id)}<br>${e(c.name)}</td><td>${e(c.supplier)}<br>${c.mode}</td><td>${yuan(c.totalCents)}<br>${c.status}</td><td><button data-contract="${e(c.id)}">查看 / 修改</button></td></tr>`).join("")}</tbody></table></div><button id="new-contract">新增模拟合同</button><form id="contract" novalidate><div class="form-grid">${field("id", "合同编号", c?.id || "HT-" + uuid().slice(0, 8))}${field("name", "合同名称", c?.name || "")}${field("supplier", "供应商", c?.supplier || "")}${field("total", "合同总额（元）", c ? centsToYuan(c.totalCents) : "")}${field("effectiveDate", "生效日期", c?.effectiveDate || today(), "date")}${field("expiryDate", "到期日期", c?.expiryDate || today(), "date")}<label>合同状态<select name="status">${options(["草稿", "已生效", "已终止", "已到期"], c?.status || "草稿")}</select></label><label>付款模式<select name="mode">${options(["一次性付款", "分阶段付款", "按结算付款"], c?.mode || "一次性付款")}</select></label>${field("settlement", "已确认结算（元；非结算模式可空）", c?.settlementCents == null ? "" : centsToYuan(c.settlementCents))}</div><label>阶段配置JSON：id、name、basisPoints（总和10000）、requirements<textarea name="stages" rows="6">${e(JSON.stringify(c?.stages || [], null, 2))}</textarea></label><label>共同前置条件ID数组JSON<textarea name="requirements">${e(JSON.stringify(c?.requirements || ["accepted", "report"]))}</textarea></label><label>模拟证据JSON：id、name、status（已提供/缺失/无效）<textarea name="evidence" rows="8">${e(
    JSON.stringify(
      c?.evidence || [
        { id: "accepted", name: "验收完成确认", status: "缺失" },
        { id: "report", name: "验收报告", status: "缺失" },
      ],
      null,
      2,
    ),
  )}</textarea></label><p class="note">这是模拟配置编辑器。阶段基点合计必须10000；一次性要求验收完成及报告，结算模式应配置结算单。填写证据状态不代表系统验证内容。</p><button class="primary">保存模拟合同</button><p class="error"></p></form></section><section class="card"><h2>历史付款记录</h2><div class="table-scroll"><table><thead><tr><th>编号/合同</th><th>申请/阶段</th><th>金额/日期/状态</th><th>操作</th></tr></thead><tbody>${state.payments.map((x) => `<tr><td>${e(x.id)} / ${e(x.contractId)}</td><td>${e(x.applicationId)} / ${e(x.stageId)}</td><td>${yuan(x.amountCents)} / ${x.date} / ${x.status}</td><td><button data-payment="${e(x.id)}">修改</button></td></tr>`).join("")}</tbody></table></div><button id="new-payment">新增付款记录</button><form id="payment" novalidate><div class="form-grid">${field("id", "付款记录编号", p?.id || "PAY-" + uuid().slice(0, 8))}<label>合同<select name="contractId">${options(
    state.contracts.map((c) => c.id),
    p?.contractId || "HT-002",
  )}</select></label>${field("applicationId", "关联付款申请编号", p?.applicationId || "APP-" + uuid().slice(0, 8))}${field("stageId", "阶段编号（分阶段必填，如S2）", p?.stageId || "")}${field("amount", "付款金额（元）", p ? centsToYuan(p.amountCents) : "")}${field("date", "付款日期", p?.date || today(), "date")}<label>付款状态<select name="status">${options(["已支付", "待支付", "已取消", "支付失败"], p?.status || "待支付")}</select></label></div><button class="primary">保存模拟付款记录</button><p class="error"></p></form></section><section class="card"><button id="restore" class="danger-button">恢复 R003 模拟合同与付款库</button><p>只替换合同和历史付款，保留全部申请、审核版本及复核，不操作R001/R002。</p></section>`;
}
function render() {
  root.innerHTML = `<div class="r001-layout"><aside class="sidebar"><h2>轻报 · R003</h2>${ruleLinks("R003")}<nav>${Object.entries(
    names,
  )
    .map(
      ([k, v]) =>
        `<button data-page="${k}" class="nav-button ${k === page ? "active" : ""}">${v}</button>`,
    )
    .join(
      "",
    )}</nav><p>本浏览器模拟 · 不连接银行</p></aside><div class="main-shell"><main><div class="page-title"><h1>${names[page as keyof typeof names]}</h1><button id="new" class="secondary">新建付款申请</button></div><p class="feedback" role="status">${e(message || broken)}</p>${broken ? '<section class="card">本地数据无法安全读取，已暂停写入；原值保留，请勿清除浏览器数据。</section>' : page === "entry" ? entry() : page === "manage" ? manage() : result()}</main></div></div>`;
  bind();
}
const read = (f: HTMLFormElement) =>
  Object.fromEntries(new FormData(f)) as Record<string, string>;
function guard() {
  return (
    !root.querySelector("form[data-dirty=true]") ||
    confirm("表单未保存，是否放弃修改？")
  );
}
function bind() {
  root.querySelectorAll<HTMLElement>("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        if (guard()) {
          page = b.dataset.page!;
          message = "";
          render();
        }
      }),
  );
  root.querySelectorAll("form").forEach(
    (f) =>
      (f.oninput = () => {
        f.dataset.dirty = "true";
      }),
  );
  root
    .querySelectorAll<HTMLAnchorElement>(".rule-links a")
    .forEach((a) => (a.onclick = () => guard()));
  root.querySelector<HTMLButtonElement>("#new")!.onclick = () => {
    if (guard()) {
      draft = fresh();
      page = "entry";
      render();
    }
  };
  const f = root.querySelector<HTMLFormElement>("#entry");
  if (f) {
    f.querySelector<HTMLSelectElement>("[name=contractId]")!.onchange = () => {
      draft = { ...draft, ...read(f) };
      draft.stageId =
        state.contracts.find((c) => c.id === draft.contractId)?.stages[0]?.id ||
        "";
      render();
    };
    root.querySelector<HTMLButtonElement>("#example")!.onclick = () => {
      draft = {
        ...fresh(),
        applicant: "李四（模拟）",
        department: "财务部",
        amountYuan: "35000",
      };
      render();
    };
    f.onsubmit = (ev) => {
      ev.preventDefault();
      try {
        draft = { ...draft, ...read(f) };
        const latest = load(localStorage, today());
        const prior = latest.state.documents.find((d) => d.id === draft.id);
        if (
          prior &&
          prior.audits.length !==
            (state.documents.find((d) => d.id === draft.id)?.audits.length || 0)
        )
          throw Error("审核版本已更新，请刷新");
        raw = latest.raw;
        persist(append(latest.state, draft, today(), now(), uuid()));
        selected = draft.id;
        version = "";
        page = "results";
        render();
      } catch (err) {
        f.querySelector("#entry-error")!.textContent = String(err);
      }
    };
  }
  const doc = root.querySelector<HTMLSelectElement>("#document");
  if (doc)
    doc.onchange = () => {
      if (guard()) {
        selected = doc.value;
        version = "";
        render();
      }
    };
  const v = root.querySelector<HTMLSelectElement>("#version");
  if (v)
    v.onchange = () => {
      if (guard()) {
        version = v.value;
        render();
      }
    };
  const rf = root.querySelector<HTMLFormElement>("#review");
  if (rf)
    rf.onsubmit = (ev) => {
      ev.preventDefault();
      try {
        const values = read(rf),
          decision = (ev.submitter as HTMLButtonElement).value as
            "approved" | "rejected";
        const latest = load(localStorage, today());
        raw = latest.raw;
        persist(
          review(
            latest.state,
            selected,
            version,
            decision,
            values.reason!,
            values.reviewer!,
            now(),
          ),
        );
        render();
      } catch (err) {
        rf.querySelector("#review-error")!.textContent = String(err);
      }
    };
  const again = root.querySelector<HTMLButtonElement>("#reaudit");
  if (again)
    again.onclick = () => {
      if (guard()) {
        draft = structuredClone(
          state.documents.find((d) => d.id === selected)!.input,
        );
        page = "entry";
        message = "保留单号；提交将使用最新合同和付款数据生成新版本。";
        render();
      }
    };
  root.querySelectorAll<HTMLButtonElement>("[data-contract]").forEach(
    (b) =>
      (b.onclick = () => {
        if (guard()) {
          editContract = b.dataset.contract!;
          render();
        }
      }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-payment]").forEach(
    (b) =>
      (b.onclick = () => {
        if (guard()) {
          editPayment = b.dataset.payment!;
          render();
        }
      }),
  );
  const nc = root.querySelector<HTMLButtonElement>("#new-contract");
  if (nc)
    nc.onclick = () => {
      if (guard()) {
        editContract = "";
        render();
      }
    };
  const np = root.querySelector<HTMLButtonElement>("#new-payment");
  if (np)
    np.onclick = () => {
      if (guard()) {
        editPayment = "";
        render();
      }
    };
  const cf = root.querySelector<HTMLFormElement>("#contract");
  if (cf)
    cf.onsubmit = (ev) => {
      ev.preventDefault();
      try {
        const x = read(cf),
          total = parseYuan(x.total!),
          settlement = x.settlement ? parseYuan(x.settlement) : null;
        if (!total.ok || (settlement && !settlement.ok))
          throw Error("金额无效，须为非负两位小数");
        if (editContract && x.id !== editContract)
          throw Error("已有合同编号不可更换");
        if (!editContract && state.contracts.some((c) => c.id === x.id))
          throw Error("合同编号重复");
        const c = {
          id: x.id,
          name: x.name,
          supplier: x.supplier,
          totalCents: total.cents,
          effectiveDate: x.effectiveDate,
          expiryDate: x.expiryDate,
          status: x.status,
          mode: x.mode,
          settlementCents: settlement?.ok ? settlement.cents : null,
          stages: JSON.parse(x.stages!),
          requirements: JSON.parse(x.requirements!),
          evidence: JSON.parse(x.evidence!),
        } as Contract;
        persist({
          ...state,
          revision: state.revision + 1,
          contracts: [
            ...state.contracts.filter((c) => c.id !== editContract),
            c,
          ],
        });
        editContract = c.id;
        message = "模拟合同已保存；历史审核不变。";
        render();
      } catch (err) {
        cf.querySelector(".error")!.textContent = String(err);
      }
    };
  const pf = root.querySelector<HTMLFormElement>("#payment");
  if (pf)
    pf.onsubmit = (ev) => {
      ev.preventDefault();
      try {
        const x = read(pf),
          amount = parseYuan(x.amount!);
        if (!amount.ok) throw Error(amount.message);
        if (editPayment && x.id !== editPayment)
          throw Error("原付款编号不可更换");
        if (!editPayment && state.payments.some((p) => p.id === x.id))
          throw Error("付款编号重复");
        const p = {
          id: x.id,
          contractId: x.contractId,
          applicationId: x.applicationId,
          stageId: x.stageId,
          amountCents: amount.cents,
          date: x.date,
          status: x.status,
        } as Payment;
        persist({
          ...state,
          revision: state.revision + 1,
          payments: [...state.payments.filter((p) => p.id !== editPayment), p],
        });
        editPayment = p.id;
        message = "模拟付款记录已保存；未改历史审核。";
        render();
      } catch (err) {
        pf.querySelector(".error")!.textContent = String(err);
      }
    };
  const reset = root.querySelector<HTMLButtonElement>("#restore");
  if (reset)
    reset.onclick = () => {
      if (
        confirm(
          "恢复将替换R003模拟合同及历史付款（含新增/修改）；保留付款申请、审核版本和复核，R001/R002不变。继续？",
        )
      ) {
        try {
          persist(restore(state, today()));
          message = "已恢复模拟库，全部审核证据保留。";
          render();
        } catch (err) {
          message = String(err);
          render();
        }
      }
    };
}
render();
