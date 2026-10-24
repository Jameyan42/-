import { requestBalance } from "./requests.js";
export const defaultBudgets = { 销售部: 20000, 产品部: 15000, 运营部: 10000 };
export function budgetRows(items, limits, month, requests = []) {
  return Object.entries(limits).map(([department, limit]) => {
    const rows = items.filter(
      (x) =>
        x.department === department &&
        x.date.startsWith(month) &&
        !["已退回", "草稿", "已撤回"].includes(x.status),
    );
    const paid =
      rows
        .filter((x) => x.status === "已付款")
        .reduce((s, x) => s + Math.round(x.amount * 100), 0) / 100;
    const reimbursementReserved =
      rows
        .filter((x) => x.status !== "已付款")
        .reduce((s, x) => s + Math.round(x.amount * 100), 0) / 100;
    const applicationReserved =
      requests
        .filter(
          (r) =>
            r.department === department &&
            r.month === month &&
            r.status === "已批准",
        )
        .reduce(
          (s, r) => s + Math.round(requestBalance(r, items).remaining * 100),
          0,
        ) / 100;
    const reserved =
      Math.round((reimbursementReserved + applicationReserved) * 100) / 100;
    return {
      department,
      limit,
      paid,
      reserved,
      reimbursementReserved,
      applicationReserved,
      available:
        (Math.round(limit * 100) -
          Math.round(paid * 100) -
          Math.round(reserved * 100)) /
        100,
      ratio: limit ? (paid + reserved) / limit : paid + reserved > 0 ? 1 : 0,
    };
  });
}
