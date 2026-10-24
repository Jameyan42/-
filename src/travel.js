import {
  validateTravelStandard,
  travelChecks,
  travelLevels,
  employeeGrades,
} from "./travel-policy.js";
import { validateDateRange } from "./processing-dates.js";
export const travelPolicyVersion = "travel-demo-2026-01";
export const travelCategories = [
  "城际交通",
  "住宿",
  "餐补",
  "市内交通",
  "其他",
];
export const cityLevels = travelLevels;
export const travelGrades = employeeGrades;
const day = (n) => Date.parse(n + "T00:00:00Z") / 86400000;
const cents = (n) => Math.round(n * 100);
export function validateTrip(t, month = null) {
  if (
    !t ||
    typeof t.origin !== "string" ||
    !t.origin.trim() ||
    t.origin.length > 40 ||
    typeof t.destination !== "string" ||
    !t.destination.trim() ||
    t.destination.length > 40 ||
    !cityLevels.includes(t.cityLevel) ||
    !travelGrades.includes(t.grade)
  )
    throw Error("请完整填写出发地、目的地、城市档和职级档");
  validateDateRange(t.start, t.end);
  if (!t.start || !t.end || day(t.end) - day(t.start) > 30)
    throw Error("出差日期必须完整，最长31天");
  if (
    t.start.slice(0, 7) !== t.end.slice(0, 7) ||
    (month && t.start.slice(0, 7) !== month)
  )
    throw Error("本版行程需在同一计划月份内，请拆分跨月申请");
  return t;
}
export function tripDuration(t) {
  validateTrip(t);
  const nights = day(t.end) - day(t.start);
  return { days: nights + 1, nights };
}
export function travelRates(t) {
  validateTrip(t);
  return {
    hotel:
      t.cityLevel === "重点城市"
        ? t.grade === "管理人员"
          ? 700
          : 500
        : t.grade === "管理人员"
          ? 500
          : 350,
    meal: t.grade === "管理人员" ? 150 : 100,
  };
}
export function validateTravel(v, amount, type) {
  if (
    !v ||
    v.schema !== 1 ||
    v.policyVersion !== travelPolicyVersion ||
    type !== "差旅交通" ||
    !Array.isArray(v.lines) ||
    !v.lines.length ||
    v.lines.length > 20 ||
    typeof v.exceptionReason !== "string" ||
    v.exceptionReason.length > 500
  )
    throw Error("差旅明细需为差旅交通类型，包含1～20行及有效标准版本");
  validateTrip(v.trip);
  if (v.standard !== undefined) validateTravelStandard(v.standard, v.trip);
  const allocated = { 住宿: new Set(), 餐补: new Set() };
  let total = 0;
  for (const l of v.lines) {
    if (
      !l ||
      !travelCategories.includes(l.category) ||
      !Number.isFinite(l.amount) ||
      l.amount <= 0 ||
      l.amount > 1000000 ||
      Math.abs(cents(l.amount) / 100 - l.amount) > 1e-8 ||
      !Number.isInteger(l.units) ||
      l.units < 1 ||
      l.units > 31 ||
      typeof l.note !== "string" ||
      l.note.length > 100
    )
      throw Error(
        "每行需填写有效类别、正金额（最多两位小数）、数量和100字内备注",
      );
    validateDateRange(l.date, l.date);
    if (!l.date || l.date < v.trip.start || l.date > v.trip.end)
      throw Error("明细日期必须在出差行程内");
    if (["住宿", "餐补"].includes(l.category)) {
      const last = day(l.date) + l.units - (l.category === "住宿" ? 0 : 1);
      if (last > day(v.trip.end)) throw Error("住宿晚数或餐补天数超过行程范围");
      for (let i = 0; i < l.units; i++) {
        const d = day(l.date) + i;
        if (allocated[l.category].has(d))
          throw Error("住宿或餐补日期重复，请合并同日明细");
        allocated[l.category].add(d);
      }
    } else if (l.units !== 1)
      throw Error("交通和其他费用数量固定为1，金额填写该行合计");
    total += cents(l.amount);
  }
  if (
    total > 100000000 ||
    !Number.isFinite(amount) ||
    cents(amount) !== total ||
    Math.abs(cents(amount) / 100 - amount) > 1e-8
  )
    throw Error("报销总额必须与差旅明细合计一致且不超过100万元");
  return v;
}
export function travelWarnings(v) {
  if (v.standard)
    return travelChecks(v)
      .filter((x) => x.excess > 0)
      .map(
        (x) =>
          `${x.index ? "第" + x.index + "行" : x.date + "合计"}${x.category} ${x.actual.toFixed(2)}元，超过${x.rate}元/${x.unit} × ${x.units} 的差旅标准；超额${x.excess.toFixed(2)}元`,
      );
  const rates = travelRates(v.trip);
  return v.lines.flatMap((l, i) => {
    const cap =
      l.category === "住宿"
        ? rates.hotel
        : l.category === "餐补"
          ? rates.meal
          : 0;
    return cap && cents(l.amount) > cents(cap) * l.units
      ? [
          `第${i + 1}行${l.category} ${l.amount.toFixed(2)}元，超过${cap}元/${l.category === "住宿" ? "晚" : "天"} × ${l.units} 的示例标准`,
        ]
      : [];
  });
}
export function assertTravelSubmission(v, amount, type) {
  validateTravel(v, amount, type);
  if (travelWarnings(v).length && !v.exceptionReason.trim())
    throw Error("差旅超标请填写超标说明，再提交人工审核");
}
export function sameTrip(a, b) {
  return ["origin", "destination", "start", "end", "cityLevel", "grade"].every(
    (k) => a?.[k] === b?.[k],
  );
}
