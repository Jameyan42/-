import {
  enterprisePages,
  contractBalance,
  paymentHandler,
  canHandleCorporate,
  visibleCorporate,
  visibleContract,
  saveSupplier,
  saveContract,
  reviewContract,
  submitCorporate,
  actCorporate,
} from "./enterprise.js";
import { demoContractText, screenContract } from "./contract-review.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  "¥" +
  Number(n).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const today = () => new Date().toLocaleDateString("sv-SE");
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const options = (rows, id, label) =>
  rows
    .map(
      (x) =>
        `<option value="${esc(x.id)}" ${x.id === id ? "selected" : ""}>${esc(label(x))}</option>`,
    )
    .join("");
const noteField = `<label>处理意见<textarea name="note" maxlength="500" placeholder="填写核对依据或退回原因"></textarea></label>`;
const errorBox = `<p id="enterprise-error" class="risk" role="alert"></p>`;
const footer = (label) =>
  `${errorBox}<div class="modal-actions"><button type="submit" class="primary">${label}</button></div>`;
const localNotice = `<p class="footnote">仅本浏览器的虚构数据演示；角色选择不是真实鉴权。对公单独立于员工报销，当前在本页面办理，尚未纳入原消息中心、付款工作台和部门报销预算。</p>`;
let query = "",
  status = "全部",
  offset = 0,
  lastContext = "";
