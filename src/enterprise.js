import {
  compileApproval,
  approvalStatus,
  canApprove,
  validateSnapshot,
  validateLedgerReview,
} from "./approval.js";
import { validatePayment } from "./expenses.js";
import { assertUniqueReference } from "./payment-batch.js";
import { screenContract } from "./contract-review.js";
export const enterpriseKey = "qingbao-enterprise-v1";
export const enterprisePages = ["供应商管理", "合同审查", "对公支付单"];
export const emptyEnterprise = () => ({
  schema: 1,
  suppliers: [],
  contracts: [],
  payments: [],
});
const fail = (m) => {
  throw Error(m);
};
const str = (v, n = 100, required = true) =>
  typeof v === "string" && v.length <= n && (!required || !!v.trim());
const amountOK = (n) =>
  Number.isFinite(n) &&
  n > 0 &&
  n <= 1000000 &&
  Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;
const cents = (n) => Math.round(n * 100);
const dateOK = (d) =>
  typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;
const instantOK = (d) => str(d, 40) && !Number.isNaN(Date.parse(d));
const uid = (prefix) => prefix + "-" + globalThis.crypto.randomUUID();
const clock = () => new Date().toISOString();
function person(actor, roles) {
  if (
    !actor?.active ||
    !str(actor.id, 60) ||
    !str(actor.name, 30) ||
    !roles.includes(actor.role)
  )
    fail("当前身份不能执行此操作");
}
function supplierFields(s) {
  if (
    !s ||
    !str(s.name, 100) ||
    !str(s.creditCode, 40) ||
    !str(s.accountName, 100) ||
    s.accountName !== s.name ||
    !str(s.bankName, 100) ||
    !str(s.bankAccount, 45) ||
    !/^DEMO-[A-Z0-9-]{3,40}$/.test(s.bankAccount) ||
    typeof s.active !== "boolean"
  )
    fail("请完善供应商、统一代码、同名户名、开户行及 DEMO- 开头的虚构账号");
}
function snapshot(s) {
  const { name, creditCode, accountName, bankName, bankAccount } = s;
  return { name, creditCode, accountName, bankName, bankAccount };
}
function validateRecipient(s) {
  supplierFields({ ...s, active: true });
}
function stamp(actor, action, note, from = "", to = "") {
  return {
    actorId: actor.id,
    actorName: actor.name,
    role: actor.role,
    action,
    note: note.trim(),
    from,
    to,
    at: clock(),
  };
}
function historyOK(h) {
  return (
    Array.isArray(h) &&
    h.length <= 100 &&
    h.every(
      (x) =>
        x &&
        str(x.actorId, 60) &&
        str(x.actorName, 30) &&
        str(x.role, 10) &&
        str(x.action, 50) &&
        str(x.note, 500, false) &&
        str(x.from, 30, false) &&
        str(x.to, 30, false) &&
        instantOK(x.at),
    )
  );
}
function addHistory(d, h) {
  if (d.history.length >= 100)
    fail("本单操作记录已达100条，请保留备份后另建单据");
  return [...d.history, h];
}
function checked(state) {
  validateEnterprise(state);
  return state;
}
export function contractBalance(state, id, excludeId = "") {
  const c = state.contracts.find((x) => x.id === id);
  if (!c) fail("合同不存在");
  let occupied = 0,
    paid = 0;
  for (const p of state.payments.filter(
    (x) =>
      x.contractId === id &&
      x.id !== excludeId &&
      !["已退回", "已撤回"].includes(x.status),
  )) {
    if (p.status === "已付款") paid += cents(p.amount);
    else occupied += cents(p.amount);
  }
  return {
    total: c.amount,
    occupied: occupied / 100,
    paid: paid / 100,
    available: (cents(c.amount) - occupied - paid) / 100,
  };
}
export function paymentHandler(p) {
  return p.status === "待付款"
    ? p.approval.paymentActor
    : p.approval.nodes[p.approval.cursor];
}
export function canHandleCorporate(p, actor) {
  return (
    !!actor?.active &&
    ["待主管审批", "待财务审核", "待总账复核", "待付款"].includes(p.status) &&
    paymentHandler(p)?.actorId === actor.id &&
    paymentHandler(p)?.role === actor.role
  );
}
export function visibleCorporate(p, actor) {
  return (
    !!actor?.active &&
    (actor.role === "管理员" ||
      p.createdBy === actor.id ||
      p.approval.nodes.some((n) => n.actorId === actor.id) ||
      p.approval.paymentActor.actorId === actor.id)
  );
}
export function visibleContract(c, actor) {
  return (
    !!actor?.active &&
    (["管理员", "财务"].includes(actor.role) || c.createdBy === actor.id)
  );
}
export function validateEnterprise(state) {
  if (
    !state ||
    state.schema !== 1 ||
    ["suppliers", "contracts", "payments"].some(
      (k) => !Array.isArray(state[k]) || state[k].length > 200,
    )
  )
    fail("企业业务数据格式无效（每类最多200条）");
  const ids = new Set(),
    codes = new Set(),
    accounts = new Set(),
    numbers = new Set();
  for (const collection of [state.suppliers, state.contracts, state.payments])
    for (const x of collection) {
      if (!x || !str(x.id, 60) || ids.has(x.id)) fail("企业记录ID重复或无效");
      ids.add(x.id);
    }
  for (const s of state.suppliers) {
    supplierFields(s);
    if (codes.has(s.creditCode) || accounts.has(s.bankAccount))
      fail("供应商统一代码或收款账号重复");
    codes.add(s.creditCode);
    accounts.add(s.bankAccount);
  }
  for (const c of state.contracts) {
    if (
      !str(c.title, 100) ||
      !str(c.number, 60) ||
      numbers.has(c.number) ||
      !amountOK(c.amount) ||
      !dateOK(c.startDate) ||
      !dateOK(c.endDate) ||
      c.startDate > c.endDate ||
      !["待复核", "已复核", "需修改"].includes(c.status) ||
      !Number.isInteger(c.version) ||
      c.version < 1 ||
      !str(c.createdBy, 60) ||
      !str(c.employee, 30) ||
      !str(c.department, 60) ||
      !instantOK(c.createdAt) ||
      !historyOK(c.history) ||
      !state.suppliers.some((s) => s.id === c.supplierId)
    )
      fail("合同字段、日期、编号或归属无效");
    validateRecipient(c.supplierSnapshot);
    const result = screenContract(c.text, c.supplierSnapshot.name);
    if (JSON.stringify(c.screen) !== JSON.stringify(result))
      fail("合同规则初筛结果与正文不一致，请重新初筛");
    if (
      c.status === "已复核" &&
      (!c.review ||
        !str(c.review.actorId, 60) ||
        c.review.actorId === c.createdBy ||
        !str(c.review.actorName, 30) ||
        !["财务", "管理员"].includes(c.review.role) ||
        !str(c.review.note, 500) ||
        !instantOK(c.review.at) ||
        c.review.version !== c.version ||
        c.review.confirmed !== true)
    )
      fail("合同人工复核记录无效");
    if (c.status !== "已复核" && c.review !== undefined)
      fail("未通过合同不能包含通过记录");
    numbers.add(c.number);
  }
  const references = new Set();
  for (const p of state.payments) {
    const c = state.contracts.find((c) => c.id === p.contractId);
    if (
      !c ||
      c.status !== "已复核" ||
      p.contractVersion !== c.version ||
      p.supplierId !== c.supplierId ||
      !str(p.name, 100) ||
      !amountOK(p.amount) ||
      !dateOK(p.date) ||
      !str(p.note, 500) ||
      !str(p.createdBy, 60) ||
      !str(p.employee, 30) ||
      !str(p.department, 60) ||
      !historyOK(p.history) ||
      p.approval?.schema !== 2 ||
      p.approval?.applicantId !== p.createdBy
    )
      fail("对公支付单合同、金额、归属或审批信息无效");
    validateRecipient(p.supplierSnapshot);
    if (
      p.supplierSnapshot.name !== c.supplierSnapshot.name ||
      p.supplierSnapshot.creditCode !== c.supplierSnapshot.creditCode
    )
      fail("支付单主体与已复核合同不一致");
    validateSnapshot(p.approval, p.status, "expense");
    if (p.ledgerReview !== undefined) {
      validateLedgerReview(p.ledgerReview);
      const i = p.approval.nodes.findIndex((n) => n.stage === "ledger");
      if (
        p.approval.cursor <= i ||
        p.ledgerReview.reviewedBy !== p.approval.nodes[i]?.actorId
      )
        fail("对公总账记录与路径不一致");
    }
    if (["待付款", "已付款"].includes(p.status) && !p.ledgerReview)
      fail("对公支付单缺少总账复核");
    if (p.status === "已付款") {
      validatePayment(p.payment);
      if (
        p.payment.recordedBy !== p.approval.paymentActor.actorId ||
        !instantOK(p.payment.at)
      )
        fail("付款登记责任人无效");
      const ref = p.payment.reference.trim().toUpperCase();
      if (references.has(ref)) fail("对公付款参考号重复");
      references.add(ref);
    } else if (p.payment !== undefined) fail("未付款单据不能包含付款记录");
  }
  for (const c of state.contracts)
    if (contractBalance(state, c.id).available < 0)
      fail("对公支付累计超过合同可用额度");
  if (JSON.stringify(state).length > 800000)
    fail("企业业务数据超过本地容量上限，请缩短合同正文（不自动删除记录）");
  return state;
}
export function persistEnterprise(storage, state) {
  validateEnterprise(state);
  try {
    storage.setItem(enterpriseKey, JSON.stringify(state));
  } catch {
    fail("企业业务保存失败或浏览器容量不足，原数据未改动");
  }
  return state;
}
export function saveSupplier(state, input, actor, id = "") {
  person(actor, ["管理员"]);
  const old = state.suppliers.find((s) => s.id === id);
  if (id && !old) fail("供应商不存在");
  const s = {
    id: old?.id || uid("SUP"),
    name: input.name?.trim(),
    creditCode: input.creditCode?.trim(),
    accountName: input.accountName?.trim(),
    bankName: input.bankName?.trim(),
    bankAccount: input.bankAccount?.trim(),
    active: input.active,
  };
  supplierFields(s);
  return checked({
    ...state,
    suppliers: old
      ? state.suppliers.map((x) => (x.id === id ? s : x))
      : [...state.suppliers, s],
  });
}
export function saveContract(state, input, actor, org, id = "") {
  person(actor, ["员工"]);
  const old = state.contracts.find((c) => c.id === id);
  if (id && (!old || old.createdBy !== actor.id || old.status === "已复核"))
    fail("仅可编辑本人未通过复核的合同");
  const s = state.suppliers.find((s) => s.id === input.supplierId && s.active);
  if (!s) fail("请选择启用的供应商");
  const c = {
    id: old?.id || uid("HT"),
    title: input.title?.trim(),
    number: input.number?.trim(),
    supplierId: s.id,
    supplierSnapshot: snapshot(s),
    amount: Number(input.amount),
    startDate: input.startDate,
    endDate: input.endDate,
    text: input.text,
    version: (old?.version || 0) + 1,
    createdBy: actor.id,
    employee: actor.name,
    department:
      org.departments.find((d) => d.id === actor.departmentId)?.name || "",
    createdAt: old?.createdAt || clock(),
    status: "待复核",
    screen: screenContract(input.text, s.name),
    history: old?.history || [],
  };
  c.history = addHistory(
    c,
    stamp(
      actor,
      old ? "修订并重新初筛" : "提交合同",
      "本地规则初筛，待人工复核",
      old?.status || "",
      "待复核",
    ),
  );
  return checked({
    ...state,
    contracts: old
      ? state.contracts.map((x) => (x.id === id ? c : x))
      : [...state.contracts, c],
  });
}
export function reviewContract(state, id, actor, { approve, note, confirmed }) {
  person(actor, ["财务", "管理员"]);
  const old = state.contracts.find((c) => c.id === id);
  if (!old || old.status !== "待复核" || old.createdBy === actor.id)
    fail("合同已处理或不允许提交人自审");
  if (!str(note, 500) || typeof approve !== "boolean" || confirmed !== true)
    fail("请确认已人工核对全文，并填写1～500字复核意见（含高风险处理依据）");
  const c = {
    ...old,
    status: approve ? "已复核" : "需修改",
    history: addHistory(
      old,
      stamp(
        actor,
        approve ? "人工复核通过" : "要求修改",
        note,
        old.status,
        approve ? "已复核" : "需修改",
      ),
    ),
  };
  if (approve)
    c.review = {
      actorId: actor.id,
      actorName: actor.name,
      role: actor.role,
      note: note.trim(),
      confirmed: true,
      at: clock(),
      version: c.version,
    };
  return checked({
    ...state,
    contracts: state.contracts.map((x) => (x.id === id ? c : x)),
  });
}
export function submitCorporate(state, input, actor, org, flows, id = "") {
  person(actor, ["员工"]);
  const old = state.payments.find((p) => p.id === id);
  if (
    id &&
    (!old ||
      old.createdBy !== actor.id ||
      !["已退回", "已撤回"].includes(old.status))
  )
    fail("仅可重提本人退回或撤回的对公单");
  const c = state.contracts.find(
    (c) => c.id === input.contractId && c.status === "已复核",
  );
  if (!c || c.createdBy !== actor.id)
    fail("请选择本人提交且已经人工复核的合同");
  const s = state.suppliers.find((s) => s.id === c.supplierId && s.active);
  if (!s) fail("供应商已停用，不能新增或重提付款");
  if (
    s.name !== c.supplierSnapshot.name ||
    s.creditCode !== c.supplierSnapshot.creditCode
  )
    fail("供应商主体已变更，请另建并复核对应合同");
  const value = Number(input.amount);
  if (
    !amountOK(value) ||
    cents(value) > cents(contractBalance(state, c.id, id).available)
  )
    fail("支付金额无效或超过合同可用额度");
  if (!flows.ledgerId || !flows.payerId)
    fail("请管理员先在审批流程发布财务分工模板（需总账与付款节点）");
  const p = {
    id: old?.id || uid("DG"),
    name: input.name?.trim(),
    contractId: c.id,
    contractVersion: c.version,
    supplierId: s.id,
    supplierSnapshot: snapshot(s),
    createdBy: actor.id,
    employee: actor.name,
    department:
      org.departments.find((d) => d.id === actor.departmentId)?.name || "",
    type: "其他费用",
    amount: value,
    date: input.date,
    note: input.note?.trim(),
    history: old?.history || [],
  };
  p.approval = compileApproval(p, "expense", org, flows);
  p.status = approvalStatus(p.approval);
  p.history = addHistory(
    p,
    stamp(actor, old ? "重新提交" : "提交对公单", p.note || "", "", p.status),
  );
  return checked({
    ...state,
    payments: old
      ? state.payments.map((x) => (x.id === id ? p : x))
      : [...state.payments, p],
  });
}
export function actCorporate(
  state,
  id,
  actor,
  action,
  { note = "", ledgerReview, payment } = {},
  expenseItems = [],
) {
  const old = state.payments.find((p) => p.id === id);
  if (!old) fail("对公支付单不存在");
  if (!str(note, 500, false)) fail("备注不能超过500字");
  let p;
  if (action === "withdraw") {
    person(actor, ["员工"]);
    if (
      old.createdBy !== actor.id ||
      old.approval.cursor !== 0 ||
      old.status !== approvalStatus(old.approval) ||
      !note.trim()
    )
      fail("仅可撤回本人首节点未审批单据，需填写原因");
    p = { ...old, status: "已撤回" };
  } else {
    if (
      !canHandleCorporate(old, actor) ||
      !["approve", "reject"].includes(action)
    )
      fail("当前身份不是对公单指定处理人");
    if (action === "reject" && !note.trim()) fail("请填写退回原因");
    p = { ...old, approval: structuredClone(old.approval) };
    if (action === "reject") p.status = "已退回";
    else if (old.status === "待付款") {
      validateLedgerReview(old.ledgerReview);
      const data = validatePayment(payment);
      assertUniqueReference(data.reference, [
        ...state.payments.filter((p) => p.id !== id),
        ...expenseItems,
      ]);
      p.status = "已付款";
      p.payment = { ...data, recordedBy: actor.id, at: clock() };
    } else {
      if (!canApprove(old, actor)) fail("审批节点已变化");
      if (old.approval.nodes[old.approval.cursor].stage === "ledger")
        p.ledgerReview = validateLedgerReview({
          ...ledgerReview,
          reviewedBy: actor.id,
          at: clock(),
        });
      p.approval.cursor++;
      p.status = approvalStatus(p.approval);
    }
  }
  p.history = addHistory(
    old,
    stamp(
      actor,
      action === "withdraw"
        ? "撤回"
        : action === "reject"
          ? "退回"
          : p.status === "已付款"
            ? "模拟付款登记"
            : "审批通过",
      note,
      old.status,
      p.status,
    ),
  );
  return checked({
    ...state,
    payments: state.payments.map((x) => (x.id === id ? p : x)),
  });
}
