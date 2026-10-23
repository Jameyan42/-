export const defaultInvoiceBuyer = { name: "星河科技", taxId: "" };
export const invoiceTextFields = [
  ["number", "发票号码", 20],
  ["code", "发票代码", 12],
  ["date", "开票日期", 10],
  ["buyerName", "购买方名称", 100],
  ["buyerTaxId", "购买方税号", 24],
  ["sellerName", "销售方名称", 100],
  ["sellerTaxId", "销售方税号", 24],
];
export const normalizeTitle = (v) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(/\s/g, "");
const text = (v, n) => typeof v === "string" && v.length <= n;
const money = (v) =>
  Number.isFinite(v) &&
  v >= 0 &&
  v <= 1000000 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 1e-7;
const date = (v) =>
  text(v, 10) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function validateInvoiceBuyer(v) {
  if (
    !v ||
    !text(v.name, 100) ||
    !v.name.trim() ||
    !text(v.taxId, 24) ||
    (v.taxId && !/^[A-Z0-9-]{6,24}$/.test(v.taxId))
  )
    throw Error(
      "请填写有效企业抬头及税号（虚构税号可含短横线，空税号不做税号一致性核对）",
    );
  return v;
}
export function effectiveInvoiceBuyer(policy = {}) {
  return validateInvoiceBuyer(policy.invoiceBuyer ?? defaultInvoiceBuyer);
}
export function validateInvoices(bundle) {
  if (
    !bundle ||
    bundle.schema !== 1 ||
    !Array.isArray(bundle.records) ||
    bundle.records.length > 5
  )
    throw Error("每单最多采集5张结构化发票");
  const ids = new Set();
  for (const r of bundle.records) {
    if (
      !r ||
      !text(r.id, 60) ||
      !r.id ||
      ids.has(r.id) ||
      invoiceTextFields.some(([k, , max]) => !text(r[k], max)) ||
      !/^\d{8,20}$/.test(r.number) ||
      (r.code && !/^\d{10}(?:\d{2})?$/.test(r.code)) ||
      (r.date && !date(r.date)) ||
      [r.buyerTaxId, r.sellerTaxId].some(
        (v) => v && !/^[A-Z0-9-]{6,24}$/.test(v),
      ) ||
      !money(r.amount) ||
      r.amount <= 0 ||
      [r.netAmount, r.taxAmount].some((v) => v !== null && !money(v)) ||
      (r.attachmentId !== undefined &&
        (!text(r.attachmentId, 60) || !r.attachmentId)) ||
      !r.capture ||
      !["manual", "ocr-assisted"].includes(r.capture.method) ||
      r.capture.confirmed !== true ||
      !text(r.capture.at, 40) ||
      !Number.isFinite(Date.parse(r.capture.at)) ||
      !text(r.capture.sourceName, 120) ||
      (r.capture.method === "ocr-assisted" &&
        r.capture.engine !== "Tesseract.js")
    )
      throw Error(
        "票据字段无效：需8～20位号码、有效正金额、日期/税号及人工确认记录",
      );
    ids.add(r.id);
  }
  if (JSON.stringify(bundle).length > 18000)
    throw Error("结构化票据超过容量限制");
  return bundle;
}
// References are local to the same document; never infer a match from filenames.
export function validateInvoiceAttachments(bundle, attachments = []) {
  if (bundle === undefined) return;
  validateInvoices(bundle);
  const linked = new Set();
  for (const r of bundle.records) {
    if (!r.attachmentId) continue;
    const f = attachments.find((f) => f.id === r.attachmentId);
    if (!f || f.kind !== "发票")
      throw Error("票面关联原件不存在或不是发票分类，请先解除关联再移除或改类");
    if (linked.has(r.attachmentId))
      throw Error("同一个原件只能关联一张票面记录；多票合并文件请拆分后上传");
    linked.add(r.attachmentId);
  }
}
export const emptyInvoices = () => ({ schema: 1, records: [] });
export function invoiceRecord(
  input,
  method = "manual",
  sourceName = "",
  id = "",
) {
  const r = {
    id: id || crypto.randomUUID(),
    ...Object.fromEntries(
      invoiceTextFields.map(([key]) => [
        key,
        String(input[key] ?? "")
          .normalize("NFKC")
          .trim(),
      ]),
    ),
    ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
    amount: Number(input.amount),
    netAmount:
      input.netAmount === "" || input.netAmount == null
        ? null
        : Number(input.netAmount),
    taxAmount:
      input.taxAmount === "" || input.taxAmount == null
        ? null
        : Number(input.taxAmount),
    capture: {
      method,
      confirmed: true,
      at: new Date().toISOString(),
      sourceName: String(sourceName).slice(0, 120),
      ...(method === "ocr-assisted" ? { engine: "Tesseract.js" } : {}),
    },
  };
  r.buyerTaxId = r.buyerTaxId.toUpperCase().replace(/\s/g, "");
  r.sellerTaxId = r.sellerTaxId.toUpperCase().replace(/\s/g, "");
  validateInvoices({ schema: 1, records: [r] });
  return r;
}
export function buyerComparison(r, buyer) {
  validateInvoiceBuyer(buyer);
  return {
    name: !r.buyerName
      ? "缺少抬头"
      : normalizeTitle(r.buyerName) === normalizeTitle(buyer.name)
        ? "抬头一致"
        : "抬头不一致",
    tax: !buyer.taxId
      ? "基准未设税号"
      : !r.buyerTaxId
        ? "缺少购买方税号"
        : r.buyerTaxId.toUpperCase() === buyer.taxId.toUpperCase()
          ? "税号一致"
          : "税号不一致",
  };
}
export const invoiceTotal = (bundle) =>
  (bundle?.records || []).reduce((n, r) => n + Math.round(r.amount * 100), 0) /
  100;