function rowsFor(page, state, actor) {
  return page === "供应商管理"
    ? state.suppliers
    : page === "合同审查"
      ? state.contracts.filter((c) => visibleContract(c, actor))
      : state.payments.filter((p) => visibleCorporate(p, actor));
}
function filtered(page, state, actor) {
  const q = query.trim().toLocaleLowerCase();
  return rowsFor(page, state, actor)
    .filter(
      (x) =>
        (status === "全部" ||
          (page === "供应商管理" ? (x.active ? "启用" : "停用") : x.status) ===
            status) &&
        [
          x.id,
          x.name,
          x.title,
          x.number,
          x.employee,
          x.department,
          x.supplierSnapshot?.name,
          x.bankAccount,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q),
    )
    .reverse();
}
export function enterpriseView(page, state, actor, healthy, flows) {
  if (lastContext !== page + actor?.id) {
    query = "";
    status = "全部";
    offset = 0;
    lastContext = page + actor?.id;
  }
  if (!healthy)
    return `<section class="panel prose"><h2>企业业务存储无法读取</h2><p>原始值已保留，不使用空白数据覆盖。请在数据管理恢复包含企业业务的有效备份。</p></section>`;
  const data = filtered(page, state, actor);
  offset = Math.min(offset, Math.max(0, Math.ceil(data.length / 10) - 1));
  const isSupplier = page === "供应商管理",
    isContract = page === "合同审查";
  const statuses = isSupplier
    ? ["启用", "停用"]
    : isContract
      ? ["待复核", "已复核", "需修改"]
      : [
          "待主管审批",
          "待财务审核",
          "待总账复核",
          "待付款",
          "已付款",
          "已退回",
          "已撤回",
        ];
  const title = isSupplier
    ? "维护供应商与虚构收款账户"
    : isContract
      ? "先初筛，再由人复核合同"
      : "让合同、审批与对公付款衔接";
  const createAllowed = isSupplier
    ? actor?.role === "管理员"
    : actor?.role === "员工";
  const summary = isSupplier
    ? "档案变更仅影响后续新提交，已提交付款保留收款快照。"
    : isContract
      ? "正文在本浏览器做规则初筛，不上传外部服务。真实 AI 尚未连接；初筛不构成法律意见。"
      : "已复核合同 → 员工提交 → 部门负责人/已发布业务节点 → 财务 → 总账 → 付款登记。";
  return `<section class="panel enterprise-panel"><div class="panel-title"><div><h2>${title}</h2><p>${summary}</p></div>${createAllowed ? `<button id="enterprise-create" class="primary">＋ ${isSupplier ? "新增供应商" : isContract ? "提交合同" : "新建对公支付单"}</button>` : ""}</div>${!isSupplier && !isContract && (!flows.ledgerId || !flows.payerId) ? `<div class="review-box"><b>尚未发布完整财务分工</b><p>需管理员在审批流程载入财务分工模板并填写原因发布；此处不会自动修改现有流程。</p><button id="enterprise-flow">前往审批流程</button></div>` : ""}${!isSupplier && !isContract ? `<div class="enterprise-metrics"><article><span>筛选结果待我处理</span><b>${data.filter((p) => canHandleCorporate(p, actor)).length} 笔</b></article><article><span>筛选结果在途占用</span><b>${money(data.filter((p) => !["已退回", "已撤回", "已付款"].includes(p.status)).reduce((n, p) => n + p.amount, 0))}</b></article><article><span>筛选结果已登记付款</span><b>${money(data.filter((p) => p.status === "已付款").reduce((n, p) => n + p.amount, 0))}</b></article></div>` : ""}<div class="toolbar"><label>状态<select id="enterprise-status"><option>全部</option>${statuses.map((s) => `<option ${status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><input id="enterprise-search" aria-label="搜索企业业务" placeholder="名称、单号、供应商或人员" value="${esc(query)}"><button id="enterprise-export">导出筛选 CSV</button></div><div class="table-wrap"><table><thead><tr>${(isSupplier ? ["供应商", "统一代码 / 账号", "状态", "操作"] : isContract ? ["合同 / 编号", "供应商", "合同金额 / 可用", "状态", "操作"] : ["事项 / 单号", "供应商 / 申请人", "金额", "状态 / 当前责任人", "操作"]).map((s) => `<th>${s}</th>`).join("")}</tr></thead><tbody>${
    data
      .slice(offset * 10, offset * 10 + 10)
      .map((x) =>
        isSupplier
          ? `<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.bankName)}</small></td><td>${esc(x.creditCode)}<small>${esc(x.bankAccount)}</small></td><td>${x.active ? "启用" : "停用"}</td><td>${actor?.role === "管理员" ? `<button class="link" data-enterprise-open="${esc(x.id)}">维护档案</button>` : "仅查看"}</td></tr>`
          : isContract
            ? `<tr><td><strong>${esc(x.title)}</strong><small>${esc(x.number)} · v${x.version}</small></td><td>${esc(x.supplierSnapshot.name)}<small>${esc(x.employee)}</small></td><td>${money(x.amount)}<small>可用 ${money(contractBalance(state, x.id).available)}</small></td><td>${esc(x.status)}<small>${x.screen.findings.length} 项规则提示</small></td><td><button class="link" data-enterprise-open="${esc(x.id)}">查看合同</button></td></tr>`
            : `<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.id)}</small></td><td>${esc(x.supplierSnapshot.name)}<small>${esc(x.employee)} · ${esc(x.department)}</small></td><td>${money(x.amount)}</td><td>${esc(x.status)}<small>${canHandleCorporate(x, actor) ? "待我处理 · " : ""}${["已退回", "已撤回", "已付款"].includes(x.status) ? "流程已结束" : esc(paymentHandler(x)?.actorName)}</small></td><td><button class="link" data-enterprise-open="${esc(x.id)}">查看支付单</button></td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" class="empty">暂无符合条件的记录。${createAllowed ? "可从右上角新建。" : "切换相应演示角色发起业务。"}</td></tr>`
  }</tbody></table></div><div class="table-footer">共 ${data.length} 条筛选结果<span><button data-enterprise-page="-1" ${offset === 0 ? "disabled" : ""}>上一页</button> 第 ${offset + 1} / ${Math.max(1, Math.ceil(data.length / 10))} 页 <button data-enterprise-page="1" ${(offset + 1) * 10 >= data.length ? "disabled" : ""}>下一页</button></span></div>${localNotice}</section>`;
}
function reviewHTML(result) {
  return `<section class="review-box"><h3>本地规则初筛 · ${esc(result.engine)}</h3><p>非 AI 审查、非法律结论；未检出不代表条款不存在，命中也需结合全文和否定表述。</p>${result.findings.map((f) => `<article class="contract-finding"><b class="${f.severity === "高" ? "risk" : ""}">${esc(f.severity)} · ${esc(f.label)}</b><blockquote>${esc(f.evidence)}</blockquote><p>${esc(f.suggestion)}</p></article>`).join("") || "<p>当前规则未命中提示，仍需人工阅读完整合同。</p>"}</section>`;
}
function historyHTML(doc) {
  return `<details class="enterprise-history"><summary>操作记录（${doc.history.length}）</summary>${doc.history.map((h) => `<p><b>${esc(h.actorName)} · ${esc(h.role)} · ${esc(h.action)}</b><small>${esc(h.at)} · ${esc(h.from)} → ${esc(h.to)}</small>${esc(h.note)}</p>`).join("")}</details>`;
}
export function mountEnterprise({
  page,
  getState,
  actor,
  org,
  flows,
  healthy,
  expenseItems,
  save,
  modal: openModal,
  render,
  toast,
  go,
  download,
}) {
  if (!enterprisePages.includes(page) || !healthy) return;
  const modal = (html) =>
    openModal(
      `<button data-close class="enterprise-close" aria-label="关闭">✕</button>${html}`,
    );
  const state = () => getState();
  const showError = (err) => {
    const el = document.querySelector("#enterprise-error");
    if (el) el.textContent = err.message;
    else toast(err.message);
  };
  const commit = (next) => {
    save(next);
    document.querySelector("#overlay").innerHTML = "";
    render();
    toast("企业业务已保存（仅本地演示）");
  };
  const bindForm = (run) => {
    const f = document.querySelector("#enterprise-form");
    if (!f) return;
    f.oninput = () => (f.dataset.dirty = "true");
    f.onsubmit = (e) => {
      e.preventDefault();
      try {
        commit(run(Object.fromEntries(new FormData(f)), f));
      } catch (err) {
        showError(err);
      }
    };
  };
  function supplierForm(id = "") {
    const old = state().suppliers.find((x) => x.id === id) || { active: true };
    if (actor.role !== "管理员") return;
    modal(
      `<h2>${id ? "维护" : "新增"}供应商</h2><p>只接受 DEMO- 开头的虚构账号；停用后不能新增付款，已有在途单据保留。</p><form id="enterprise-form">${field("供应商全称", "name", old.name, "text", 'required maxlength="100"')}${field("统一代码（虚构）", "creditCode", old.creditCode, "text", 'required maxlength="40"')}${field("收款户名（须与供应商全称一致）", "accountName", old.accountName, "text", 'required maxlength="100"')}${field("开户行（虚构）", "bankName", old.bankName || "演示银行", "text", 'required maxlength="100"')}${field("虚构银行账号", "bankAccount", old.bankAccount || "DEMO-SUPPLIER-001", "text", 'required maxlength="45"')}<label class="check-line"><input type="checkbox" name="active" ${old.active ? "checked" : ""}>启用</label>${footer("保存供应商")}</form>`,
    );
    bindForm((d, f) =>
      saveSupplier(
        state(),
        { ...d, active: f.elements.active.checked },
        actor,
        id,
      ),
    );
  }
  function contractForm(id = "") {
    const old = state().contracts.find((x) => x.id === id) || {};
    modal(
      `<h2>${id ? "修订" : "提交"}合同</h2><p>仅使用虚构合同。保存后执行本地规则初筛，待财务或管理员人工复核。</p><form id="enterprise-form"><label>供应商<select name="supplierId" required><option value="">请选择</option>${options(
        state().suppliers.filter((s) => s.active),
        old.supplierId,
        (s) => s.name,
      )}</select></label>${field("合同编号", "number", old.number, "text", 'required maxlength="60"')}${field("合同名称", "title", old.title, "text", 'required maxlength="100"')}${field("合同含税总额 CNY", "amount", old.amount || 10000, "number", 'required min="0.01" max="1000000" step="0.01"')}<div class="form-grid">${field("开始日期", "startDate", old.startDate || today(), "date", "required")}${field("结束日期", "endDate", old.endDate || today(), "date", "required")}</div><label>合同正文（最多30000字）<textarea name="text" rows="12" maxlength="30000" required>${esc(old.text)}</textarea></label><label>或导入 UTF-8 TXT（最多90 KB）<input id="contract-text-file" type="file" accept=".txt,text/plain"></label><div class="enterprise-buttons"><button id="contract-sample" type="button">载入虚构合同正文</button><button id="contract-preview" type="button">预览规则初筛</button><button type="button" disabled title="尚未连接模型服务">AI 审查 · 尚未连接</button></div><div id="contract-preview-result"></div>${footer("保存并提交人工复核")}</form>`,
    );
    bindForm((d) => saveContract(state(), d, actor, org, id));
    const f = document.querySelector("#enterprise-form");
    document.querySelector("#contract-sample").onclick = () => {
      const s = state().suppliers.find(
        (s) => s.id === f.elements.supplierId.value,
      );
      f.elements.text.value = demoContractText.replaceAll(
        "远帆服务有限公司（虚构）",
        s?.name || "远帆服务有限公司（虚构）",
      );
      f.dataset.dirty = "true";
    };
    document.querySelector("#contract-preview").onclick = () => {
      try {
        const s = state().suppliers.find(
          (s) => s.id === f.elements.supplierId.value,
        );
        if (!s) throw Error("请先选择供应商");
        document.querySelector("#contract-preview-result").innerHTML =
          reviewHTML(screenContract(f.elements.text.value, s.name));
      } catch (err) {
        showError(err);
      }
    };
    document.querySelector("#contract-text-file").onchange = async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (!/\.txt$/i.test(file.name) || file.size > 90000)
          throw Error("只支持最多90 KB的UTF-8 TXT，PDF/DOCX请先提取文字");
        const text = await file.text();
        if (
          text.includes("\ufffd") ||
          text.includes("\0") ||
          text.length > 30000
        )
          throw Error("正文编码或长度无效，请用UTF-8 TXT或直接粘贴文字");
        f.elements.text.value = text;
        f.dataset.dirty = "true";
      } catch (err) {
        showError(err);
      } finally {
        e.target.value = "";
      }
    };
  }
  function contractDetail(id) {
    const c = state().contracts.find((x) => x.id === id);
    if (!c || !visibleContract(c, actor))
      return toast("该合同不在当前演示身份可见范围");
    const b = contractBalance(state(), c.id),
      reviewable =
        ["财务", "管理员"].includes(actor.role) &&
        c.status === "待复核" &&
        c.createdBy !== actor.id;
    modal(
      `<h2>${esc(c.title)}</h2><p>${esc(c.number)} · v${c.version} · ${esc(c.status)}</p><div class="review-box"><p>供应商：${esc(c.supplierSnapshot.name)}</p><p>总额 ${money(b.total)} / 在途 ${money(b.occupied)} / 已登记付款 ${money(b.paid)} / 可用 ${money(b.available)}</p><p>${esc(c.startDate)} ～ ${esc(c.endDate)} · ${esc(c.employee)}</p></div>${reviewHTML(c.screen)}<details open><summary>完整合同正文</summary><pre class="contract-text">${esc(c.text)}</pre></details>${c.review ? `<div class="review-box"><b>人工复核：${esc(c.review.actorName)}</b><p>${esc(c.review.note)}</p><small>${esc(c.review.at)}；仅本版本有效。</small></div>` : ""}${historyHTML(c)}${reviewable ? `<form id="enterprise-form">${noteField}<label class="check-line"><input type="checkbox" name="confirmed" required>我已人工阅读全文，核对主体、付款条件及规则提示；意见中记录风险处理依据</label><label>复核结论<select name="decision"><option value="approve">通过人工复核</option><option value="return">要求修改</option></select></label>${footer("保存复核结论")}</form>` : actor.role === "员工" && c.createdBy === actor.id && c.status !== "已复核" ? `<button id="contract-edit" class="primary">修订合同并重提</button>` : ""}${localNotice}`,
    );
    if (reviewable)
      bindForm((d, f) =>
        reviewContract(state(), id, actor, {
          approve: d.decision === "approve",
          note: d.note,
          confirmed: f.elements.confirmed.checked,
        }),
      );
    document
      .querySelector("#contract-edit")
      ?.addEventListener("click", () => contractForm(id));
  }
  function paymentForm(id = "") {
    const old = state().payments.find((x) => x.id === id) || {};
    const contracts = state().contracts.filter(
      (c) =>
        c.status === "已复核" &&
        c.createdBy === actor.id &&
        state().suppliers.some((s) => s.id === c.supplierId && s.active),
    );
    modal(
      `<h2>${id ? "重新提交" : "新建"}对公支付单</h2><p>当前仅可使用本人提交并已复核的合同。金额不得超过合同可用额度；提交时固定收款账户与审批路径。</p><form id="enterprise-form"><label>关联合同<select name="contractId" required><option value="">请选择已复核合同</option>${options(contracts, old.contractId, (c) => `${c.number} · ${c.title}`)}</select></label><div id="corporate-contract-summary" class="review-box"></div>${field("付款事项", "name", old.name, "text", 'required maxlength="100"')}${field("本次支付金额 CNY", "amount", old.amount || "", "number", 'required min="0.01" max="1000000" step="0.01"')}${field("期望付款日期（不代表到账日）", "date", old.date || today(), "date", "required")}<label>用途与付款依据<textarea name="note" maxlength="500" required>${esc(old.note)}</textarea></label><p>本阶段不校验发票验真、验收单或合同履约附件，财务须人工核对付款条件。</p>${footer("提交对公支付审批")}</form>`,
    );
    const f = document.querySelector("#enterprise-form");
    const refresh = () => {
      const c = contracts.find((c) => c.id === f.elements.contractId.value);
      const s = c && state().suppliers.find((s) => s.id === c.supplierId);
      document.querySelector("#corporate-contract-summary").innerHTML = c
        ? `合同可用 ${money(contractBalance(state(), c.id, id).available)}<p>收款方 ${esc(s.name)} / ${esc(s.bankName)} / ${esc(s.bankAccount)}</p><small>合同额度与原部门报销预算分开统计。</small>`
        : "请选择合同；如无记录，请先提交合同并人工复核。";
    };
    f.elements.contractId.onchange = refresh;
    refresh();
    bindForm((d) => {
      const c = state().contracts.find((c) => c.id === d.contractId);
      if (c?.createdBy !== actor.id) throw Error("仅可使用本人已复核合同");
      return submitCorporate(state(), d, actor, org, flows, id);
    });
  }
  function paymentDetail(id) {
    const p = state().payments.find((x) => x.id === id);
    if (!p || !visibleCorporate(p, actor))
      return toast("支付单不在当前演示身份可见范围");
    const c = state().contracts.find((c) => c.id === p.contractId),
      b = contractBalance(state(), c.id),
      s = p.supplierSnapshot,
      handle = canHandleCorporate(p, actor);
    const route = [...p.approval.nodes, p.approval.paymentActor];
    modal(
      `<h2>${esc(p.name)}</h2><p>${esc(p.id)} · ${esc(p.status)} · ${money(p.amount)}</p><p>${esc(p.employee)} / ${esc(p.department)} · 期望日期 ${esc(p.date)}</p><p>${esc(p.note)}</p><section class="review-box"><h3>提交时收款快照</h3><p>${esc(s.name)} / ${esc(s.creditCode)}</p><p>户名 ${esc(s.accountName)} / ${esc(s.bankName)} / ${esc(s.bankAccount)}</p><small>供应商档案后续变更不改写本单快照。</small></section><div class="review-box"><h3>关联合同 ${esc(c.number)} · v${p.contractVersion}</h3><p>总额 ${money(b.total)} / 在途 ${money(b.occupied)} / 已登记付款 ${money(b.paid)} / 可用 ${money(b.available)}</p><p>人工复核 ${esc(c.review.actorName)}：${esc(c.review.note)}</p></div><details><summary>合同原文与规则提示</summary>${reviewHTML(c.screen)}<pre class="contract-text">${esc(c.text)}</pre></details><h3>审批快照 · 流程 v${p.approval.version}</h3><ol class="corporate-route">${route.map((n, i) => `<li class="${i === p.approval.cursor && handle ? "current" : ""}">${esc(n.label)} · ${esc(n.actorName)}<small>${i < p.approval.cursor || p.status === "已付款" ? "已完成" : i === p.approval.cursor && !["已退回", "已撤回"].includes(p.status) ? "当前节点" : ""}</small></li>`).join("")}</ol>${p.ledgerReview ? `<p>总账科目：${esc(p.ledgerReview.account)} / 核算归属：${esc(p.ledgerReview.costCenter)}</p>` : ""}${p.payment ? `<div class="review-box"><h3>模拟付款已登记</h3><p>${esc(p.payment.date)} / ${esc(p.payment.method)} / ${esc(p.payment.reference)}</p><p>此记录不代表银行转账或到账。</p></div>` : ""}${historyHTML(p)}${handle ? `<form id="enterprise-form">${noteField}${p.status === "待总账复核" ? `<div class="form-grid">${field("总账科目", "account", "", "text", 'maxlength="100"')}${field("核算归属 / 成本中心", "costCenter", "", "text", 'maxlength="100"')}</div>` : ""}${p.status === "待付款" ? `${field("付款日期", "paymentDate", today(), "date")}<label>付款方式<select name="method"><option>银行转账</option><option>其他线下付款</option></select></label>${field("付款参考号", "reference", "", "text", 'maxlength="60"')}<label class="check-line"><input name="confirmed" type="checkbox">确认仅登记模拟付款，不会实际转账</label>` : ""}<label>处理动作<select name="action"><option value="approve">${p.status === "待付款" ? "登记模拟付款" : "通过当前节点"}</option><option value="reject">退回员工修改</option></select></label>${footer("确认处理对公单")}</form>` : actor.id === p.createdBy && ["已退回", "已撤回"].includes(p.status) ? `<button id="corporate-edit" class="primary">修改并重新提交</button>` : actor.id === p.createdBy && p.approval.cursor === 0 && p.status === "待主管审批" ? `<form id="enterprise-form">${noteField}${footer("撤回未审批单据")}</form>` : ""}${localNotice}`,
    );
    if (handle)
      bindForm((d, f) =>
        actCorporate(
          state(),
          id,
          actor,
          d.action,
          {
            note: d.note,
            ledgerReview: { account: d.account, costCenter: d.costCenter },
            payment: {
              reference: d.reference,
              date: d.paymentDate,
              method: d.method,
              confirmed: !!f.elements.confirmed?.checked,
            },
          },
          expenseItems(),
        ),
      );
    else if (
      actor.id === p.createdBy &&
      p.approval.cursor === 0 &&
      p.status === "待主管审批"
    )
      bindForm((d) =>
        actCorporate(state(), id, actor, "withdraw", { note: d.note }),
      );
    document
      .querySelector("#corporate-edit")
      ?.addEventListener("click", () => paymentForm(id));
  }
  document
    .querySelector("#enterprise-create")
    ?.addEventListener("click", () =>
      page === "供应商管理"
        ? supplierForm()
        : page === "合同审查"
          ? contractForm()
          : paymentForm(),
    );
  document
    .querySelectorAll("[data-enterprise-open]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          page === "供应商管理"
            ? supplierForm(el.dataset.enterpriseOpen)
            : page === "合同审查"
              ? contractDetail(el.dataset.enterpriseOpen)
              : paymentDetail(el.dataset.enterpriseOpen)),
    );
  document
    .querySelector("#enterprise-flow")
    ?.addEventListener("click", () => go("审批流程"));
  document.querySelector("#enterprise-status").onchange = (e) => {
    status = e.target.value;
    offset = 0;
    render();
  };
  document.querySelector("#enterprise-search").oninput = (e) => {
    query = e.target.value;
    offset = 0;
    const pos = e.target.selectionStart;
    render();
    const el = document.querySelector("#enterprise-search");
    el.focus();
    el.setSelectionRange(pos, pos);
  };
  document.querySelectorAll("[data-enterprise-page]").forEach(
    (el) =>
      (el.onclick = () => {
        offset += Number(el.dataset.enterprisePage);
        render();
      }),
  );
  document.querySelector("#enterprise-export").onclick = () => {
    const cell = (s) =>
      '"' +
      String(s ?? "")
        .replace(/^\s*[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const rows = filtered(page, state(), actor).map((x) =>
      page === "供应商管理"
        ? [
            x.id,
            x.name,
            x.creditCode,
            x.bankAccount,
            x.active ? "启用" : "停用",
          ]
        : page === "合同审查"
          ? [
              x.id,
              x.title,
              x.number,
              x.supplierSnapshot.name,
              x.amount,
              x.status,
              x.screen.findings.length,
            ]
          : [
              x.id,
              x.name,
              x.supplierSnapshot.name,
              x.employee,
              x.amount,
              x.status,
              x.payment?.reference || "",
            ],
    );
    const headers =
      page === "供应商管理"
        ? ["ID", "供应商", "统一代码", "虚构账号", "状态"]
        : page === "合同审查"
          ? ["ID", "合同", "编号", "供应商", "金额CNY", "状态", "规则提示数"]
          : ["ID", "事项", "供应商", "申请人", "金额CNY", "状态", "付款参考号"];
    download(
      "\ufeff" +
        [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"),
      `轻报-${page}-筛选结果.csv`,
      "text/csv;charset=utf-8",
    );
  };
}
