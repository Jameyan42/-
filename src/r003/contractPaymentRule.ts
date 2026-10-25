import { calendarOrdinal, parseYuan } from "../r001/rule";
import type {
  Application,
  Contract,
  Payment,
  Result,
  Risk,
} from "./contractTypes";
const money = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
export function stageLimits(c: Contract): number[] {
  const total = BigInt(c.totalCents);
  let allocated = 0n;
  return c.stages.map((s, i) => {
    const n =
      i === c.stages.length - 1
        ? total - allocated
        : (total * BigInt(s.basisPoints) + 5000n) / 10000n;
    allocated += n;
    if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
      throw Error("阶段尾差分配无效");
    return Number(n);
  });
}
export function validateContract(c: Contract): void {
  if (
    !c ||
    !c.id?.trim() ||
    !c.name?.trim() ||
    !c.supplier?.trim() ||
    !money(c.totalCents) ||
    calendarOrdinal(c.effectiveDate) === null ||
    calendarOrdinal(c.expiryDate) === null ||
    c.effectiveDate > c.expiryDate ||
    !["草稿", "已生效", "已终止", "已到期"].includes(c.status) ||
    !["一次性付款", "分阶段付款", "按结算付款"].includes(c.mode) ||
    !Array.isArray(c.stages) ||
    !Array.isArray(c.requirements) ||
    !Array.isArray(c.evidence)
  )
    throw Error("合同基础字段、金额或日期无效");
  if (c.settlementCents !== null && !money(c.settlementCents))
    throw Error("结算金额无效");
  if (c.mode === "按结算付款" && c.settlementCents === null)
    throw Error("缺少已确认结算金额");
  if (
    c.mode === "一次性付款" &&
    (!c.requirements.includes("accepted") || !c.requirements.includes("report"))
  )
    throw Error("一次性付款必须配置验收完成确认及验收报告");
  if (c.mode === "按结算付款" && !c.requirements.includes("settlement"))
    throw Error("结算付款必须配置结算单");
  const ids = new Set<string>();
  for (const e of c.evidence) {
    if (
      !e.id?.trim() ||
      !e.name?.trim() ||
      ids.has(e.id) ||
      !["已提供", "缺失", "无效"].includes(e.status)
    )
      throw Error("证据配置无效");
    ids.add(e.id);
  }
  const req = (a: string[]) => {
    if (!Array.isArray(a) || a.some((x) => typeof x !== "string" || !x.trim()))
      throw Error("前置条件配置无效");
  };
  req(c.requirements);
  if (c.mode === "分阶段付款") {
    if (
      !c.stages.length ||
      new Set(c.stages.map((s) => s.id)).size !== c.stages.length ||
      c.stages.some(
        (s) =>
          !s.id?.trim() ||
          !s.name?.trim() ||
          !Number.isInteger(s.basisPoints) ||
          s.basisPoints <= 0 ||
          s.basisPoints > 10000,
      ) ||
      c.stages.reduce((n, s) => n + s.basisPoints, 0) !== 10000
    )
      throw Error("阶段编号必须唯一，基点比例总和必须10000（100%）");
    c.stages.forEach((s) => {
      req(s.requirements);
      if (!s.requirements.length) throw Error("每个阶段需配置前置条件");
    });
    stageLimits(c);
  }
}
export function validatePayment(p: Payment, contracts: Contract[]): void {
  const c = contracts.find((c) => c.id === p?.contractId);
  if (
    !c ||
    !p.id?.trim() ||
    !p.applicationId?.trim() ||
    !money(p.amountCents) ||
    calendarOrdinal(p.date) === null ||
    !["已支付", "待支付", "已取消", "支付失败"].includes(p.status) ||
    (c.mode === "分阶段付款" && !c.stages.some((s) => s.id === p.stageId))
  )
    throw Error("历史付款关联、阶段、金额、日期或状态无效");
}
export function auditContractPayment(
  a: Application,
  contracts: readonly Contract[],
  payments: readonly Payment[],
  baselineDate: string,
  at: string,
): Result {
  const contract = contracts.find((c) => c.id === a.contractId) || null,
    errors: string[] = [],
    risks: Risk[] = [];
  const relevant = payments.filter(
    (p) => p.contractId === a.contractId && p.applicationId !== a.id,
  );
  const snapshot = {
    application: structuredClone(a),
    contract: structuredClone(contract),
    payments: structuredClone(relevant),
    requirements: [] as Contract["evidence"],
    stageLimits: [] as number[],
  };
  const result = (
    status: Result["status"],
    calculation: Result["calculation"] = null,
  ): Result => ({
    ruleId: "R003",
    ruleVersion: "v1",
    at,
    baselineDate,
    status,
    errors,
    risks,
    calculation,
    snapshot,
  });
  if (!a.id?.trim() || !a.applicant?.trim())
    errors.push("请填写申请人及有效申请编号");
  if (!contract) errors.push("R003-01：缺少合同编号或合同不存在");
  const amount = parseYuan(a.amountYuan);
  if (!amount.ok) errors.push(amount.message);
  if (
    calendarOrdinal(a.date) === null ||
    calendarOrdinal(baselineDate) === null ||
    !Number.isFinite(Date.parse(at))
  )
    errors.push("申请日期或审核基准日期/时间无效");
  try {
    if (contract) {
      validateContract(contract);
      if (
        contract.mode === "分阶段付款" &&
        !contract.stages.some((s) => s.id === a.stageId)
      )
        errors.push("分阶段付款必须选择有效阶段");
    }
    if (new Set(payments.map((p) => p.id)).size !== payments.length)
      throw Error("历史付款编号重复");
    payments.forEach((p) => validatePayment(p, contracts as Contract[]));
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (errors.length || !contract || !amount.ok) return result("invalid");
  const c = contract,
    sum = (status: string, stage?: string) =>
      relevant
        .filter(
          (p) =>
            p.status === status && (stage === undefined || p.stageId === stage),
        )
        .reduce((n, p) => n + BigInt(p.amountCents), 0n);
  const paidBig = sum("已支付"),
    pendingBig = sum("待支付"),
    amt = amount.cents;
  if (paidBig + pendingBig + BigInt(amt) > BigInt(Number.MAX_SAFE_INTEGER)) {
    errors.push("付款累计金额超出安全整数范围");
    return result("invalid");
  }
  const paid = Number(paidBig),
    pending = Number(pendingBig),
    potential = paid + pending + amt;
  const add = (rule: string, message: string, excessCents?: number) =>
    risks.push({
      rule,
      message,
      ...(excessCents === undefined ? {} : { excessCents }),
    });
  if (
    c.status !== "已生效" ||
    baselineDate < c.effectiveDate ||
    baselineDate > c.expiryDate ||
    a.date < c.effectiveDate ||
    a.date > c.expiryDate
  )
    add(
      "R003-02",
      "合同非已生效有效期内：" + c.status + "，请人工核查付款责任",
    );
  if (amt === 0) add("R003-09", "金额为0，请确认是否属于无需实际付款的业务");
  if (paid > c.totalCents)
    add(
      "R003-03",
      "历史已支付本身超过合同总额，历史数据异常",
      paid - c.totalCents,
    );
  const excess = Math.max(0, paid + amt - c.totalCents);
  if (excess) add("R003-03", "本次申请后超过合同总额", excess);
  const stage = c.stages.find((s) => s.id === a.stageId),
    limits = c.mode === "分阶段付款" ? stageLimits(c) : [];
  snapshot.stageLimits = limits;
  const stageLimit =
      stage && c.mode === "分阶段付款"
        ? limits[c.stages.indexOf(stage)]!
        : null,
    stagePaid = stageLimit === null ? null : Number(sum("已支付", a.stageId)),
    stagePending =
      stageLimit === null ? null : Number(sum("待支付", a.stageId));
  const stageExcess =
    stageLimit === null ? null : Math.max(0, stagePaid! + amt - stageLimit);
  if (stageExcess) add("R003-04", "超过当前阶段剩余额度", stageExcess);
  const requirements = [
    ...new Set([
      ...c.requirements,
      ...(stage && c.mode === "分阶段付款" ? stage.requirements : []),
    ]),
  ];
  snapshot.requirements = requirements.map((id) =>
    structuredClone(
      c.evidence.find((e) => e.id === id) || {
        id,
        name: id,
        status: "缺失" as const,
      },
    ),
  );
  snapshot.requirements
    .filter((e) => e.status !== "已提供")
    .forEach((e) => add("R003-05", e.name + "：" + e.status + "，需人工核查"));
  const settlement = c.mode === "按结算付款" ? c.settlementCents : null,
    settlementExcess =
      settlement === null ? null : Math.max(0, paid + amt - settlement);
  if (settlementExcess) add("R003-06", "超过已确认结算余额", settlementExcess);
  if (pending > 0 && potential > c.totalCents)
    add(
      "R003-07",
      "包含待支付的潜在累计占用超过合同总额",
      potential - c.totalCents,
    );
  if (
    stageLimit !== null &&
    stagePending! > 0 &&
    stagePaid! + stagePending! + amt > stageLimit
  )
    add(
      "R003-07",
      "包含本阶段待支付的占用超过阶段限额",
      stagePaid! + stagePending! + amt - stageLimit,
    );
  if (settlement !== null && pending > 0 && potential > settlement)
    add("R003-07", "包含待支付的占用超过结算金额", potential - settlement);
  return result(risks.length ? "review_required" : "passed", {
    totalCents: c.totalCents,
    paidCents: paid,
    pendingCents: pending,
    remainingCents: Math.max(0, c.totalCents - paid),
    potentialCents: potential,
    contractExcessCents: excess,
    stageLimitCents: stageLimit,
    stagePaidCents: stagePaid,
    stagePendingCents: stagePending,
    stageRemainingCents:
      stageLimit === null ? null : Math.max(0, stageLimit - stagePaid!),
    stageExcessCents: stageExcess,
    settlementCents: settlement,
    settlementRemainingCents:
      settlement === null ? null : Math.max(0, settlement - paid),
    settlementExcessCents: settlementExcess,
    amountCents: amt,
  });
}
