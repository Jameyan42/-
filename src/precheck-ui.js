import { effectiveInvoiceBuyer } from "./invoice-data.js";
import { effectivePrecheck, ruleCatalog, nextPrecheck } from "./precheck.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const displayTime = (at) =>
  new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) +
  "（上海）";
export function precheckBadge(report) {
  const blocks = report.findings.filter((f) => f.effect === "block").length,
    warns = report.findings.length - blocks;
  return `<span class="${blocks ? "risk" : warns ? "precheck-warning" : "safe"}">${blocks ? `⚑ ${blocks} 项拦截` : warns ? `⚑ ${warns} 项提醒` : "✓ 当前规则未命中"}${blocks && warns ? ` / ${warns} 项提醒` : ""}</span>`;
}
export function precheckPanel(
  report,
  { historical = false, healthy = true } = {},
) {
  return `<section class="review-box precheck-panel" data-precheck-kind="${esc(report.kind)}"><h3>${historical ? "处理时预审快照" : "规则预审 · 当前检查"}</h3><p>${healthy ? precheckBadge(report) : '<b class="risk">规则存储异常，结果不完整，财务/总账/付款通过已暂停</b>'}</p><small>规则版本 v${report.policy.precheck.version} · ${esc(displayTime(report.at))} · ${historical ? "保留当时规则与结果，不随当前配置改写" : "按当前规则及可读取业务数据计算；列表查看不保存检查结果"}</small><details><summary>${historical ? "当时" : "本次"}规则参数</summary><p>票面基准 ${report.policy.invoiceBuyer ? esc(report.policy.invoiceBuyer.name) + " / 税号 " + esc(report.policy.invoiceBuyer.taxId || "未设") : "旧快照未记录票面基准"}</p><p>报销上限 ${report.policy.limit} 元；票据完整性 ${report.policy.requireReceipt ? "开" : "关"}；号码查重 ${report.policy.checkDuplicate ? "开" : "关"}</p><ul>${report.policy.precheck.rules.map((r) => `<li>${esc(ruleCatalog.find((c) => c.id === r.id)?.label)}：${r.enabled ? (r.effect === "block" ? "拦截" : "提醒") : "关闭"}${r.threshold === undefined ? "" : " / 阈值 " + r.threshold}</li>`).join("")}</ul></details>${report.findings.map((f) => `<article class="precheck-finding"><b class="${f.effect === "block" ? "risk" : "precheck-warning"}">${f.effect === "block" ? "拦截项" : "提醒项"} · ${esc(f.message)}</b><p><strong>触发依据：</strong>${esc(f.evidence)}</p><p><strong>核对建议：</strong>${esc(f.suggestion)}</p><small>规则 ${esc(f.id)}</small></article>`).join("")}<p class="footnote">提醒项不阻止审批；拦截项需修正或由财务调整可配置规则后，财务审核、总账复核和付款才可通过，主管仍可转交财务。固定合同额度、指定人及总账/付款字段校验不能关闭。结果不代表发票验真或业务真实性，也不会自动批准单据。</p></section>`;
}
export function precheckHistory(history) {
  const rows = history
    .filter((h) => h.precheck)
    .slice()
    .reverse();
  return rows.length
    ? `<details class="precheck-history"><summary>查看处理时预审快照（${rows.length}）</summary>${rows.map((h) => `<details><summary>${esc(h.operation?.actorName || h.actorName || h.text || "处理记录")} · ${esc(displayTime(h.precheck.at))} · 规则 v${h.precheck.policy.precheck.version}</summary>${precheckPanel(h.precheck, { historical: true })}</details>`).join("")}</details>`
    : "<p class=footnote>此单尚无新版处理时预审快照；不补造旧检查记录。</p>";
}
export function precheckSettings(policy, editable, healthy = true) {
  const c = effectivePrecheck(policy);
  return `<section class="precheck-settings"><h3>补充预审规则 · v${c.version}</h3><p>新增规则默认仅提醒。选择拦截后，命中会阻止财务、总账和付款通过；保存需原因，立即作用于当前检查，历史处理快照保留。规则存储${healthy ? "正常" : "异常，原值保留，需恢复有效备份"}。</p><h4>统一发票购买方基准</h4><p>目前单企业主体。只忽略全半角和空白，不做简称或模糊匹配；税号留空时不声称已核对税号。</p><div class="form-grid"><label>企业抬头<input name="invoiceBuyerName" maxlength="100" required value="${esc(effectiveInvoiceBuyer(policy).name)}" ${editable ? "" : "disabled"}></label><label>纳税人识别号（可空）<input name="invoiceBuyerTaxId" maxlength="24" value="${esc(effectiveInvoiceBuyer(policy).taxId)}" ${editable ? "" : "disabled"}></label></div>${[
    "expense",
    "corporate",
    "both",
  ]
    .map(
      (kind) =>
        `<h4>${kind === "expense" ? "报销单" : kind === "corporate" ? "对公支付单" : "票面字段核对（报销/对公）"}</h4>${ruleCatalog
          .filter((r) => r.kind === kind)
          .map((meta) => {
            const r = c.rules.find((r) => r.id === meta.id);
            return `<article class="precheck-rule" data-rule-id="${r.id}"><div><b>${esc(meta.label)}</b><p>${esc(meta.description)}</p></div><div class="precheck-rule-controls"><label class="check-line"><input type="checkbox" name="pc-${r.id}-enabled" ${r.enabled ? "checked" : ""} ${editable ? "" : "disabled"}>启用</label><label>处理方式<select name="pc-${r.id}-effect" ${editable ? "" : "disabled"}><option value="warn" ${r.effect === "warn" ? "selected" : ""}>提醒人工核对</option><option value="block" ${r.effect === "block" ? "selected" : ""}>拦截财务/总账/付款通过</option></select></label>${meta.threshold === undefined ? "" : `<label>${r.id === "expense-age" ? "天数" : r.id === "corporate-usage" ? "占用比例 %" : "金额 CNY"}<input type="number" name="pc-${r.id}-threshold" min="${meta.min}" max="${meta.max}" step="${["expense-age", "corporate-usage"].includes(r.id) ? 1 : 0.01}" value="${r.threshold}" ${editable ? "" : "disabled"} required></label>`}</div></article>`;
          })
          .join("")}`,
    )
    .join("")}</section>`;
}
export function collectPrecheck(form, policy) {
  return nextPrecheck(
    policy,
    ruleCatalog.map((meta) => ({
      id: meta.id,
      enabled: form.elements[`pc-${meta.id}-enabled`].checked,
      effect: form.elements[`pc-${meta.id}-effect`].value,
      ...(meta.threshold === undefined
        ? {}
        : {
            threshold: Number(form.elements[`pc-${meta.id}-threshold`].value),
          }),
    })),
  );
}