const inactive = new Set(["草稿", "已退回", "已撤回"]);
export function invoiceEvidence(
  kind,
  doc,
  { items = [], enterprise } = {},
  buyer = defaultInvoiceBuyer,
) {
  const records = doc.invoices?.records || [],
    out = { buyer: [], arithmetic: [], duplicates: [], total: null };
  if (!records.length) return out;
  validateInvoices(doc.invoices);
  for (const r of records) {
    const c = buyerComparison(r, buyer);
    if (
      !r.buyerName ||
      c.name !== "抬头一致" ||
      (buyer.taxId && c.tax !== "税号一致")
    )
      out.buyer.push(
        `${r.number}：${c.name}${buyer.taxId ? " / " + c.tax : ""}；票面 ${r.buyerName || "未采集"}${buyer.taxId ? " / " + (r.buyerTaxId || "未采集") : ""}`,
      );
    if (
      r.netAmount !== null &&
      r.taxAmount !== null &&
      Math.round(r.netAmount * 100) + Math.round(r.taxAmount * 100) !==
        Math.round(r.amount * 100)
    )
      out.arithmetic.push(
        `${r.number}：不含税 ${r.netAmount} + 税额 ${r.taxAmount} ≠ 合计 ${r.amount}`,
      );
  }
  const count = new Map();
  records.forEach((r) => count.set(r.number, (count.get(r.number) || 0) + 1));
  for (const [no, n] of count)
    if (n > 1) out.duplicates.push(`${no}：本单重复${n}次`);
  for (const [otherKind, rows] of [
    ["expense", items],
    ["corporate", enterprise?.payments || []],
  ])
    for (const other of rows) {
      if (
        (otherKind === kind && other.id === doc.id) ||
        inactive.has(other.status)
      )
        continue;
      const nums =
        other.invoices?.records?.map((r) => r.number) ||
        (other.invoice ? [other.invoice] : []);
      for (const no of count.keys())
        if (nums.includes(no))
          out.duplicates.push(
            `${no}：${otherKind === "expense" ? "报销" : "对公"} ${other.id}`,
          );
    }
  out.total = invoiceTotal(doc.invoices);
  return out;
}
export function structuredInvoiceRows(items = [], payments = []) {
  const docs = [
    ...items.map((doc) => ({ kind: "expense", doc })),
    ...payments.map((doc) => ({ kind: "corporate", doc })),
  ];
  return docs
    .filter(({ doc }) => doc.status !== "草稿")
    .flatMap(({ kind, doc }) =>
      (doc.invoices?.records || []).map((record) => ({
        kind,
        doc,
        record,
        duplicate:
          !inactive.has(doc.status) &&
          (doc.invoices.records.filter((r) => r.number === record.number)
            .length > 1 ||
            docs.some(
              (other) =>
                (other.kind !== kind || other.doc.id !== doc.id) &&
                !inactive.has(other.doc.status) &&
                (other.doc.invoices?.records?.some(
                  (r) => r.number === record.number,
                ) ||
                  other.doc.invoice === record.number),
            )),
      })),
    );
}
export function structuredInvoiceCsv(rows) {
  const excelText = (v) => (/^\d+$/.test(String(v ?? "")) ? "'" + v : v);
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^\s*[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [
      [
        "单据类型",
        "单号",
        "事项",
        "发票号码",
        "代码",
        "开票日期",
        "购买方",
        "购买方税号",
        "销售方",
        "销售方税号",
        "不含税金额",
        "税额",
        "票面价税合计",
        "申请金额",
        "疑似重复",
        "采集来源",
        "核对时间",
      ],
      ...rows.map(({ kind, doc, record: r, duplicate }) => [
        kind === "expense" ? "报销" : "对公",
        doc.id,
        doc.name,
        excelText(r.number),
        excelText(r.code),
        r.date,
        r.buyerName,
        excelText(r.buyerTaxId),
        r.sellerName,
        excelText(r.sellerTaxId),
        r.netAmount,
        r.taxAmount,
        r.amount,
        doc.amount,
        duplicate ? "是" : "否",
        r.capture.method,
        r.capture.at,
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
