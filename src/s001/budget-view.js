import { budgetContext } from "./budget-model.ts";
import { resolveVersion, policyToday, usesManagedBudgets } from "./rule-config.ts";
import { centsToYuan } from "../r001/rule.ts";
import { defaultEntities } from "./entity-rule.ts";
import { defaultBudgetBook } from "./budget-config.ts";
import { budgetRule, budgetTotals } from "./budget-rule.ts";
import {
  escapeHtml as esc,
  formatYuan as positiveYuan,
  displayTime,
} from "../shared/audit-ui";
import { expenseTypes } from "./account-config.ts";
const yuan = (c) =>
  c < 0 ? positiveYuan(-c).replace("¥ ", "¥ -") : positiveYuan(c);
const modes = { HARD: "刚性控制", SOFT: "柔性授权", WARNING: "预警控制" };
const pct = (n) =>
  n == null ? "零预算，不作除法" : (n / 100).toFixed(2) + "%";
export function budgetEvidence(r) {
  if (r.ruleId !== "R007") return "";
  const e = r.evidence || {},
    b = e.budget;
  if (!b)
    return `<p>${esc(r.message)}；期间${esc(e.period || "未确定")}，部门${esc(e.departmentId || "未确定")}</p>`;
  return `<div class="review-box"><p>${esc(b.budgetId)} · ${esc(b.companyId)} / ${esc(b.departmentId)} / ${esc(b.expenseType)} / ${esc(b.budgetPeriod)} · v${b.version} · ${modes[b.controlMode]}</p><div class="detail-grid"><p>预算总额 <b>${yuan(e.totalCents)}</b></p><p>已使用（财务批准） <b>${yuan(e.usedCents)}</b></p><p>其他预占 <b>${yuan(e.otherReservedCents)}</b></p><p>本单有效预占 <b>${yuan(e.ownReservedCents)}</b></p><p>当前实际可用 <b>${yuan(e.currentAvailableCents)}</b></p><p>供本单比较额度（剔除自身） <b>${yuan(e.availableForCurrentCents)}</b></p><p>申请金额 <b>${yuan(e.amountCents)}</b></p><p>预计余额 <b>${yuan(e.projectedRemainingCents)}</b></p><p>超预算 <b>${yuan(e.excessCents)}</b></p></div><p>当前使用率${pct(e.currentUsageBps)}；申请后预计${pct(e.projectedUsageBps)}。${e.warnings?.length ? `预警：${esc(e.warnings.join("/"))}%阈值` : ""}</p><p>草稿/自动审核只作预计，不写预算流水；已使用不等于付款或总账费用。</p></div>`;
}
export function budgetPreview(input, state, org) {
  let r;
  try {r=budgetRule(input,budgetContext(state,state.claims.find(d=>d.id===input.id)||{id:input.id,revision:1,input,workflows:[]},new Date().toISOString(),org));}
  catch(e){return `<h4>预算预计（只读）</h4><p class="risk">${esc(String(e))}；制度未确认，不视为通过。</p>`;}

  return `<h4>预算预计（只读）</h4><p>${esc(r.message)}</p>${budgetEvidence(r)}`;
}
const field = (name, label, value, type = "text") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value ?? "")}"></label>`;
const opts = (list, value) =>
  list
    .map(
      ([id, name]) =>
        `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(name)}</option>`,
    )
    .join("");
