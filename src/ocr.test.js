import test from "node:test";
import assert from "node:assert/strict";
import { extractInvoiceFields, checkOcrFile } from "./ocr.js";
import { validateBackup, defaultPolicy } from "./settings.js";
test("提取中文和英文有标签字段，支持全角字符、空格和千位分隔符", () => {
  assert.deepEqual(
    extractInvoiceFields(
      "发 票 号 码：１２３４５６７８９０１２３４５６７８９０\n价税合计（小写）：￥１，２６８．５０",
    ),
    { invoice: "12345678901234567890", amount: "1268.50" },
  );
  assert.deepEqual(
    extractInvoiceFields("Invoice No: 12345678\nTOTAL: 268.50"),
    { invoice: "12345678", amount: "268.50" },
  );
  assert.deepEqual(
    extractInvoiceFields("发票号码 1234 5678\n价税合计\n￥268.50"),
    { invoice: "12345678", amount: "268.50" },
  );
});
test("无标签、歧义金额和无法确认的号码保持空，不凭空补全", () => {
  assert.deepEqual(
    extractInvoiceFields("12345678901234567890\n税额 10.00\n金额 258.50"),
    { invoice: "", amount: "" },
  );
  assert.equal(extractInvoiceFields("价税合计 10.00 20.00").amount, "");
  assert.equal(extractInvoiceFields("发票号码 123\n合计金额 0.00").invoice, "");
  assert.equal(extractInvoiceFields("总金额 1000001.00").amount, "");
});
test("拒绝PDF、空图和超限图片，支持PNG和JPG", () => {
  assert.throws(() => checkOcrFile(null));
  assert.throws(() => checkOcrFile({ type: "application/pdf", size: 10 }));
  assert.throws(() =>
    checkOcrFile({ type: "image/png", size: 7 * 1024 * 1024 }),
  );
  assert.throws(() => checkOcrFile({ type: "image/jpeg", size: 0 }));
  assert.doesNotThrow(() => checkOcrFile({ type: "image/png", size: 100 }));
});
test("OCR核对元数据可备份且不破坏旧备份，非法核对标志被拒绝", () => {
  const x = {
    id: "ocr1",
    name: "识别报销",
    amount: 268.5,
    employee: "林晓",
    department: "销售部",
    type: "办公采购",
    date: "2026-10-22",
    invoice: "12345678",
    receipt: "demo.png",
    note: "虚构场景",
    status: "待主管审批",
    history: [],
  };
  const data = {
    format: "qingbao-backup",
    version: 1,
    items: [x],
    budgets: { 销售部: 1000, 产品部: 2000, 运营部: 3000 },
    policy: defaultPolicy,
    audit: [],
  };
  assert.doesNotThrow(() => validateBackup(data));
  x.ocr = {
    engine: "Tesseract.js",
    confirmed: true,
    at: "2026-10-22T10:00:00Z",
    fields: ["invoice", "amount"],
  };
  assert.doesNotThrow(() => validateBackup(data));
  x.ocr.confirmed = false;
  assert.throws(() => validateBackup(data));
});
