export const inactiveStatuses = ["草稿", "已退回", "已撤回"];
export function withdraw(item, employee, reason) {
  if (item.employee !== employee || item.status !== "待主管审批")
    throw new Error("仅可撤回本人尚未通过主管审批的报销");
  if (
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.trim().length > 200
  )
    throw new Error("请填写 1～200 字撤回原因");
  return {
    ...item,
    status: "已撤回",
    history: [
      ...item.history,
      {
        text: `员工撤回：${reason.trim()}`,
        time: new Date().toLocaleString("zh-CN"),
      },
    ],
  };
}
export function invoiceRows(items, employee = null) {
  const visible = items.filter(
    (x) =>
      (!employee || x.employee === employee) &&
      (x.invoice || x.receipt) &&
      x.status !== "草稿",
  );
  return visible.map((x) => ({
    ...x,
    duplicate:
      !!x.invoice &&
      !inactiveStatuses.includes(x.status) &&
      items.some(
        (other) =>
          other.id !== x.id &&
          !inactiveStatuses.includes(other.status) &&
          other.invoice === x.invoice,
      ),
  }));
}
export function validatePayment(data) {
  if (
    !data ||
    typeof data.reference !== "string" ||
    data.reference.trim().length < 4 ||
    data.reference.trim().length > 60 ||
    !["银行转账", "其他线下付款"].includes(data.method) ||
    typeof data.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
    Number.isNaN(Date.parse(data.date)) ||
    new Date(data.date).toISOString().slice(0, 10) !== data.date
  )
    throw new Error("请填写有效付款日期、方式和 4～60 字付款参考号");
  if (data.confirmed !== true)
    throw new Error("请确认这里只登记付款记录，不会实际转账");
  return {
    reference: data.reference.trim(),
    date: data.date,
    method: data.method,
    confirmed: true,
  };
}
