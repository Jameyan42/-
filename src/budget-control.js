import { budgetRows } from "./budget.js";
import { requestBalance } from "./requests.js";
export const budgetControlKey = "qingbao-budget-control-v1";
export const emptyBudgetControl = () => ({
  schema: 1,
  version: 1,
  periods: [],
  history: [],
});
const text = (v, n) => typeof v === "string" && !!v.trim() && v.length <= n;
export const validBudgetMonth = (v) =>
  typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const cents = (v) => Math.round(v * 100);
const limitOK = (v) =>
  Number.isFinite(v) &&
  v >= 0 &&
  v <= 10000000 &&
  Math.abs(v * 100 - cents(v)) < 1e-7;
const policyOK = (v) =>
  v && limitOK(v.limit) && ["warn", "block"].includes(v.mode);
export function validateBudgetLimits(limits) {
  if (
    !limits ||
    typeof limits !== "object" ||
    Array.isArray(limits) ||
    !Object.keys(limits).length ||
    Object.keys(limits).length > 50 ||
    Object.entries(limits).some(([k, v]) => !text(k, 60) || !limitOK(v))
  )
    throw Error("预算默认额度格式无效，原始数据未改动");
  return limits;
}
export function validateBudgetControl(c, limits) {
  if (
    !c ||
    c.schema !== 1 ||
    !Number.isInteger(c.version) ||
    c.version < 1 ||
    c.version > 1000000 ||
    !Array.isArray(c.periods) ||
    c.periods.length > 240 ||
    !Array.isArray(c.history) ||
    c.history.length > 500
  )
    throw Error("月度预算配置格式或容量无效");
  const keys = new Set(),
    ids = new Set();
  for (const p of c.periods) {
    const key = JSON.stringify([p?.department, p?.month]);
    if (
      !p ||
      !text(p.department, 60) ||
      !validBudgetMonth(p.month) ||
      !policyOK(p) ||
      keys.has(key) ||
      (limits && !Object.hasOwn(limits, p.department))
    )
      throw Error("月度预算部门、月份、额度或管控方式无效");
    keys.add(key);
  }
  for (const h of c.history) {
    if (
      !h ||
      !text(h.id, 60) ||
      ids.has(h.id) ||
      !Number.isInteger(h.version) ||
      h.version < 2 ||
      h.version > c.version ||
      !text(h.department, 60) ||
      !validBudgetMonth(h.month) ||
      !policyOK(h.before) ||
      !policyOK(h.after) ||
      !text(h.actorId, 60) ||
      !text(h.actorName, 30) ||
      h.role !== "财务" ||
      !text(h.reason, 200) ||
      h.reason.trim().length < 5 ||
      typeof h.at !== "string" ||
      h.at.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T/.test(h.at) ||
      !Number.isFinite(Date.parse(h.at))
    )
      throw Error("预算调整记录格式无效");
    ids.add(h.id);
  }
  if (JSON.stringify(c).length > 400000)
    throw Error("月度预算超过本地容量上限，不自动删除记录");
  return c;
}
export function effectiveBudget(limits, c, department, month) {
  validateBudgetLimits(limits);
  validateBudgetControl(c, limits);
  if (!validBudgetMonth(month) || !Object.hasOwn(limits, department))
    throw Error("预算归属部门或月份无效");
  const p = c.periods.find(
    (p) => p.department === department && p.month === month,
  );
  return p
    ? { ...p, source: "本月独立额度" }
    : {
        department,
        month,
        limit: limits[department],
        mode: "warn",
        source: "继承旧默认额度",
      };
}
export function setMonthlyBudget(c, limits, input, actor) {
  if (!actor?.active || actor.role !== "财务")
    throw Error("仅财务可调整月度预算");
  validateBudgetControl(c, limits);
  const department = String(input.department || ""),
    month = input.month,
    limit = Number(input.limit),
    mode = input.mode,
    reason = String(input.reason || "").trim();
  const before = effectiveBudget(limits, c, department, month);
  if (!policyOK({ limit, mode }) || reason.length < 5 || reason.length > 200)
    throw Error("请填写有效额度、管控方式和5～200字调整原因");
  if (c.history.length >= 500)
    throw Error("预算调整记录已达500条，未自动删除历史");
  const p = { department, month, limit, mode },
    next = {
      schema: 1,
      version: c.version + 1,
      periods: [
        ...c.periods.filter(
          (x) => x.department !== department || x.month !== month,
        ),
        p,
      ],
      history: [
        ...c.history,
        {
          id: crypto.randomUUID(),
          version: c.version + 1,
          department,
          month,
          before: { limit: before.limit, mode: before.mode },
          after: { limit, mode },
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          at: new Date().toISOString(),
          reason,
        },
      ],
    };
  return validateBudgetControl(next, limits);
}
export function persistBudgetControl(storage, c, limits) {
  validateBudgetControl(c, limits);
  try {
    storage.setItem(budgetControlKey, JSON.stringify(c));
  } catch {
    throw Error("预算保存失败或容量不足，原预算未改动");
  }
  return c;
}
export function monthlyBudgetRows(
  items,
  limits,
  month,
  requests = [],
  c = emptyBudgetControl(),
) {
  validateBudgetLimits(limits);
  validateBudgetControl(c, limits);
  const settings = Object.fromEntries(
    Object.keys(limits).map((d) => [d, effectiveBudget(limits, c, d, month)]),
  );
  return budgetRows(
    items,
    Object.fromEntries(Object.entries(settings).map(([d, p]) => [d, p.limit])),
    month,
    requests,
  ).map((r) => ({
    ...r,
    month,
    mode: settings[r.department].mode,
    source: settings[r.department].source,
  }));
}
export function budgetLedger(items, requests, department, month) {
  if (!validBudgetMonth(month)) throw Error("请选择有效预算月份");
  const active = items.filter(
    (x) =>
      x.department === department &&
      x.date?.slice(0, 7) === month &&
      !["草稿", "已退回", "已撤回"].includes(x.status),
  );
  return [
    ...active.map((d) => ({
      kind: "expense",
      id: d.id,
      name: d.name,
      employee: d.employee,
      status: d.status,
      category: d.status === "已付款" ? "已付款" : "报销在途",
      amount: d.amount,
      approvedAmount: null,
      linkedUsed: null,
    })),
    ...requests
      .filter(
        (r) =>
          r.department === department &&
          r.month === month &&
          r.status === "已批准",
      )
      .map((r) => {
        const b = requestBalance(r, items);
        return {
          kind: "request",
          id: r.id,
          name: r.name,
          employee: r.employee,
          status: r.status,
          category: "申请剩余预留",
          amount: b.remaining,
          approvedAmount: r.amount,
          linkedUsed: b.used,
        };
      })
      .filter((r) => r.amount > 0),
  ];
}
export function assertBudgetIncrease(
  beforeItems,
  afterItems,
  beforeRequests,
  afterRequests,
  limits,
  c,
) {
  validateBudgetLimits(limits);
  validateBudgetControl(c, limits);
  const groups = new Map();
  for (const d of [
    ...beforeItems,
    ...afterItems,
    ...beforeRequests,
    ...afterRequests,
  ]) {
    const month = d.month || d.date?.slice(0, 7);
    if (validBudgetMonth(month))
      groups.set(JSON.stringify([d.department, month]), {
        department: d.department,
        month,
      });
  }
  const errors = [];
  for (const { department, month } of groups.values()) {
    if (!Object.hasOwn(limits, department))
      throw Error("预算归属部门缺少配置，请先由财务设置");
    const p = effectiveBudget(limits, c, department, month);
    if (p.mode !== "block") continue;
    const old = budgetRows(
        beforeItems,
        { [department]: p.limit },
        month,
        beforeRequests,
      )[0],
      next = budgetRows(
        afterItems,
        { [department]: p.limit },
        month,
        afterRequests,
      )[0];
    if (
      cents(next.paid + next.reserved) > cents(old.paid + old.reserved) &&
      cents(next.paid + next.reserved) > cents(p.limit)
    )
      errors.push(
        `${department} ${month}新增占用超预算：额度${p.limit.toFixed(2)}元，预计占用${(next.paid + next.reserved).toFixed(2)}元；请减少金额或由财务调整本月额度`,
      );
  }
  if (errors.length) throw Error(errors.join("；"));
}
const cell = (v) =>
  '"' +
  String(v ?? "")
    .replace(/^\s*[=+@-]/, "'$&")
    .replaceAll('"', '""') +
  '"';
export function budgetCsv(rows, ledger = false) {
  const data = ledger
    ? [
        [
          "类型",
          "单号",
          "事项",
          "申请人",
          "状态",
          "占用分类",
          "本月贡献金额",
          "批准申请总额",
          "已核销金额",
        ],
        ...rows.map((r) => [
          r.kind === "expense" ? "报销" : "费用申请",
          r.id,
          r.name,
          r.employee,
          r.status,
          r.category,
          r.amount,
          r.approvedAmount,
          r.linkedUsed,
        ]),
      ]
    : [
        [
          "部门",
          "月份",
          "本月额度",
          "管控方式",
          "额度来源",
          "已付款",
          "报销在途",
          "申请剩余预留",
          "可用余额",
        ],
        ...rows.map((r) => [
          r.department,
          r.month,
          r.limit,
          r.mode === "block" ? "拦截新增占用" : "软预警",
          r.source,
          r.paid,
          r.reimbursementReserved,
          r.applicationReserved,
          r.available,
        ]),
      ];
  return "\ufeff" + data.map((r) => r.map(cell).join(",")).join("\r\n");
}
