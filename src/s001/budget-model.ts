import { resolveVersion, applySelection, usesManagedBudgets, businessDate } from "./rule-config";
import { centsToYuan } from "../r001/rule";
import {
  defaultBudgetBook,
  type BudgetBook,
  type Budget,
  type Allocation,
  type BudgetEscalation,
} from "./budget-config";
import {
  budgetRule,
  allocations,
  zeroAllocation,
  validateBudgetBook,
  validateBudgetDefinitions,
  validTime,
  requiredBudgetEscalation,
  sameEscalation,
} from "./budget-rule";
import { defaultEntities } from "./entity-rule";
import type { State, Input, Claim, Context } from "./types";
import type { Org } from "./workflow-config";
type Actor = { id?: string; name: string; role: string };
function fingerprint(
  action: string,
  id: string,
  revision: number,
  payload: unknown,
) {
  return JSON.stringify([action, id, revision, payload]);
}
function event(book: BudgetBook, id: string, fp: string, at: string) {
  if (!id || !validTime(at)) throw Error("预算事件编号和时间必填");
  const old = book.events.find((e) => e.id === id);
  if (old) {
    if (old.fingerprint !== fp)
      throw Error("同一业务事件不能使用不同参数重复处理");
    return false;
  }
  book.events.push({ id, fingerprint: fp, at });
  return true;
}
function transition(
  book: BudgetBook,
  id: string,
  revision: number,
  after: Allocation,
  type: "RESERVE" | "RELEASE" | "CONSUME" | "ADJUST",
  eventId: string,
  at: string,
  actor: Actor,
  reason: string,
) {
  const before = allocations(book).get(id) || zeroAllocation();
  book.transactions.push({
    transactionId: crypto.randomUUID(),
    budgetId: after.budgetId || before.budgetId,
    reimbursementId: id,
    reimbursementVersion: revision,
    transactionType: type,
    scope: "CLAIM",
    amount:
      type === "CONSUME"
        ? after.used - before.used
        : type === "RELEASE"
          ? before.reserved
          : after.reserved - before.reserved,
    beforeAmount: before.reserved + before.used,
    afterAmount: after.reserved + after.used,
    before,
    after: structuredClone(after),
    transactionTime: at,
    businessEventId: eventId,
    description: reason,
    actor: actor.name,
    budgetVersion: after.budgetVersion || before.budgetVersion,
  });
}
export function budgetContext(
  s: State,
  d: Claim,
  at: string,
  org?: Org,
): Context {
  const context:Context = {
    at,
    standards: null,
    invoiceHistory: null,
    budgetBook: s.budgetBook || defaultBudgetBook(),
    budgetOrg:
      org ||
      [...(d.workflows || [])]
        .reverse()
        .find((w) => w.reimbursementVersion === d.revision)?.org ||
      d.workflows?.at(-1)?.org,
  };
  if(usesManagedBudgets(s.ruleBook,at,businessDate(d.input,'R007'))){
    const x=resolveVersion(s.ruleBook!,d.input,'R007',at);
    if(x.error)return {...context,ruleSelections:[x]};
    let effective:Context;
    try{effective=applySelection(d.input,context,x);}catch(err){return {...context,ruleSelections:[{...x,error:String(err)}]};}
    effective.ruleSelections=[x];
    return effective;
  }
  return context;
}
export function reconcileBudget(
  s: State,
  id: string,
  eventId: string,
  at: string,
  actor: Actor,
  org?: Org,
  forceSoft = false,
): State {
  const n = structuredClone(s),
    d = n.claims.find((d) => d.id === id);
  if (!d) throw Error("报销单不存在");
  if (!forceSoft && d.batches.some((b) => b.review?.decision === "approved"))
    throw Error("已批准记录不能重新预占预算，历史迁移或冲销需要单独处理");
  const book = n.budgetBook || defaultBudgetBook();
  n.budgetBook = book;
  validateBudgetBook(book);
  const old = allocations(book).get(id) || zeroAllocation();
  if (
    old.used ||
    book.transactions.some(
      (t) =>
        t.scope === "CLAIM" &&
        t.reimbursementId === id &&
        t.transactionType === "CONSUME",
    )
  )
    throw Error("该报销已转入预算已使用，需正式冲销，不可直接修改或重新预占");
  const r = budgetRule(d.input, budgetContext(n, d, at, org)),
    e = r.evidence as any;
  if (["BLOCK", "ERROR", "INSUFFICIENT_DATA"].includes(r.status) || !e.budget)
    throw Error(`预算未通过：${r.message}`);
  if (r.status === "REVIEW" && e.controlMode !== "SOFT")
    throw Error(`预算需确认：${r.message}`);
  const b = e.budget as Budget,
    newAmount =
      r.status === "REVIEW" && !b.reserveOnSoftExceeded && !forceSoft
        ? 0
        : e.amountCents;
  const fp = fingerprint("RESERVE", id, d.revision, {
    budgetId: b.budgetId,
    version: b.version,
    amount: newAmount,
  });
  if (!event(book, eventId, fp, at)) return s;
  if (old.budgetId && old.budgetId !== b.budgetId && old.reserved)
    transition(
      book,
      id,
      d.revision,
      { ...old, reserved: 0 },
      "RELEASE",
      eventId + ":old",
      at,
      actor,
      "预算归属变化释放原预算",
    );
  const now = allocations(book).get(id) || zeroAllocation();
  if (
    now.reserved !== newAmount ||
    now.budgetId !== b.budgetId ||
    now.revision !== d.revision ||
    now.budgetVersion !== b.version
  )
    transition(
      book,
      id,
      d.revision,
      {
        reserved: newAmount,
        used: 0,
        revision: d.revision,
        budgetId: b.budgetId,
        budgetVersion: b.version,
      },
      now.reserved ? "ADJUST" : "RESERVE",
      eventId + ":new",
      at,
      actor,
      newAmount
        ? "按业务提交/变更更新有效预占，仅计一份金额"
        : "柔性超额配置不保留预占，待授权后最终检查",
    );
  n.revision++;
  return n;
}
export function releaseBudget(
  s: State,
  id: string,
  eventId: string,
  at: string,
  actor: Actor,
  reason: string,
): State {
  const n = structuredClone(s),
    d = n.claims.find((d) => d.id === id);
  if (!d) throw Error("报销单不存在");
  const book = n.budgetBook || defaultBudgetBook();
  n.budgetBook = book;
  validateBudgetBook(book);
  const a = allocations(book).get(id) || zeroAllocation();
  if (a.used) throw Error("已使用预算不能直接释放，需正式冲销处理");
  if (!event(book, eventId, fingerprint("RELEASE", id, d.revision, reason), at))
    return s;
  if (a.reserved)
    transition(
      book,
      id,
      d.revision,
      { ...a, reserved: 0, revision: d.revision },
      "RELEASE",
      eventId + ":release",
      at,
      actor,
      reason,
    );
  n.revision++;
  return n;
}
export function assertBudgetFinal(s: State, d: Claim, at: string) {
  if (
    s.budgetBook?.transactions.some(
      (t) =>
        t.scope === "CLAIM" &&
        t.reimbursementId === d.id &&
        t.transactionType === "CONSUME",
    )
  )
    throw Error("已转入预算已使用，不允许再次批准消耗");
  if (d.budgetOpening)
    throw Error("期初模拟记录不是正式审批单，不能伪造财务批准");
  const c = budgetContext(s, d, at),
    r = budgetRule(d.input, c),
    e = r.evidence as any;
  if (["BLOCK", "ERROR", "INSUFFICIENT_DATA"].includes(r.status) || !e.budget)
    throw Error("最新预算阻止批准：" + r.message);
  const w = [...(d.workflows || [])]
    .reverse()
    .find((w) => w.reimbursementVersion === d.revision && !w.cancelledAt);
  if (r.status === "REVIEW") {
    if (e.controlMode !== "SOFT") throw Error("预算归属或配置仍待确认");
    const esc = w && requiredBudgetEscalation(d.input, c, w.org);
    if (
      !w ||
      !esc ||
      !sameEscalation(w.budgetEscalation, esc) ||
      !w.records.some(
        (x) =>
          x.approverRole === "预算负责人" &&
          x.approverId === esc.ownerId &&
          x.approvalStatus === "APPROVED",
      )
    )
      throw Error(
        "柔性超预算尚未取得当前制度的具名预算负责人授权，不能普通放行",
      );
  }
  const own = allocations(c.budgetBook!).get(d.id);
  if (
    !own ||
    own.budgetId !== e.budget.budgetId ||
    own.revision !== d.revision ||
    own.used
  )
    throw Error(
      "预算未按当前单据版本提交预占，或已转已使用；请先提交/重新检查",
    );
  if (
    own.reserved !== e.amountCents &&
    !(
      e.controlMode === "SOFT" &&
      !e.budget.reserveOnSoftExceeded &&
      own.reserved === 0
    )
  )
    throw Error("本单预占金额不匹配，需重新提交预算检查");
  return c.ruleSelections ? {...r,configuration:c.ruleSelections[0]} : r;
}
export function consumeBudget(
  s: State,
  id: string,
  eventId: string,
  at: string,
  actor: Actor,
): State {
  const d = s.claims.find((d) => d.id === id);
  if (!d) throw Error("报销单不存在");
  const book = s.budgetBook || defaultBudgetBook();
  const previous = book.events.find((e) => e.id === eventId);
  if (previous) {
    if (
      previous.fingerprint !==
      fingerprint("CONSUME", id, d.revision, d.input.amountYuan)
    )
      throw Error("批准事件参数冲突");
    return s;
  }
  const finalCheck = assertBudgetFinal(s, d, at);
  let n = s;
  const own = allocations(book).get(id)!;
  if (own.reserved === 0)
    n = reconcileBudget(
      s,
      id,
      eventId + ":late-reserve",
      at,
      actor,
      undefined,
      true,
    );
  n = structuredClone(n);
  const next = n.budgetBook!,
    a = allocations(next).get(id)!;
  event(
    next,
    eventId,
    fingerprint("CONSUME", id, d.revision, d.input.amountYuan),
    at,
  );
  transition(
    next,
    id,
    d.revision,
    {
      ...a,
      reserved: 0,
      used: a.reserved,
      budgetVersion: (finalCheck.evidence as any).budget.version,
    },
    "CONSUME",
    eventId + ":consume",
    at,
    actor,
    "最终财务批准：预占转已使用，不新增预算消耗；不是付款",
  );
  n.revision++;
  return n;
}
export function configureBudgets(
  s: State,
  budgets: Budget[],
  actor: Actor,
  reason: string,
  at: string,
  eventId: string,
): State {
  if (
    !["财务", "管理员"].includes(actor.role) ||
    !actor.name?.trim() ||
    !reason.trim() ||
    reason.length > 500
  )
    throw Error("仅模拟财务/管理员可配置预算，原因必填");
  validateBudgetDefinitions(budgets);
  const n = structuredClone(s),
    book = n.budgetBook || defaultBudgetBook();
  n.budgetBook = book;
  validateBudgetBook(book);
  if (
    !event(
      book,
      eventId,
      fingerprint("CONFIG", "CONFIG", book.version, budgets),
      at,
    )
  )
    return s;
  for (const old of book.budgets) {
    const next = budgets.find((b) => b.budgetId === old.budgetId);
    if (!next) throw Error("不可删除已有预算，请停用保留历史");
    if(usesManagedBudgets(s.ruleBook,at) && JSON.stringify([old.controlMode,old.warningThresholds,old.reserveOnSoftExceeded,old.extraApproverId])!==JSON.stringify([next.controlMode,next.warningThresholds,next.reserveOnSoftExceeded,next.extraApproverId]))throw Error('预算控制策略已由R008接管，请在规则管理中心发布；预算额度仍在此处维护');

    if (
      JSON.stringify([
        old.companyId,
        old.departmentId,
        old.expenseType,
        old.budgetPeriod,
        old.currency,
      ]) !==
      JSON.stringify([
        next.companyId,
        next.departmentId,
        next.expenseType,
        next.budgetPeriod,
        next.currency,
      ])
    )
      throw Error("预算维度不可原地改写，请新增预算并停用旧记录");
  }
  for (const next of budgets.filter((b) => b.status === "ACTIVE")) {
    const other = book.budgets.find(
      (old) =>
        old.budgetId !== next.budgetId &&
        old.companyId === next.companyId &&
        old.departmentId === next.departmentId &&
        old.expenseType === next.expenseType &&
        old.budgetPeriod === next.budgetPeriod &&
        old.currency === next.currency &&
        [...allocations(book).values()].some(
          (a) => a.budgetId === old.budgetId && (a.used || a.reserved),
        ),
    );
    if (other)
      throw Error(
        "该维度已有预算占用，请调整原预算编号，不可换新编号重置已使用/预占余额",
      );
  }
  const before = structuredClone(book.budgets);
  book.budgets = budgets.map((b) => {
    const old = before.find((x) => x.budgetId === b.budgetId);
    return {
      ...structuredClone(b),
      version: old
        ? JSON.stringify({ ...old, version: 0 }) ===
          JSON.stringify({ ...b, version: 0 })
          ? old.version
          : old.version + 1
        : 1,
    };
  });
  book.changes.push({
    at,
    actor: actor.name,
    role: actor.role,
    reason,
    before,
    after: structuredClone(book.budgets),
  });
  for (const b of book.budgets) {
    const old = before.find((x) => x.budgetId === b.budgetId);
    if (!old || old.budgetAmount !== b.budgetAmount)
      book.transactions.push({
        transactionId: crypto.randomUUID(),
        budgetId: b.budgetId,
        reimbursementId: "CONFIG",
        reimbursementVersion: 0,
        transactionType: "ADJUST",
        scope: "CONFIG",
        amount: b.budgetAmount - (old?.budgetAmount || 0),
        beforeAmount: old?.budgetAmount || 0,
        afterAmount: b.budgetAmount,
        before: zeroAllocation(),
        after: zeroAllocation(),
        transactionTime: at,
        businessEventId: eventId + ":" + b.budgetId,
        description: reason,
        actor: actor.name,
        budgetVersion: b.version,
      });
  }
  book.version++;
  n.revision++;
  return n;
}
export function withdrawClaim(
  s: State,
  id: string,
  actor: Actor,
  reason: string,
  at: string,
  eventId: string,
): State {
  const d = s.claims.find((d) => d.id === id);
  if (
    !d ||
    !actor.name?.trim() ||
    !reason.trim() ||
    reason.length > 500 ||
    !validTime(at)
  )
    throw Error("撤销人员、原因和时间必填");
  if (
    !["财务", "管理员"].includes(actor.role) &&
    !(actor.id === d.input.applicantId && actor.name === d.input.employee)
  )
    throw Error("仅申请人或模拟财务/管理员可撤销");
  if (
    d.batches.some((b) => b.review?.decision === "approved") ||
    allocations(s.budgetBook || defaultBudgetBook()).get(id)?.used
  )
    throw Error("已经批准的报销不能直接撤销，需要正式冲销流程");
  const next = releaseBudget(s, id, eventId, at, actor, reason);
  if (next === s) return s;
  const n = structuredClone(next),
    doc = n.claims.find((d) => d.id === id)!;
  doc.withdrawal = { revision: doc.revision, at, actor: actor.name, reason };
  for (const w of doc.workflows || [])
    if (w.reimbursementVersion === doc.revision) w.cancelledAt = at;
  doc.currentBatchId = null;
  doc.status = "草稿";
  doc.operations = [
    ...(doc.operations || []),
    {
      id: crypto.randomUUID(),
      claimId: id,
      type: "撤销报销并释放预算",
      at,
      actor: actor.name,
      role: actor.role,
      reason,
      before: { revision: doc.revision },
      after: { withdrawn: true },
    },
  ];
  return n;
}
export function seedBudgetOpening(
  s: State,
  budgetId: string,
  used: number,
  reserved: number,
  actor: Actor,
  at: string,
  eventId: string,
): State {
  if (
    !["财务", "管理员"].includes(actor.role) ||
    ![used, reserved].every((n) => Number.isSafeInteger(n) && n >= 0)
  )
    throw Error("仅财务/管理员可创建明确标记的期初模拟记录");
  const n = structuredClone(s),
    book = n.budgetBook || defaultBudgetBook();
  n.budgetBook = book;
  const b = book.budgets.find((b) => b.budgetId === budgetId);
  if (!b) throw Error("预算不存在");
  if (
    !event(
      book,
      eventId,
      fingerprint("OPENING", budgetId, 0, { used, reserved }),
      at,
    )
  )
    return s;
  for (const [kind, amount] of [
    ["USED", used],
    ["RESERVED", reserved],
  ] as const) {
    if (!amount) continue;
    const id = `OPEN-${budgetId}-${kind}`;
    if (n.claims.some((d) => d.id === id))
      throw Error("此预算已创建期初模拟记录，不重复追加");
    const dep =
      b.departmentId === "sales"
        ? "销售部"
        : b.departmentId === "product"
          ? "产品部"
          : b.departmentId === "ops"
            ? "运营部"
            : b.departmentId;
    const input: Input = {
      id,
      companyId: b.companyId,
      departmentId: b.departmentId,
      employee: "期初虚构记录（非正式审核）",
      department: dep,
      grade: "普通员工",
      expenseType: b.expenseType,
      businessDate: b.budgetPeriod + "-01",
      amountYuan: centsToYuan(amount),
      currency: b.currency,
      city: "",
      checkIn: "",
      checkOut: "",
      hotel: "",
      hotelAmountYuan: "",
      partialReason: "",
      invoices: [],
    };
    n.claims.unshift({
      id,
      createdAt: at,
      submittedAt: at,
      revision: 1,
      input,
      budgetOpening: kind,
      batches: [],
      currentBatchId: null,
      status: "草稿",
      operations: [],
      workflows: [],
    });
    transition(
      book,
      id,
      1,
      {
        reserved: amount,
        used: 0,
        revision: 1,
        budgetId: b.budgetId,
        budgetVersion: b.version,
      },
      "RESERVE",
      eventId + ":" + kind,
      at,
      actor,
      "明确标记的期初模拟占用，不伪造费用审核通过",
    );
    if (kind === "USED")
      transition(
        book,
        id,
        1,
        {
          reserved: 0,
          used: amount,
          revision: 1,
          budgetId: b.budgetId,
          budgetVersion: b.version,
        },
        "CONSUME",
        eventId + ":used",
        at,
        actor,
        "期初模拟已使用，不代表系统完成真实财务批准",
      );
  }
  n.revision++;
  return n;
}
