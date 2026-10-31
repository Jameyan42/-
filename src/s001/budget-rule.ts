// @ts-ignore Reuse existing monthly validation. Legacy balances use a different scope and are not mixed.
import { validBudgetMonth } from "../budget-control.js";
import { calendarOrdinal, parseYuan, centsToYuan } from "../r001/rule";
import {
  defaultBudgetBook,
  type Budget,
  type BudgetBook,
  type Allocation,
  type BudgetEscalation,
} from "./budget-config";
import type { Input, Context, RuleResult } from "./types";
import type { Org } from "./workflow-config";
export const zeroAllocation = (): Allocation => ({
  reserved: 0,
  used: 0,
  revision: 0,
  budgetId: "",
  budgetVersion: 0,
});
export const safe = (v: bigint) => {
  if (
    v > BigInt(Number.MAX_SAFE_INTEGER) ||
    v < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw Error("预算金额累计超出安全整数范围");
  return Number(v);
};
export const validTime = (s: string) =>
  typeof s === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString() === s;
export function validateBudgetDefinitions(list: Budget[]) {
  if (
    !Array.isArray(list) ||
    list.length > 500 ||
    new Set(list.map((b) => b.budgetId)).size !== list.length
  )
    throw Error("预算编号重复或配置容量超限");
  const text = (x: unknown) =>
    typeof x === "string" && x.trim().length > 0 && x.length <= 500;
  for (const b of list)
    if (
      !text(b.budgetId) ||
      b.budgetId.length > 60 ||
      !text(b.companyId) ||
      !text(b.departmentId) ||
      !text(b.expenseType) ||
      !text(b.description) ||
      b.periodType !== "MONTH" ||
      !validBudgetMonth(b.budgetPeriod) ||
      !Number.isSafeInteger(b.budgetAmount) ||
      b.budgetAmount < 0 ||
      !Number.isSafeInteger(b.version) ||
      b.version < 1 ||
      !["HARD", "SOFT", "WARNING"].includes(b.controlMode) ||
      !["ACTIVE", "DISABLED"].includes(b.status) ||
      !text(b.currency) ||
      calendarOrdinal(b.effectiveFrom) === null ||
      (b.effectiveTo !== null &&
        (calendarOrdinal(b.effectiveTo) === null ||
          b.effectiveTo < b.effectiveFrom)) ||
      !Array.isArray(b.warningThresholds) ||
      b.warningThresholds.length > 10 ||
      b.warningThresholds.some(
        (n) => !Number.isInteger(n) || n < 1 || n > 1000,
      ) ||
      typeof b.reserveOnSoftExceeded !== "boolean" ||
      !text(b.extraApproverId)
    )
      throw Error("预算字段、金额分、期间或控制政策无效");
}
export function allocations(book: BudgetBook) {
  const rows = new Map<string, Allocation>();
  for (const t of book.transactions) {
    if (t.scope !== "CLAIM") continue;
    const old = rows.get(t.reimbursementId) || zeroAllocation();
    if (JSON.stringify(old) !== JSON.stringify(t.before))
      throw Error("预算流水前后不连续，暂停计算");
    if (
      t.beforeAmount !== safe(BigInt(old.reserved) + BigInt(old.used)) ||
      t.afterAmount !== safe(BigInt(t.after.reserved) + BigInt(t.after.used))
    )
      throw Error("预算流水金额不连续");
    rows.set(t.reimbursementId, structuredClone(t.after));
  }
  return rows;
}
export function validateBudgetBook(book: BudgetBook) {
  if (
    !book ||
    book.schema !== 1 ||
    !Number.isSafeInteger(book.version) ||
    book.version < 1 ||
    !Array.isArray(book.transactions) ||
    book.transactions.length > 1500 ||
    !Array.isArray(book.events) ||
    book.events.length > 1500 ||
    !Array.isArray(book.changes) ||
    book.changes.length > 100
  )
    throw Error("预算数据格式或容量无效");
  validateBudgetDefinitions(book.budgets);
  if (
    new Set(book.transactions.map((t) => t.transactionId)).size !==
      book.transactions.length ||
    new Set(book.transactions.map((t) => t.businessEventId)).size !==
      book.transactions.length ||
    new Set(book.events.map((e) => e.id)).size !== book.events.length
  )
    throw Error("预算业务事件或流水重复");
  for (const t of book.transactions) {
    if (
      !t.transactionId ||
      !t.budgetId ||
      !t.reimbursementId ||
      !["RESERVE", "RELEASE", "CONSUME", "ADJUST"].includes(
        t.transactionType,
      ) ||
      !["CLAIM", "CONFIG"].includes(t.scope) ||
      !Number.isSafeInteger(t.amount) ||
      !Number.isSafeInteger(t.beforeAmount) ||
      !Number.isSafeInteger(t.afterAmount) ||
      !validTime(t.transactionTime) ||
      !t.businessEventId ||
      !t.description?.trim() ||
      !t.actor?.trim() ||
      !Number.isSafeInteger(t.reimbursementVersion) ||
      !Number.isSafeInteger(t.budgetVersion)
    )
      throw Error("预算流水字段无效");
    for (const a of [t.before, t.after])
      if (
        !a ||
        !Number.isSafeInteger(a.reserved) ||
        !Number.isSafeInteger(a.used) ||
        a.reserved < 0 ||
        a.used < 0 ||
        (a.reserved > 0 && a.used > 0) ||
        !Number.isSafeInteger(a.revision) ||
        !Number.isSafeInteger(a.budgetVersion) ||
        typeof a.budgetId !== "string"
      )
        throw Error("预算占用状态无效");
  }
  for (const e of book.events)
    if (!e.id || !e.fingerprint || !validTime(e.at))
      throw Error("预算幂等事件格式无效");
  for (const h of book.changes) {
    if (
      !validTime(h.at) ||
      !h.actor?.trim() ||
      !["财务", "管理员"].includes(h.role) ||
      !h.reason?.trim()
    )
      throw Error("预算调整日志无效");
    validateBudgetDefinitions(h.before);
    validateBudgetDefinitions(h.after);
  }
  for (const t of book.transactions) {
    if (
      !book.budgets.some((b) => b.budgetId === t.budgetId) ||
      !book.events.some(
        (e) =>
          t.businessEventId === e.id ||
          t.businessEventId.startsWith(e.id + ":"),
      )
    )
      throw Error("预算流水缺少预算或业务事件来源");
    if (t.scope === "CONFIG") {
      if (
        t.transactionType !== "ADJUST" ||
        t.reimbursementId !== "CONFIG" ||
        t.amount !== t.afterAmount - t.beforeAmount
      )
        throw Error("配置调整流水无效");
      continue;
    }
    const a = t.before,
      b = t.after;
    if (t.transactionType === "CONSUME") {
      if (
        a.used ||
        b.reserved ||
        b.used !== a.reserved ||
        t.amount !== a.reserved
      )
        throw Error("预算结转流水不能重复或凭空增加使用");
    } else {
      if (a.used || b.used) throw Error("非结转事件不得改变已使用预算");
      if (
        t.transactionType === "RELEASE" &&
        (b.reserved !== 0 || t.amount !== a.reserved)
      )
        throw Error("释放额度流水无效");
      if (
        ["ADJUST", "RESERVE"].includes(t.transactionType) &&
        t.amount !== b.reserved - a.reserved
      )
        throw Error("预占差额流水无效");
    }
  }
  allocations(book);
}
export function budgetPeriod(d: Input) {
  const start = d.businessDate || (d.expenseType === "住宿费" ? d.checkIn : "");
  if (calendarOrdinal(start) === null)
    return {
      period: "",
      date: start,
      error: "缺少有效费用发生日期，不能用提交日期推测月份",
    };
  if (
    d.expenseType === "住宿费" &&
    d.checkIn &&
    d.checkOut &&
    calendarOrdinal(d.checkIn) !== null &&
    calendarOrdinal(d.checkOut) !== null &&
    d.checkIn.slice(0, 7) !== d.checkOut.slice(0, 7)
  )
    return {
      period: start.slice(0, 7),
      date: start,
      error: "住宿跨越两个月，需人工确认归属，不自动拆分金额",
      crossMonth: true,
    };
  return { period: start.slice(0, 7), date: start, error: "" };
}
export function departmentId(d: Input, org?: Org) {
  if (d.departmentId) {
    const dep = org?.departments.find((x) => x.id === d.departmentId);
    if (org && (!dep || dep.name !== d.department)) return "";
    return d.departmentId;
  }
  return org?.departments.find((x) => x.name === d.department)?.id || "";
}
export function matchBudget(d: Input, book: BudgetBook, org?: Org) {
  const p = budgetPeriod(d),
    dept = departmentId(d, org);
  if (
    p.error ||
    !d.companyId ||
    !dept ||
    d.currency !== "CNY" ||
    !parseYuan(d.amountYuan).ok
  )
    return {
      budget: null as Budget | null,
      matches: [] as Budget[],
      period: p.period,
      departmentId: dept,
      status: p.crossMonth ? "REVIEW" : "INSUFFICIENT_DATA",
      message:
        p.error || "法人、部门编号、人民币金额或币种不足，不能默认无限额度",
    };
  // Exact dimensions only: no implicit group/department pool sharing.
  const matches = book.budgets.filter(
    (b) =>
      b.status === "ACTIVE" &&
      b.companyId === d.companyId &&
      b.departmentId === dept &&
      b.expenseType === d.expenseType &&
      b.budgetPeriod === p.period &&
      p.date >= b.effectiveFrom &&
      (!b.effectiveTo || p.date <= b.effectiveTo),
  );
  if (matches.length !== 1)
    return {
      budget: null,
      matches,
      period: p.period,
      departmentId: dept,
      status: matches.length ? "REVIEW" : "INSUFFICIENT_DATA",
      message: matches.length
        ? "同一维度存在冲突预算，不能随机选择"
        : "未匹配有效法人、部门、费用类型及月份预算",
    };
  if (matches[0]!.currency !== d.currency)
    return {
      budget: null,
      matches,
      period: p.period,
      departmentId: dept,
      status: "INSUFFICIENT_DATA",
      message: "币种不一致且无确认汇率，不能比较预算",
    };
  return {
    budget: matches[0]!,
    matches,
    period: p.period,
    departmentId: dept,
    status: "PASS",
    message: "完整预算维度匹配",
  };
}
export function budgetTotals(book: BudgetBook, budgetId: string) {
  const rows = [...allocations(book)].filter(
    ([, a]) => a.budgetId === budgetId,
  );
  const reserved = safe(rows.reduce((s, [, a]) => s + BigInt(a.reserved), 0n)),
    used = safe(rows.reduce((s, [, a]) => s + BigInt(a.used), 0n));
  safe(BigInt(reserved) + BigInt(used));
  return { reserved, used, rows };
}
export function budgetRule(d: Input, c: Context): RuleResult {
  const selection=c.ruleSelections?.find(x=>x.ruleId==='R007');
  if(selection?.error)return {ruleId:'R007',ruleKey:'budget.capacity',ruleName:'费用预算与额度控制',status:'ERROR',severity:'high',message:selection.error,evidence:{configurationError:true},suggestedAction:'补充或恢复有效预算策略后重新审核',configuration:structuredClone(selection)};
  const book = c.budgetBook || defaultBudgetBook();
  validateBudgetBook(book);
  const match = matchBudget(d, book, c.budgetOrg || c.workflow?.org),
    n = parseYuan(d.amountYuan),
    evidence: any = {
      budget: match.budget,
      matches: match.matches,
      departmentId: match.departmentId,
      period: match.period,
      bookVersion: book.version,
      amountCents: n.ok ? n.cents : null,
    };
  const out = (status: RuleResult["status"], message: string): RuleResult => ({
    ruleId: "R007",
    ruleKey: "budget.capacity",
    ruleName: "费用预算与额度控制",
    status,
    severity:
      status === "PASS"
        ? evidence.warnings?.length
          ? "low"
          : "none"
        : status === "REVIEW"
          ? "medium"
          : "high",
    message,
    evidence,
    suggestedAction:
      status === "PASS"
        ? "按必要审批及财务最终确认继续；审核本身不扣减额度"
        : "核实预算归属、调整正式模拟预算或取得具名预算负责人授权后重新审核；刚性预算不能普通放行",
  });
  if (!match.budget)
    return out(match.status as RuleResult["status"], match.message);
  const b = match.budget,
    t = budgetTotals(book, b.budgetId),
    own = allocations(book).get(d.id) || zeroAllocation(),
    ownReserved = own.budgetId === b.budgetId ? own.reserved : 0,
    ownUsed = own.budgetId === b.budgetId ? own.used : 0,
    otherReserved = t.reserved - ownReserved,
    otherUsed = t.used - ownUsed;
  const available = safe(
      BigInt(b.budgetAmount) - BigInt(otherReserved) - BigInt(otherUsed),
    ),
    projected = safe(BigInt(available) - BigInt(n.ok ? n.cents : 0)),
    excess = Math.max(0, -projected),
    occupied = safe(
      BigInt(otherReserved) + BigInt(otherUsed) + BigInt(n.ok ? n.cents : 0),
    );
  const ratio = (x: number) =>
    b.budgetAmount === 0
      ? null
      : safe((BigInt(x) * 10000n) / BigInt(b.budgetAmount));
  const warnings = b.warningThresholds.filter((x) =>
    b.budgetAmount === 0
      ? occupied > 0
      : x === 100
        ? BigInt(occupied) > BigInt(b.budgetAmount)
        : BigInt(occupied) * 100n >= BigInt(b.budgetAmount) * BigInt(x),
  );
  Object.assign(evidence, {
    totalCents: b.budgetAmount,
    usedCents: t.used,
    reservedCents: t.reserved,
    otherUsedCents: otherUsed,
    otherReservedCents: otherReserved,
    ownReservedCents: ownReserved,
    ownUsedCents: ownUsed,
    currentAvailableCents: safe(
      BigInt(b.budgetAmount) - BigInt(t.used) - BigInt(t.reserved),
    ),
    availableForCurrentCents: available,
    projectedRemainingCents: projected,
    excessCents: excess,
    currentUsageBps: ratio(safe(BigInt(t.used) + BigInt(t.reserved))),
    projectedUsageBps: ratio(occupied),
    warnings,
    controlMode: b.controlMode,
    zeroBudget: b.budgetAmount === 0,
  });
  if (excess && b.controlMode === "HARD")
    return out(
      "BLOCK",
      `申请超出可用预算${centsToYuan(excess)}元，刚性控制禁止新增占用或批准`,
    );
  if (excess && b.controlMode === "SOFT")
    return out(
      "REVIEW",
      `申请超出可用预算${centsToYuan(excess)}元，需预算负责人额外授权；金额风险不会因审批而消失`,
    );
  return out(
    "PASS",
    warnings.length
      ? `预算允许继续，预计使用率${evidence.projectedUsageBps === null ? "因零预算不定义" : (evidence.projectedUsageBps / 100).toFixed(2) + "%"}，命中${warnings.join("/")}%预警`
      : "本次申请在可用预算范围内，审核不改变预算占用",
  );
}
export function requiredBudgetEscalation(
  d: Input,
  c: Context,
  org: Org,
): BudgetEscalation | null {
  const r = budgetRule(d, c),
    e = r.evidence as any;
  if (r.status !== "REVIEW" || e.controlMode !== "SOFT" || !e.excessCents)
    return null;
  const p = org.people.find(
    (x) =>
      x.id === e.budget.extraApproverId &&
      x.active &&
      ["主管", "管理员", "财务"].includes(x.role),
  );
  if (!p) throw Error("柔性预算缺少有效具名预算负责人授权配置");
  return {
    ...(c.ruleSelections?.find(x=>x.ruleId==='R007')?.version ? {ruleVersionId:c.ruleSelections.find(x=>x.ruleId==='R007')!.version!.versionId} : {}),
    budgetId: e.budget.budgetId,
    budgetVersion: e.budget.version,
    amountCents: e.amountCents,
    excessCents: e.excessCents,
    ownerId: p.id,
    ownerName: p.name,
    ownerRole: p.role,
    at: c.at,
  };
}
export function sameEscalation(
  a: BudgetEscalation | undefined,
  b: BudgetEscalation | null | undefined,
) {
  return (
    !!a &&
    !!b &&
    a.ruleVersionId === b.ruleVersionId &&
    a.budgetId === b.budgetId &&
    a.budgetVersion === b.budgetVersion &&
    a.amountCents === b.amountCents &&
    a.ownerId === b.ownerId &&
    a.excessCents >= b.excessCents
  );
}
