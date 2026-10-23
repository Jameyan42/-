import test from "node:test";
import assert from "node:assert/strict";
import { enterpriseOrg, assertOrgChange } from "./organization.js";
import { defaultFlows, financeDivisionFlows } from "./approval.js";
import {
  emptyEnterprise,
  validateEnterprise,
  persistEnterprise,
  saveSupplier,
  saveContract,
  reviewContract,
  submitCorporate,
  actCorporate,
  contractBalance,
  canHandleCorporate,
  visibleCorporate,
  visibleContract,
} from "./enterprise.js";
import { demoContractText, screenContract } from "./contract-review.js";
import { validateBackup, defaultPolicy } from "./settings.js";
const org = enterpriseOrg(),
  flows = financeDivisionFlows(defaultFlows(), org);
const who = (id) => org.people.find((p) => p.id === id),
  employee = who("lin"),
  admin = who("admin-gu"),
  finance = who("finance-zhou"),
  ledger = who("ledger-gao"),
  payer = who("payer-du");
const supplier = {
  name: "远帆服务有限公司（虚构）",
  creditCode: "DEMO-CREDIT-001",
  accountName: "远帆服务有限公司（虚构）",
  bankName: "虚构银行",
  bankAccount: "DEMO-SUPPLIER-001",
  active: true,
};
function setup() {
  let s = saveSupplier(emptyEnterprise(), supplier, admin);
  s = saveContract(
    s,
    {
      title: "会务服务",
      number: "HT-DEMO-001",
      supplierId: s.suppliers[0].id,
      amount: 10000,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      text: demoContractText,
    },
    employee,
    org,
  );
  s = reviewContract(s, s.contracts[0].id, finance, {
    approve: true,
    confirmed: true,
    note: "已逐项核对全文、验收及开票后付款条件。",
  });
  return s;
}
function submit(s, amount = 4000, id = "") {
  return submitCorporate(
    s,
    {
      name: "会务尾款",
      contractId: s.contracts[0].id,
      amount,
      date: "2026-10-23",
      note: "虚构服务已验收，申请支付",
    },
    employee,
    org,
    flows,
    id,
  );
}
function toPayment(s, id = s.payments[0].id) {
  let p = s.payments.find((p) => p.id === id);
  while (p.status !== "待付款") {
    const node = p.approval.nodes[p.approval.cursor];
    s = actCorporate(s, id, who(node.actorId), "approve", {
      note: "核对通过",
      ledgerReview: { account: "6602服务费", costCenter: "销售部" },
    });
    p = s.payments.find((p) => p.id === id);
  }
  return s;
}
const payment = (reference) => ({
  date: "2026-10-23",
  method: "银行转账",
  reference,
  confirmed: true,
});
test("企业业务正常闭环、独立记录与合同额度分币合计", () => {
  let s = submit(setup(), 4000.01);
  const id = s.payments[0].id;
  assert.deepEqual(contractBalance(s, s.contracts[0].id), {
    total: 10000,
    occupied: 4000.01,
    paid: 0,
    available: 5999.99,
  });
  s = toPayment(s);
  assert.equal(s.payments[0].status, "待付款");
  assert.equal(s.payments[0].ledgerReview.reviewedBy, ledger.id);
  s = actCorporate(s, id, payer, "approve", {
    payment: payment("DEMO-CORP-001"),
  });
  assert.equal(s.payments[0].status, "已付款");
  assert.equal(s.payments[0].history.at(-1).action, "模拟付款登记");
  assert.equal(
    s.payments[0].history.some((h) => h.operation),
    false,
  );
  assert.equal(contractBalance(s, s.contracts[0].id).paid, 4000.01);
  assert.equal(
    validateEnterprise(JSON.parse(JSON.stringify(s))).payments.length,
    1,
  );
});
test("合同必须人工复核、禁止自审与其他人合同付款、财务分工不可缺", () => {
  let s = setup(),
    c = s.contracts[0];
  c.status = "待复核";
  delete c.review;
  assert.throws(() => submit(s), /已.*复核/);
  assert.throws(
    () =>
      reviewContract(s, c.id, employee, {
        approve: true,
        note: "同意",
        confirmed: true,
      }),
    /身份/,
  );
  assert.throws(
    () =>
      reviewContract(s, c.id, finance, {
        approve: true,
        note: "同意",
        confirmed: false,
      }),
    /人工/,
  );
  s = reviewContract(s, c.id, finance, {
    approve: true,
    note: "已核对风险及全文",
    confirmed: true,
  });
  assert.throws(
    () =>
      submitCorporate(
        s,
        { contractId: c.id, amount: 100 },
        who("chen"),
        org,
        flows,
      ),
    /本人/,
  );
  assert.throws(
    () =>
      submitCorporate(
        s,
        { contractId: c.id, amount: 100 },
        employee,
        org,
        defaultFlows(),
      ),
    /财务分工/,
  );
});
test("合同占用防超额、退回释放、重提再校验、支付失败原状态不变", () => {
  let s = submit(setup(), 7000),
    id = s.payments[0].id;
  const original = JSON.stringify(s);
  assert.throws(() => submit(s, 3000.01), /额度/);
  assert.equal(JSON.stringify(s), original);
  const first = who(s.payments[0].approval.nodes[0].actorId);
  assert.throws(() => actCorporate(s, id, first, "reject"), /原因/);
  s = actCorporate(s, id, first, "reject", { note: "请补付款依据" });
  assert.equal(contractBalance(s, s.contracts[0].id).available, 10000);
  s = submit(s, 5000);
  assert.throws(() => submit(s, 7000, id), /额度/);
  s = submit(s, 5000, id);
  assert.equal(contractBalance(s, s.contracts[0].id).available, 0);
  assert.equal(s.payments.find((p) => p.id === id).history.length, 3);
});
test("收款与审批快照冻结、供应商停用不阻断已提交付款", () => {
  let s = submit(setup()),
    id = s.payments[0].id,
    old = s.payments[0].supplierSnapshot;
  s = saveSupplier(
    s,
    { ...supplier, bankAccount: "DEMO-NEW-002", active: false },
    admin,
    s.suppliers[0].id,
  );
  assert.deepEqual(s.payments[0].supplierSnapshot, old);
  assert.throws(() => submit(s, 100), /停用/);
  s = toPayment(s);
  s = actCorporate(s, id, payer, "approve", {
    payment: payment("DEMO-PAY-FROZEN"),
  });
  assert.equal(s.payments[0].supplierSnapshot.bankAccount, "DEMO-SUPPLIER-001");
});
test("供应商同名户名与唯一标识、合同主体变更和日期精度校验", () => {
  assert.throws(
    () =>
      saveSupplier(
        emptyEnterprise(),
        { ...supplier, bankAccount: "6221234567890123" },
        admin,
      ),
    /虚构/,
  );
  assert.throws(
    () =>
      saveSupplier(
        emptyEnterprise(),
        { ...supplier, accountName: "他人" },
        admin,
      ),
    /同名/,
  );
  let s = setup();
  assert.throws(() => saveSupplier(s, supplier, admin), /重复/);
  assert.throws(
    () =>
      saveContract(
        s,
        { ...s.contracts[0], number: "NEW", startDate: "2026-02-30" },
        employee,
        org,
      ),
    /日期/,
  );
  assert.throws(() => submit(s, 1.001), /金额/);
  s = saveSupplier(
    s,
    { ...supplier, name: "新主体", accountName: "新主体" },
    admin,
    s.suppliers[0].id,
  );
  assert.throws(() => submit(s), /主体/);
});
test("规则审查可解释、不把关键词和缺失误称模型结论", () => {
  assert.equal(
    screenContract(demoContractText, supplier.name).findings.length,
    0,
  );
  const text =
    "乙方：远帆服务有限公司（虚构）。全额预付。承担无限责任。可单方解除合同。";
  const r = screenContract(text, supplier.name);
  assert.equal(r.engine, "local-contract-1");
  for (const id of ["prepay", "liability", "termination"]) {
    const f = r.findings.find((f) => f.id === id);
    assert.equal(f.severity, "高");
    assert.ok(text.includes(f.evidence));
  }
  assert.ok(
    r.findings.find((f) => f.id === "invoice").evidence.includes("未检出"),
  );
  assert.throws(
    () => screenContract("x".repeat(30001), supplier.name),
    /30000/,
  );
});
test("合同修订清除人工复核，仅本人未通过合同可改且编号唯一", () => {
  let s = setup(),
    id = s.contracts[0].id;
  assert.throws(
    () =>
      saveContract(s, { ...s.contracts[0], text: "新正文" }, employee, org, id),
    /未通过/,
  );
  s.contracts[0].status = "待复核";
  delete s.contracts[0].review;
  s = reviewContract(s, id, finance, {
    approve: false,
    note: "补充条款",
    confirmed: true,
  });
  s = saveContract(
    s,
    { ...s.contracts[0], text: demoContractText },
    employee,
    org,
    id,
  );
  assert.equal(s.contracts[0].version, 2);
  assert.equal(s.contracts[0].review, undefined);
  assert.equal(s.contracts[0].status, "待复核");
  assert.throws(() => saveContract(s, s.contracts[0], employee, org), /编号/);
});
test("对公指定人权限、总账必填、付款确认和参考号跨业务判重", () => {
  let s = submit(setup()),
    id = s.payments[0].id;
  assert.throws(() => actCorporate(s, id, finance, "approve"), /指定/);
  assert.equal(canHandleCorporate(s.payments[0], admin), false);
  while (s.payments[0].status !== "待总账复核")
    s = actCorporate(
      s,
      id,
      who(s.payments[0].approval.nodes[s.payments[0].approval.cursor].actorId),
      "approve",
    );
  assert.throws(() => actCorporate(s, id, ledger, "approve"), /总账/);
  s = actCorporate(s, id, ledger, "approve", {
    ledgerReview: { account: "服务费", costCenter: "销售部" },
  });
  const before = JSON.stringify(s);
  assert.throws(
    () =>
      actCorporate(s, id, payer, "approve", {
        payment: { ...payment("DEMO-001"), confirmed: false },
      }),
    /确认/,
  );
  assert.throws(
    () =>
      actCorporate(
        s,
        id,
        payer,
        "approve",
        { payment: payment(" demo-ref ") },
        [
          {
            id: "BX-OLD",
            status: "已付款",
            payment: { reference: "DEMO-REF" },
          },
        ],
      ),
    /已使用/,
  );
  assert.equal(JSON.stringify(s), before);
});
test("对公撤回释放、同一合同多笔付款不重复支付", () => {
  let s = submit(setup()),
    id = s.payments[0].id;
  s = actCorporate(s, id, employee, "withdraw", { note: "金额填错" });
  assert.equal(contractBalance(s, s.contracts[0].id).available, 10000);
  s = submit(s, 100, id);
  s = toPayment(s);
  s = actCorporate(s, id, payer, "approve", { payment: payment("DEMO-ONCE") });
  assert.throws(
    () =>
      actCorporate(s, id, payer, "approve", { payment: payment("DEMO-TWICE") }),
    /指定/,
  );
  assert.throws(() => submit(s, 100, id), /仅可重提/);
});
test("备份拒绝伪造规则、缺失合同、总账或付款人，保护对公在途人员", () => {
  const s = toPayment(submit(setup()));
  for (const mutate of [
    (x) => x.contracts[0].screen.findings.push({ id: "fake" }),
    (x) => (x.contracts = []),
    (x) => delete x.payments[0].ledgerReview,
    (x) => (x.payments[0].approval.paymentActor.actorId = employee.id),
    (x) => (x.payments[0].amount = 10001),
  ]) {
    const x = structuredClone(s);
    mutate(x);
    assert.throws(() => validateEnterprise(x));
  }
  const next = structuredClone(org);
  next.people.find((p) => p.id === payer.id).active = false;
  assert.throws(() => assertOrgChange(org, next, s.payments), /在途/);
});
test("容量失败不改原数据，损坏数据不持久化；合同可见与支付单人员范围", () => {
  const s = submit(setup()),
    before = JSON.stringify(s);
  let writes = 0;
  assert.throws(
    () =>
      persistEnterprise(
        {
          setItem() {
            writes++;
            throw Error("quota");
          },
        },
        s,
      ),
    /未改动/,
  );
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(s), before);
  assert.throws(
    () =>
      persistEnterprise(
        {
          setItem() {
            writes++;
          },
        },
        {},
      ),
    /格式/,
  );
  assert.equal(writes, 1);
  assert.equal(visibleCorporate(s.payments[0], who("head-tax")), false);
  assert.equal(visibleCorporate(s.payments[0], employee), true);
  assert.equal(visibleContract(s.contracts[0], who("staff-tax")), false);
});
test("完整与旧备份兼容；对公信息格式和跨业务参考号冲突被拒绝", () => {
  let s = toPayment(submit(setup()));
  s = actCorporate(s, s.payments[0].id, payer, "approve", {
    payment: payment("DEMO-BACKUP"),
  });
  const backup = {
    format: "qingbao-backup",
    version: 1,
    configuration: { org, flows },
    items: [],
    requests: [],
    budgets: { 销售部: 10000 },
    policy: defaultPolicy,
    audit: [],
    enterprise: s,
  };
  assert.equal(validateBackup(backup).enterprise, s);
  const old = { ...backup };
  delete old.enterprise;
  assert.equal(validateBackup(old).enterprise, undefined);
  const bad = structuredClone(backup);
  bad.enterprise.payments[0].payment.recordedBy = employee.id;
  assert.throws(() => validateBackup(bad), /责任人/);
});

