import { GRADES } from "./types";
import type {
  AutoAuditResult,
  EmployeeGrade,
  FieldIssue,
  LodgingInput,
  StandardsCatalog,
} from "./types";

export const normalizeCity = (city: string): string =>
  city.normalize("NFKC").trim().replace(/\s/g, "").replace(/市$/, "");
export const isGrade = (value: string): value is EmployeeGrade =>
  (GRADES as readonly string[]).includes(value);
export type AmountParse =
  { ok: true; cents: number } | { ok: false; message: string };
export function parseYuan(value: string): AmountParse {
  if (typeof value !== "string")
    return { ok: false, message: "金额字段格式无效" };
  const text = value.trim();
  if (!text) return { ok: false, message: "请填写人民币金额" };
  if (text.startsWith("-")) return { ok: false, message: "金额不能为负数" };
  if (text.length > 40 || !/^\d+(?:\.\d{1,2})?$/.test(text))
    return {
      ok: false,
      message: "金额需为人民币数字，最多两位小数，不支持逗号或科学计数法",
    };
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    return { ok: false, message: "金额超过安全计算范围，请核对" };
  return { ok: true, cents: Number(cents) };
}
export function centsToYuan(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw Error("金额必须是非负整数分");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Gregorian calendar ordinal. No Date, time zone, milliseconds, or 24-hour division. */
export function calendarOrdinal(value: string): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const [year, month, date] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (date < 1 || date > lengths[month - 1]!) return null;
  const previous = year - 1;
  return (
    365 * previous +
    Math.floor(previous / 4) -
    Math.floor(previous / 100) +
    Math.floor(previous / 400) +
    lengths.slice(0, month - 1).reduce((a, b) => a + b, 0) +
    date
  );
}
export function calculateNights(
  checkIn: string,
  checkOut: string,
): number | null {
  const start = calendarOrdinal(checkIn),
    end = calendarOrdinal(checkOut);
  return start === null || end === null || end <= start ? null : end - start;
}
export function validateStandards(catalog: StandardsCatalog): void {
  if (
    !catalog ||
    !Number.isSafeInteger(catalog.version) ||
    catalog.version < 1 ||
    typeof catalog.updatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(catalog.updatedAt) ||
    !Number.isFinite(Date.parse(catalog.updatedAt)) ||
    new Date(catalog.updatedAt).toISOString() !== catalog.updatedAt ||
    !Array.isArray(catalog.rows) ||
    catalog.rows.length > 300
  )
    throw Error("模拟标准数据格式无效");
  const keys = new Set<string>(),
    ids = new Set<string>();
  for (const row of catalog.rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 80 ||
      typeof row.city !== "string" ||
      !row.city ||
      row.city.length > 40 ||
      normalizeCity(row.city) !== row.city ||
      !isGrade(row.grade) ||
      !Number.isSafeInteger(row.nightlyRateCents) ||
      row.nightlyRateCents < 0
    )
      throw Error("模拟标准的城市、职级或金额无效");
    const key = `${row.city}|${row.grade}`;
    if (keys.has(key) || ids.has(row.id))
      throw Error("城市/职级标准或标准编号重复");
    keys.add(key);
    ids.add(row.id);
  }
}

