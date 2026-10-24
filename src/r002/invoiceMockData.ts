import type {
  CurrentClaim,
  HistoryInvoice,
  HistoryStatus,
  InvoiceInput,
} from "./invoiceTypes";

export function createMockHistory(): HistoryInvoice[] {
  const rows: [
    string,
    string,
    string,
    string,
    number,
    HistoryStatus,
    string,
  ][] = [
    [
      "BX-H001",
      "张三",
      "12345678",
      "044001900111",
      50000,
      "已通过",
      "增值税电子普通发票",
    ],
    [
      "BX-H002",
      "李四",
      "87654321",
      "044001900222",
      80000,
      "已通过",
      "增值税电子专用发票",
    ],
    [
      "BX-H003",
      "王五",
      "11223344",
      "044001900333",
      30000,
      "已驳回",
      "纸质发票",
    ],
    [
      "BX-H004",
      "赵六",
      "23456789012345678901",
      "",
      120000,
      "已通过",
      "数电发票",
    ],
    [
      "BX-H005",
      "钱七",
      "55667788",
      "044001900555",
      65000,
      "审核中",
      "增值税电子普通发票",
    ],
  ];
  return rows.map(
    (
      [
        documentId,
        employeeName,
        number,
        code,
        amountCents,
        businessStatus,
        type,
      ],
      i,
    ) => ({
      id: `HISTORY-${i + 1}`,
      documentId,
      employeeName,
      department: "模拟业务部",
      submittedAt: `2026-10-${String(i + 10).padStart(2, "0")}T01:00:00.000Z`,
      businessStatus,
      updatedAt: "2026-10-24T00:00:00.000Z",
      invoice: {
        id: `INV-H00${i + 1}`,
        type,
        code,
        number,
        issueDate: `2026-10-${String(i + 1).padStart(2, "0")}`,
        sellerName:
          i === 0 ? "深圳星河服务有限公司（模拟）" : `模拟销售方${i + 1}`,
        sellerTaxId: `DEMO-SELLER-00${i + 1}`,
        buyerName: "星河科技（模拟）",
        amountCents,
        remark: "初始化模拟历史发票，非真实业务资料",
      },
    }),
  );
}
export function emptyInvoiceInput(): InvoiceInput {
  return {
    employeeName: "",
    department: "",
    invoiceType: "数电发票",
    invoiceCode: "",
    invoiceNumber: "",
    issueDate: "",
    sellerName: "",
    sellerTaxId: "",
    buyerName: "",
    amountYuan: "",
    remark: "",
  };
}
export function t02Input(): InvoiceInput {
  const h = createMockHistory()[0]!;
  return {
    employeeName: "李四",
    department: "模拟业务部",
    invoiceType: h.invoice.type,
    invoiceCode: h.invoice.code,
    invoiceNumber: h.invoice.number,
    issueDate: h.invoice.issueDate,
    sellerName: h.invoice.sellerName,
    sellerTaxId: h.invoice.sellerTaxId,
    buyerName: h.invoice.buyerName,
    amountYuan: "500.00",
    remark: "T02虚构重复发票审核演示",
  };
}
export function exampleClaim(): CurrentClaim {
  return {
    documentId: "BX-R002-TEST",
    invoiceRecordId: "INV-R002-TEST",
    submittedAt: "2026-10-24T01:00:00.000Z",
    input: t02Input(),
  };
}