test("对公原件跨撤回重提和审批保留，错误关联与容量失败不覆盖", async () => {
  const { invoiceRecord } = await import("./invoice-data.js");
  const raw = Buffer.from("%PDF-1.4\nfake invoice\n%%EOF"),
    f = {
      id: "original-1",
      name: "虚构发票.pdf",
      kind: "发票",
      type: "application/pdf",
      size: raw.length,
      data: "data:application/pdf;base64," + raw.toString("base64"),
    },
    invoices = {
      schema: 1,
      records: [
        invoiceRecord({
          number: "12345678901234567890",
          amount: 100,
          attachmentId: f.id,
        }),
      ],
    };
  const input = (s) => ({
    name: "关联原件",
    amount: 100,
    contractId: s.contracts[0].id,
    date: "2026-10-24",
    note: "虚构材料",
  });
  let s = setup();
  s = submitCorporate(
    s,
    {
      ...input(s),
      invoices,
      attachments: [
        f,
        { ...f, id: "acceptance", name: "验收单.pdf", kind: "验收单" },
      ],
    },
    employee,
    org,
    flows,
  );
  assert.equal(s.payments[0].attachments.length, 2);
  assert.throws(
    () =>
      validateEnterprise({
        ...s,
        payments: [{ ...s.payments[0], attachments: [] }],
      }),
    /原件/,
  );
  let old = JSON.stringify(s);
  assert.throws(
    () =>
      persistEnterprise(
        {
          setItem() {
            throw Error("quota");
          },
        },
        s,
      ),
    /原数据未改动/,
  );
  assert.equal(JSON.stringify(s), old);
  s = actCorporate(s, s.payments[0].id, employee, "withdraw", {
    note: "修订材料",
  });
  s = submitCorporate(s, input(s), employee, org, flows, s.payments[0].id);
  assert.deepEqual(s.payments[0].invoices, invoices);
  assert.deepEqual(s.payments[0].attachments[0], f);
  s = toPayment(s);
  assert.deepEqual(s.payments[0].attachments[0], f);
});
test("对公二进制容量与合同元数据分别限额，不因文件突破原正文限额", () => {
  let s = submit(setup(), 100);
  const raw = Buffer.alloc(700 * 1024, 32);
  raw.write("%PDF-1.4");
  const f = {
    id: "large",
    name: "验收.pdf",
    kind: "验收单",
    type: "application/pdf",
    size: raw.length,
    data: "data:application/pdf;base64," + raw.toString("base64"),
  };
  s.payments[0].attachments = [f];
  assert(JSON.stringify(s).length > 800000);
  assert.doesNotThrow(() => validateEnterprise(s));
  const many = structuredClone(s);
  many.payments.push(
    { ...structuredClone(many.payments[0]), id: "DG-2" },
    { ...structuredClone(many.payments[0]), id: "DG-3" },
  );
  assert.throws(() => validateEnterprise(many), /容量/);
  const metadata = structuredClone(s);
  metadata.extra = "x".repeat(800000);
  assert.throws(() => validateEnterprise(metadata), /缩短合同正文/);
});
