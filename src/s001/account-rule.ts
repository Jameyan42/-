import { calendarOrdinal } from "../r001/rule";
import { defaultAccounts, type AccountConfig } from "./account-config";
import type { Input, Context, RuleResult, Status } from "./types";
export function validateAccounts(c: AccountConfig) {
  if (
    !c ||
    !Number.isSafeInteger(c.version) ||
    c.version < 1 ||
    !Array.isArray(c.accounts) ||
    !Array.isArray(c.mappings) ||
    !Array.isArray(c.scenarios) ||
    c.accounts.length > 100 ||
    c.mappings.length > 200 ||
    c.scenarios.length > 50
  )
    throw Error("科目配置格式或容量无效");
  const text = (s: unknown) =>
    typeof s === "string" && s.trim().length > 0 && s.length <= 500;
  const codes = c.accounts.map((a) => a.code);
  if (
    new Set(codes).size !== codes.length ||
    c.accounts.some((a) => !text(a.code) || !text(a.name))
  )
    throw Error("科目代码重复或名称无效");
  if (new Set(c.mappings.map((m) => m.ruleId)).size !== c.mappings.length)
    throw Error("映射编号重复");
  for (const m of c.mappings)
    if (
      !text(m.ruleId) ||
      !text(m.companyId) ||
      !text(m.expenseType) ||
      !text(m.description) ||
      !["ACTIVE", "DISABLED"].includes(m.status) ||
      calendarOrdinal(m.effectiveFrom) === null ||
      (m.effectiveTo !== null &&
        (calendarOrdinal(m.effectiveTo) === null ||
          m.effectiveTo < m.effectiveFrom)) ||
      !Array.isArray(m.allowedAccountCodes) ||
      !m.allowedAccountCodes.length ||
      new Set(m.allowedAccountCodes).size !== m.allowedAccountCodes.length ||
      m.allowedAccountCodes.some((x) => !codes.includes(x)) ||
      !m.allowedAccountCodes.includes(m.recommendedAccountCode)
    )
      throw Error("映射引用科目、期限或字段无效");
  for (const s of c.scenarios)
    if (
      !text(s.scenario) ||
      !Array.isArray(s.expenseTypes) ||
      !s.expenseTypes.length ||
      s.expenseTypes.some((t) => !text(t))
    )
      throw Error("业务场景政策无效");
}
export function accountRule(d: Input, c: Context): RuleResult {
  const config = c.accountConfig || defaultAccounts();
  validateAccounts(config);
  // 新字段缺失的旧单据也不推断已完成财务确认。
  const date = d.businessDate || (d.expenseType === "住宿费" ? d.checkIn : "");
  const evidence = {
    expenseType: d.expenseType,
    companyId: d.companyId || "",
    companyName:
      c.entityConfig?.companies.find((x) => x.companyId === d.companyId)
        ?.companyName || "",
    businessDate: date,
    dateBasis: d.businessDate ? "业务发生日期" : "旧住宿单兼容：入住日期",
    stage: d.accountStage || "员工提交",
    businessDescription: d.businessDescription || "",
    businessScenario: d.businessScenario || "",
    costCenter: d.costCenter || "",
    selectedAccountCode: d.accountCode || "",
    recommendedAccountCode: "",
    allowedAccountCodes: [] as string[],
    mappingRuleId: "",
    policyVersion: config.version,
    matchedRules: [] as AccountConfig["mappings"],
    accounts: config.accounts,
  };
  const out = (status: Status, message: string): RuleResult => ({
    ruleId: "R005",
    ruleKey: "expense.account-mapping",
    ruleName: "费用类型与会计科目匹配",
    status,
    severity:
      status === "PASS" ? "none" : status === "REVIEW" ? "medium" : "high",
    message,
    evidence,
    suggestedAction:
      status === "PASS"
        ? "等待财务最终复核；本结果不是正式记账凭证"
        : "财务核实业务、确认科目或补充映射制度后重新审核；明确拦截不得普通放行",
  });
  if (calendarOrdinal(date) === null)
    return out("INSUFFICIENT_DATA", "请补充有效业务发生日期，不能使用今天代替");
  if (
    !d.companyId ||
    !c.entityConfig?.companies.some(
      (x) =>
        x.companyId === d.companyId &&
        x.status === "启用" &&
        date >= x.effectiveFrom &&
        (!x.effectiveTo || date <= x.effectiveTo),
    )
  )
    return out(
      "INSUFFICIENT_DATA",
      "缺少有效的适用法人或法人不在业务日期有效期内",
    );
  const candidates = config.mappings.filter(
    (m) =>
      m.status === "ACTIVE" &&
      m.expenseType === d.expenseType &&
      date >= m.effectiveFrom &&
      (!m.effectiveTo || date <= m.effectiveTo),
  );
  const own = candidates.filter((m) => m.companyId === d.companyId),
    matches = own.length ? own : candidates.filter((m) => m.companyId === "*");
  evidence.matchedRules = structuredClone(matches);
  if (!matches.length)
    return out(
      ["固定资产购置", "预付款", "在建工程"].includes(d.expenseType)
        ? "REVIEW"
        : "INSUFFICIENT_DATA",
      ["固定资产购置", "预付款", "在建工程"].includes(d.expenseType)
        ? "当前业务可能涉及特殊会计处理，请财务人员确认；未推荐普通费用科目"
        : "当前费用类型尚未配置适用会计科目映射，请联系财务人员确认",
    );
  const signature = (m: (typeof matches)[number]) =>
    JSON.stringify([
      [...m.allowedAccountCodes].sort(),
      m.recommendedAccountCode,
    ]);
  if (new Set(matches.map(signature)).size > 1)
    return out("REVIEW", "同一优先级有效映射存在配置冲突，无法安全推荐");
  const m = matches[0]!;
  evidence.mappingRuleId = matches.map((m) => m.ruleId).join("、");
  evidence.recommendedAccountCode = m.recommendedAccountCode;
  evidence.allowedAccountCodes = [...m.allowedAccountCodes];
  if (d.accountCode && !m.allowedAccountCodes.includes(d.accountCode))
    return out("BLOCK", "当前费用类型与所选会计科目不符合适用企业映射规则");
  if (!d.accountCode)
    return out(
      "INSUFFICIENT_DATA",
      d.accountStage === "财务确认"
        ? "财务确认阶段必须选择或确认科目"
        : "待财务确认科目；员工无需填写，推荐不代表已确认，也不表示报销被驳回",
    );
  if (d.accountStage !== "财务确认")
    return out("INSUFFICIENT_DATA", "已有候选科目，仍待财务阶段明确确认");
  const scenario = config.scenarios.filter(
    (s) => s.scenario === d.businessScenario,
  );
  if (scenario.some((s) => !s.expenseTypes.includes(d.expenseType)))
    return out(
      "REVIEW",
      "费用类型与结构化业务场景可能不一致，请人工确认；未自动修改费用类型",
    );
  return out("PASS", "所选科目属于允许使用的科目范围，符合企业配置的映射规则");
}