export function budgetManagement(state, org, actor, filters, selected) {
  const book = state.budgetBook || defaultBudgetBook(),
    all = book.budgets,
    rows = all.filter(
      (b) =>
        (!filters.company || b.companyId === filters.company) &&
        (!filters.department || b.departmentId === filters.department) &&
        (!filters.expense || b.expenseType === filters.expense) &&
        (!filters.period || b.budgetPeriod === filters.period),
    );
  const b = all.find((b) => b.budgetId === selected),
    editable = ["财务", "管理员"].includes(actor?.role),
    companies = (
      state.entityConfig?.companies || defaultEntities().companies
    ).map((c) => [c.companyId, c.companyName]),
    departments = (org?.departments || []).map((d) => [d.id, d.name]);
  const x = b || {
    budgetId: "",
    companyId: "SZ",
    departmentId: "sales",
    expenseType: "住宿费",
    budgetPeriod: filters.period || "2026-10",
    budgetAmount: 1000000,
    controlMode: "HARD",
    warningThresholds: [80, 90, 100],
    effectiveFrom: (filters.period || "2026-10") + "-01",
    effectiveTo: null,
    status: "ACTIVE",
    description: "模拟月度预算",
    reserveOnSoftExceeded: true,
    extraApproverId: "admin-gu",
  };
  const governed=usesManagedBudgets(state.ruleBook,new Date().toISOString());
  return `<section class="panel"><h3>统一报销预算执行（R007）</h3>${governed?'<p class="review-box">控制策略已由R008版本管理接管。这里仅维护额度、期间及流水；下方原策略字段只读。表格按当前日期/预算月份显示适用策略，无配置时必须先发布，不能沿用旧值通过。</p>':''}<p>同一预算流水源计算：已使用＝财务最终批准；预占＝有效提交但未最终批准。原流程预算保留在本页下方，口径不同，不合并余额。此前未登记R007流水的历史单不自动追补；正式启用前需核对期初迁移，不把模拟期初当作真实数据。</p><div class="form-grid"><label>法人筛选<select id="r007-company"><option value="">全部</option>${opts(companies, filters.company)}</select></label><label>部门筛选<select id="r007-department"><option value="">全部</option>${opts(departments, filters.department)}</select></label><label>费用类型筛选<select id="r007-expense"><option value="">全部</option>${opts(
    [...new Set(all.map((b) => b.expenseType))].map((x) => [x, x]),
    filters.expense,
  )}</select></label><label>预算月份<input id="r007-period" type="month" value="${esc(filters.period)}"></label></div><div class="table-wrap"><table id="r007-table"><thead><tr><th>预算 / 维度</th><th>额度 / 已使用</th><th>预占 / 可用</th><th>使用率 / 模式</th><th>操作</th></tr></thead><tbody>${rows
    .map((rawBudget) => {
      let b=rawBudget, policyInfo='';
      if(governed){const at=new Date().toISOString(),today=policyToday(at),d={companyId:b.companyId,businessDate:b.budgetPeriod===today.slice(0,7)?today:b.budgetPeriod+'-01',checkIn:b.budgetPeriod+'-01'};
       const sel=resolveVersion(state.ruleBook,d,'R007',at),p=sel.version?.enabled&&!sel.error?sel.version.parameters.policies.find(p=>p.expenseType===b.expenseType):null;
       policyInfo=p?`R008 v${sel.version.versionNumber}`:'R008策略缺失/冲突/停用';
       if(p)b={...b,...p};
      }

      const t = budgetTotals(book, b.budgetId),
        available = b.budgetAmount - t.used - t.reserved;
      return `<tr><td>${esc(b.budgetId)}<small>${esc(b.companyId)} / ${esc(departments.find((d) => d[0] === b.departmentId)?.[1] || b.departmentId)} / ${esc(b.expenseType)} / ${esc(b.budgetPeriod)} · v${b.version} · ${b.status === "ACTIVE" ? "启用" : "停用"}</small></td><td>${yuan(b.budgetAmount)}<small>已使用${yuan(t.used)}</small></td><td>预占${yuan(t.reserved)}<small class="${available < 0 ? "risk" : ""}">可用${yuan(available)}</small></td><td>${b.budgetAmount ? (((t.used + t.reserved) / b.budgetAmount) * 100).toFixed(2) + "%" : "零预算不作除法"}<small>${governed&&!policyInfo.startsWith("R008 v")?"不可执行":modes[b.controlMode]} ${esc(policyInfo)}</small></td><td><button data-r007-open="${esc(b.budgetId)}">配置 / 流水</button></td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div><button id="r007-new" ${editable ? "" : "disabled"}>新增模拟预算</button><p>角色为演示权限，本地存储不是生产事务或多人并发锁。</p></section><section class="panel"><h3>${b ? "预算配置 " + esc(b.budgetId) : "新增预算配置"}</h3><form id="r007-config"><div class="form-grid">${field("budgetId", "预算编号（新增须唯一；修改维度请新增并停用旧记录）", x.budgetId)}<label>法人<select name="companyId">${opts(companies, x.companyId)}</select></label><label>部门<select name="departmentId">${opts(departments, x.departmentId)}</select></label><label>费用类型<select name="expenseType">${opts(
    expenseTypes.map((x) => [x, x]),
    x.expenseType,
  )}</select></label>${field("budgetPeriod", "自然月", x.budgetPeriod, "month")}${field("budgetAmountYuan", "预算总额（元）", centsToYuan(x.budgetAmount))}<label>控制模式<select name="controlMode">${opts(Object.entries(modes), x.controlMode)}</select></label>${field("thresholds", "预警百分比（逗号分隔）", x.warningThresholds.join(","))}${field("effectiveFrom", "生效日", x.effectiveFrom, "date")}${field("effectiveTo", "失效日（可空）", x.effectiveTo, "date")}<label>状态<select name="status">${opts(
    [
      ["ACTIVE", "启用"],
      ["DISABLED", "停用"],
    ],
    x.status,
  )}</select></label><label>柔性超额是否保留预占<select name="reserveOnSoftExceeded">${opts(
    [
      ["true", "允许预占，余额可为负"],
      ["false", "暂不预占，授权后最终校验"],
    ],
    String(x.reserveOnSoftExceeded),
  )}</select></label><label>预算负责人（具名）<select name="extraApproverId">${opts(
    (org?.people || [])
      .filter((p) => p.active && ["主管", "管理员", "财务"].includes(p.role))
      .map((p) => [p.id, p.name + " · " + p.role]),
    x.extraApproverId,
  )}</select></label>${field("description", "制度说明", x.description)}${field("reason", "修改原因（必填）", "")}</div><button class="primary" ${editable ? "" : "disabled"}>保存预算配置</button><p id="r007-error" role="alert"></p></form>${
    b
      ? `<h4>期初模拟数据（显式创建，不代表通过真实费用审核）</h4><form id="r007-opening">${field("usedYuan", "模拟已使用（元）", "6000")}${field("reservedYuan", "模拟其他预占（元）", "2000")}<button ${editable ? "" : "disabled"}>为此预算创建一次期初模拟记录</button><p id="r007-opening-error" role="alert"></p></form><h4>预算流水</h4><div class="table-wrap"><table id="r007-ledger"><thead><tr><th>类型 / 时间</th><th>单号 / 版本</th><th>金额变化</th><th>事件 / 原因</th></tr></thead><tbody>${book.transactions
          .filter((t) => t.budgetId === b.budgetId)
          .map(
            (t) =>
              `<tr><td>${esc({ RESERVE: "预占", RELEASE: "释放", CONSUME: "转已使用", ADJUST: "调整" }[t.transactionType])}<small>${esc(displayTime(t.transactionTime))}</small></td><td>${esc(t.reimbursementId)}<small>报销v${t.reimbursementVersion} / 预算v${t.budgetVersion}</small></td><td>${yuan(t.amount)}<small>${t.scope === "CONFIG" ? "预算总额" : "本单占用合计"} ${yuan(t.beforeAmount)} → ${yuan(t.afterAmount)}</small></td><td>${esc(t.businessEventId)}<small>${esc(t.description)} · ${esc(t.actor)}</small></td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : ""
  }<details><summary>配置变更记录</summary><pre>${esc(JSON.stringify(book.changes, null, 2))}</pre></details></section>`;
}