/** R001 is pure: no storage, clock, random IDs, network calls, or UI effects. */
export function auditLodging(
  rawInput: LodgingInput,
  catalog: StandardsCatalog,
): AutoAuditResult {
  const issues: FieldIssue[] = [];
  const incoming = (rawInput && typeof rawInput === "object"
    ? rawInput
    : {}) as unknown as Record<string, unknown>;
  const keys: (keyof LodgingInput)[] = [
    "documentId",
    "employeeName",
    "grade",
    "city",
    "checkIn",
    "checkOut",
    "amountYuan",
  ];
  const input = Object.fromEntries(
    keys.map((k) => [k, typeof incoming[k] === "string" ? incoming[k] : ""]),
  ) as unknown as LodgingInput;
  for (const field of keys)
    if (incoming[field] != null && typeof incoming[field] !== "string")
      issues.push({
        field,
        kind: "invalid",
        message: "字段格式错误：" + field,
      });
  const labels: Record<keyof LodgingInput, string> = {
    documentId: "单据编号",
    employeeName: "员工姓名",
    grade: "员工职级",
    city: "住宿城市",
    checkIn: "入住日期",
    checkOut: "退房日期",
    amountYuan: "申请报销金额",
  };
  for (const field of Object.keys(labels) as (keyof LodgingInput)[]) {
    if (typeof input[field] !== "string" || !input[field].trim())
      issues.push({
        field,
        kind: "missing",
        message: `请补充${labels[field]}`,
      });
    else if (
      input[field].length >
      (field === "employeeName" || field === "city" ? 40 : 80)
    )
      issues.push({
        field,
        kind: "invalid",
        message: `${labels[field]}长度超限`,
      });
  }
  if (input.grade && !isGrade(input.grade))
    issues.push({
      field: "grade",
      kind: "invalid",
      message: "员工职级无效，请选择配置的三种职级",
    });
  const nights = calculateNights(input.checkIn, input.checkOut);
  if (input.checkIn && calendarOrdinal(input.checkIn) === null)
    issues.push({
      field: "checkIn",
      kind: "invalid",
      message: "入住日期无效，请填写真实的日历日期",
    });
  if (input.checkOut && calendarOrdinal(input.checkOut) === null)
    issues.push({
      field: "checkOut",
      kind: "invalid",
      message: "退房日期无效，请填写真实的日历日期",
    });
  if (
    calendarOrdinal(input.checkIn) !== null &&
    calendarOrdinal(input.checkOut) !== null &&
    nights === null
  )
    issues.push({
      field: "checkOut",
      kind: "invalid",
      message: "日期错误：退房日期必须晚于入住日期，住宿晚数须大于0",
    });
  const parsed = parseYuan(input.amountYuan);
  if (input.amountYuan.trim() && !parsed.ok)
    issues.push({
      field: "amountYuan",
      kind: "invalid",
      message: parsed.message,
    });
  try {
    validateStandards(catalog);
  } catch {
    issues.push({
      field: "standards",
      kind: "invalid",
      message: "模拟标准数据异常，请恢复R001模拟数据后重试",
    });
  }
  const base = {
    ruleId: "R001" as const,
    ruleVersion: "v1" as const,
    nights,
    amountCents: parsed.ok ? parsed.cents : null,
  };
  if (issues.length)
    return {
      ...base,
      status: issues.some((i) => i.kind === "invalid")
        ? "invalid"
        : "incomplete",
      issues,
      reasons: [],
      standardSnapshot: null,
      limitCents: null,
      excessCents: null,
    };
  const city = normalizeCity(input.city),
    grade = input.grade as EmployeeGrade;
  if (!city)
    return {
      ...base,
      status: "invalid",
      issues: [
        { field: "city", kind: "invalid", message: "请填写有效城市名称" },
      ],
      reasons: [],
      standardSnapshot: null,
      limitCents: null,
      excessCents: null,
    };
  const matched = catalog.rows.find(
    (row) => row.city === city && row.grade === grade,
  );
  const snapshot = {
    catalogVersion: catalog.version,
    catalogUpdatedAt: catalog.updatedAt,
    city,
    grade,
    matched: !!matched,
    standardId: matched?.id ?? null,
    nightlyRateCents: matched?.nightlyRateCents ?? null,
  };
  const reasons: AutoAuditResult["reasons"][number][] = [];
  if (!matched) reasons.push("missing_standard");
  if (base.amountCents === 0) reasons.push("zero_amount");
  if (!matched)
    return {
      ...base,
      status: "review_required",
      issues: [],
      reasons,
      standardSnapshot: snapshot,
      limitCents: null,
      excessCents: null,
    };
  const limit = BigInt(matched.nightlyRateCents) * BigInt(nights!);
  if (limit > BigInt(Number.MAX_SAFE_INTEGER))
    return {
      ...base,
      status: "invalid",
      issues: [
        {
          field: "standards",
          kind: "invalid",
          message: "限额超过安全计算范围，未执行超标判断",
        },
      ],
      reasons: [],
      standardSnapshot: snapshot,
      limitCents: null,
      excessCents: null,
    };
  const limitCents = Number(limit),
    excessCents = Math.max(0, base.amountCents! - limitCents);
  if (excessCents > 0) reasons.push("over_limit");
  return {
    ...base,
    status: reasons.length ? "review_required" : "passed",
    issues: [],
    reasons,
    standardSnapshot: snapshot,
    limitCents,
    excessCents,
  };
}
