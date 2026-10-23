export function validateDateRange(from = "", to = "") {
  const valid = (value) =>
    typeof value === "string" &&
    (value === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number(value.slice(0, 4)) > 0 &&
        Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value));
  if (!valid(from) || !valid(to)) throw Error("请输入有效的开始和结束日期");
  if (from && to && from > to) throw Error("开始日期不能晚于结束日期");
  return { from, to };
}
export function processingDate(at) {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  return `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function processingTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "浏览器本地时区";
}
export function withinDateRange(at, range) {
  const day = processingDate(at);
  return (
    day !== null &&
    (!range.from || day >= range.from) &&
    (!range.to || day <= range.to)
  );
}
export function datePreset(preset, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw Error("当前日期无效");
  if (preset === "all") return { from: "", to: "" };
  const end = new Date(now),
    start = new Date(now);
  if (preset === "today")
    return { from: processingDate(start), to: processingDate(end) };
  if (preset === "last7") start.setDate(start.getDate() - 6);
  else if (preset === "month") start.setDate(1);
  else if (preset === "lastMonth") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    end.setDate(0);
  } else throw Error("未知处理时间段");
  return validateDateRange(processingDate(start), processingDate(end));
}
