import { invoiceRows } from "./expenses.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAttachments,
  addAttachments,
  persistExpenseItems,
  writeStorageBatch,
  MAX_FILE,
  MAX_TOTAL,
} from "./attachments.js";
import { validateBackup, defaultPolicy } from "./settings.js";
import { review } from "./domain.js";
const file = (extra = {}) => {
  const raw = Buffer.from("%PDF-1.4\nfictional\n%%EOF");
  return {
    id: "F1",
    name: "酒店水单.pdf",
    kind: "酒店水单",
    type: "application/pdf",
    size: raw.length,
    data: "data:application/pdf;base64," + raw.toString("base64"),
    ...extra,
  };
};
const storage = (values = {}) => {
  const map = new Map(Object.entries(values));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    map,
  };
};
test("支持的文件签名和分类、编码与大小一致性，旧单空附件兼容", () => {
  validateAttachments([]);
  validateAttachments([file()]);
  for (const extra of [
    { name: "危险.html" },
    { kind: "随意" },
    { type: "image/svg+xml" },
    { size: 1 },
    { data: "data:application/pdf;base64,PHNjcmlwdD4=" },
    { data: "https://example.com/file.pdf" },
    { data: "data:application/pdf;base64,@@@@" },
    { id: "" },
  ])
    assert.throws(() => validateAttachments([file(extra)]));
});
test("数量单文件总量及唯一ID上限，不接受超限或重复上传", () => {
  assert.throws(() =>
    validateAttachments(
      Array.from({ length: 6 }, (_, i) => file({ id: String(i) })),
    ),
  );
  assert.throws(() => validateAttachments([file({ size: MAX_FILE + 1 })]));
  const bytes = Buffer.alloc(800 * 1024, 32);
  bytes.write("%PDF-1.4");
  const a = file({
    size: bytes.length,
    data: "data:application/pdf;base64," + bytes.toString("base64"),
  });
  assert(a.size * 2 > MAX_TOTAL);
  assert.throws(() => validateAttachments([a, { ...a, id: "2" }]), /合计/);
  assert.throws(
    () => addAttachments([file()], [file({ id: "2" })]),
    /重复上传/,
  );
  assert.throws(() => validateAttachments([file(), file()]));
});
test("追加及分类不修改原数组，文件实际字节原样保留", () => {
  const current = [file()],
    before = JSON.stringify(current);
  const next = addAttachments(current, [
    file({ id: "2", name: "行程单.pdf", kind: "行程单" }),
  ]);
  assert.equal(next.length, 2);
  assert.equal(JSON.stringify(current), before);
  assert.equal(
    Buffer.from(next[0].data.split(",")[1], "base64").toString(),
    "%PDF-1.4\nfictional\n%%EOF",
  );
});
test("保存容量或存储异常不覆盖已有报销", () => {
  const s = storage({ "qingbao-v1": "old" });
  s.setItem = () => {
    throw Error("quota");
  };
  assert.throws(
    () => persistExpenseItems(s, [{ attachments: [file()] }]),
    /原报销未改动/,
  );
  assert.equal(s.getItem("qingbao-v1"), "old");
  const normal = storage();
  persistExpenseItems(normal, [{ attachments: [file()] }]);
  assert.equal(
    JSON.parse(normal.getItem("qingbao-v1"))[0].attachments[0].data,
    file().data,
  );
  assert.throws(
    () =>
      persistExpenseItems(normal, [
        { name: "x".repeat(2200000), attachments: [file()] },
      ]),
    /容量/,
  );
});
test("备份多键恢复写入失败回退原值及原来缺失的键", () => {
  const s = storage({ items: "old-items", config: "old-config" }),
    set = s.setItem;
  s.setItem = (k, v) => {
    if (k === "policy") throw Error("quota");
    set(k, v);
  };
  assert.throws(
    () =>
      writeStorageBatch(s, [
        ["items", "new"],
        ["new-key", "new"],
        ["config", "new"],
        ["policy", "new"],
      ]),
    /已回退/,
  );
  assert.equal(s.getItem("items"), "old-items");
  assert.equal(s.getItem("config"), "old-config");
  assert.equal(s.getItem("new-key"), null);
  writeStorageBatch(s, [
    ["items", "next"],
    ["config", null],
  ]);
  assert.equal(s.getItem("items"), "next");
  assert.equal(s.getItem("config"), null);
});
test("酒店水单不代替发票，新发票附件可满足原附件完整性检查", () => {
  const x = {
    amount: 100,
    receipt: "",
    status: "待主管审批",
    attachments: [file()],
  };
  assert(review(x).some((f) => f.includes("缺少票据")));
  assert.equal(invoiceRows([{ ...x, employee: "林晓" }], "林晓").length, 1);
  assert.equal(
    review({ ...x, attachments: [file({ kind: "发票" })] }).length,
    0,
  );
});
test("附件文件随备份往返，非法文件拒绝且旧名称记录可导入", () => {
  const b = {
    format: "qingbao-backup",
    version: 1,
    items: [
      {
        id: "X",
        name: "附件报销",
        employee: "林晓",
        department: "销售部",
        type: "差旅交通",
        amount: 100,
        date: "2026-10-23",
        status: "待主管审批",
        invoice: "T",
        receipt: "旧发票.pdf",
        note: "虚构用途",
        history: [],
        attachments: [file()],
      },
    ],
    budgets: { 销售部: 1000, 产品部: 1000, 运营部: 1000 },
    policy: { ...defaultPolicy },
    audit: [],
  };
  assert.deepEqual(validateBackup(structuredClone(b)), b);
  const bad = structuredClone(b);
  bad.items[0].attachments[0].size = 99;
  assert.throws(() => validateBackup(bad));
  delete b.items[0].attachments;
  assert.doesNotThrow(() => validateBackup(b));
});

test("票面原件引用必须存在且为发票，不按名称猜测或重复关联", async () => {
  const { invoiceRecord, validateInvoiceAttachments } =
    await import("./invoice-data.js");
  const r = invoiceRecord({
    number: "12345678901234567890",
    amount: 100,
    attachmentId: "F1",
  });
  const b = { schema: 1, records: [r] };
  assert.throws(() => validateInvoiceAttachments(b, []), /原件/);
  assert.throws(() => validateInvoiceAttachments(b, [file()]), /分类/);
  assert.doesNotThrow(() =>
    validateInvoiceAttachments(b, [file({ kind: "发票" })]),
  );
  assert.throws(
    () =>
      validateInvoiceAttachments(
        { schema: 1, records: [r, { ...r, id: "2" }] },
        [file({ kind: "发票" })],
      ),
    /只能关联/,
  );
  assert.doesNotThrow(() =>
    validateInvoiceAttachments({
      schema: 1,
      records: [{ ...r, attachmentId: undefined }],
    }),
  );
});
test("坏原件引用在持久化前拒绝，真实文件与关联随序列化往返", async () => {
  const { invoiceRecord } = await import("./invoice-data.js");
  const r = invoiceRecord({
    number: "12345678901234567890",
    amount: 100,
    attachmentId: "F1",
  });
  const x = {
    invoices: { schema: 1, records: [r] },
    attachments: [file({ kind: "发票" })],
  };
  const s = storage({ "qingbao-v1": "old" });
  assert.throws(
    () => persistExpenseItems(s, [{ ...x, attachments: [] }]),
    /原件/,
  );
  assert.equal(s.getItem("qingbao-v1"), "old");
  persistExpenseItems(s, [x]);
  assert.deepEqual(JSON.parse(s.getItem("qingbao-v1")), [x]);
});
