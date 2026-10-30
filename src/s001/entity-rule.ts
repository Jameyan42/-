import { calendarOrdinal } from "../r001/rule";
import type { Input, Invoice, RuleResult, Status, Context } from "./types";
export type Company = {
  companyId: string;
  companyName: string;
  taxpayerId: string;
  companyAliases: {
    name: string;
    taxpayerId?: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
  status: "启用" | "停用";
  effectiveFrom: string;
  effectiveTo: string | null;
};
export type EntityConfig = {
  version: number;
  companies: Company[];
  policies: {
    invoiceType: string;
    applicable: boolean;
    requireTaxId: boolean;
    reason: string;
  }[];
  minimumConfidence: number;
};
export const normalizeName = (s: string) => s.normalize("NFKC").trim();
export const normalizeTax = (s: string) =>
  s.normalize("NFKC").replace(/\s/g, "").toUpperCase();
const validDate = (s: string) => calendarOrdinal(s) !== null;
const active = (date: string, from: string, to: string | null) =>
  date >= from && (!to || date <= to);
export function defaultEntities(): EntityConfig {
  return {
    version: 1,
    minimumConfidence: 90,
    companies: ["深圳", "东莞", "上海"].map((city, i) => ({
      companyId: ["SZ", "DG", "SH"][i]!,
      companyName: `星河科技（${city}）有限公司`,
      taxpayerId: `DEMO-${["SZ", "DG", "SH"][i]}-001`,
      companyAliases:
        i === 0
          ? [
              {
                name: "深圳星河科技有限公司",
                effectiveFrom: "2020-01-01",
                effectiveTo: "2025-12-31",
              },
            ]
          : [],
      status: "启用",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
    })),
    policies: [
      "数电发票",
      "增值税电子普通发票",
      "增值税电子专用发票",
      "纸质发票",
    ]
      .map((invoiceType) => ({
        invoiceType,
        applicable: true,
        requireTaxId: true,
        reason: "模拟制度：企业抬头及购买方税号必填，非税法通用结论",
      }))
      .concat([
        {
          invoiceType: "客运票据（模拟特例）",
          applicable: false,
          requireTaxId: false,
          reason: "已明确的模拟客运票据特例，仅不执行R004，不豁免其他规则",
        },
      ]),
  };
}
export function validateEntities(c: EntityConfig) {
  if (
    !c ||
    !Number.isInteger(c.version) ||
    c.version < 1 ||
    !Array.isArray(c.companies) ||
    c.companies.length > 50 ||
    new Set(c.companies.map((x) => x.companyId)).size !== c.companies.length ||
    !Array.isArray(c.policies) ||
    new Set(c.policies.map((p) => p.invoiceType)).size !== c.policies.length ||
    !Number.isFinite(c.minimumConfidence) ||
    c.minimumConfidence < 0 ||
    c.minimumConfidence > 100
  )
    throw Error("法人政策配置无效");
  const text = (x: unknown) =>
    typeof x === "string" && x.trim().length > 0 && x.length <= 120;
  for (const co of c.companies) {
    if (
      !text(co.companyId) ||
      !text(co.companyName) ||
      !text(co.taxpayerId) ||
      !["启用", "停用"].includes(co.status) ||
      !validDate(co.effectiveFrom) ||
      (co.effectiveTo !== null &&
        (!validDate(co.effectiveTo) || co.effectiveTo < co.effectiveFrom)) ||
      !Array.isArray(co.companyAliases)
    )
      throw Error("法人名称、税号、状态或有效期无效");
    for (const a of co.companyAliases)
      if (
        !text(a.name) ||
        !validDate(a.effectiveFrom) ||
        (a.effectiveTo !== null &&
          (!validDate(a.effectiveTo) || a.effectiveTo < a.effectiveFrom)) ||
        (a.taxpayerId !== undefined && !text(a.taxpayerId))
      )
        throw Error("历史名称/税号授权期限无效");
  }
  for (const p of c.policies)
    if (
      !text(p.invoiceType) ||
      typeof p.applicable !== "boolean" ||
      typeof p.requireTaxId !== "boolean" ||
      !text(p.reason)
    )
      throw Error("票据政策无效");
}
export type BuyerCheck = {
  invoiceId: string;
  number: string;
  status: Status;
  message: string;
  missingFields: string[];
  buyerName: string;
  buyerTaxId: string;
  company: Company | null;
  matchedAlias: Company["companyAliases"][number] | null;
  recognition: unknown;
  policy: EntityConfig["policies"][number] | null;
};
export function checkBuyer(
  i: Invoice,
  d: Input,
  config: EntityConfig,
): BuyerCheck {
  const company =
      config.companies.find((c) => c.companyId === d.companyId) || null,
    policy = config.policies.find((p) => p.invoiceType === i.type) || null;
  const base = {
    invoiceId: i.id,
    number: i.number,
    buyerName: i.buyerName,
    buyerTaxId: i.buyerTaxId,
    company: structuredClone(company),
    matchedAlias: null,
    recognition: {
      source: i.source,
      status: i.recognitionStatus ?? "未确认",
      confidence: i.recognitionConfidence ?? null,
      taxStatus: i.buyerTaxStatus ?? "未确认",
    },
    policy: structuredClone(policy),
  };
  const out = (
    status: Status,
    message: string,
    missingFields: string[] = [],
    matchedAlias: Company["companyAliases"][number] | null = null,
  ): BuyerCheck => ({ ...base, status, message, missingFields, matchedAlias });
  if (!policy)
    return out("INSUFFICIENT_DATA", "尚未配置该票据类型的抬头政策", [
      "适用票据政策",
    ]);
  if (!policy.applicable) return out("NOT_APPLICABLE", policy.reason);
  if (!company)
    return out("INSUFFICIENT_DATA", "请选择存在的报销所属法人", [
      "报销所属公司",
    ]);
  if (!validDate(i.date))
    return out(
      "INSUFFICIENT_DATA",
      "开票日期无效，不能确定法人及历史名称适用期",
      ["开票日期"],
    );
  if (
    company.status !== "启用" ||
    !active(i.date, company.effectiveFrom, company.effectiveTo)
  )
    return out("REVIEW", "法人状态或信息有效期不适用，请人工核查");
  const name = normalizeName(i.buyerName),
    tax = normalizeTax(i.buyerTaxId),
    missing: string[] = [];
  if (!name) missing.push("购买方名称");
  if (policy.requireTaxId && !tax && i.buyerTaxStatus !== "票面确为空")
    missing.push("购买方税号（未确认原票是否为空）");
  if (i.recognitionStatus === "识别失败")
    missing.push("购买方识别失败，请人工补充");
  if (missing.length)
    return out("INSUFFICIENT_DATA", "购买方信息不足，不能自动通过", missing);
  const lowConfidence =
    i.source === "ocr-assisted" &&
    (typeof i.recognitionConfidence !== "number" ||
      !Number.isFinite(i.recognitionConfidence) ||
      i.recognitionConfidence < config.minimumConfidence);
  const confirmed = i.recognitionStatus === "已人工核对",
    reliable =
      confirmed || (i.source === "manual" && i.recognitionStatus === undefined);
  if (!reliable)
    return out(
      "REVIEW",
      lowConfidence
        ? "识别置信度不足或未知，请先核对原始票面，不认定为已确认错误"
        : "识别候选尚未人工核对，请先核对原票，不认定为已确认错误",
    );
  if (name === normalizeName(d.employee) && d.employee.trim())
    return out(
      "BLOCK",
      "已确认购买方为报销人个人姓名，本模拟企业票据政策要求法人抬头",
    );
  if (policy.requireTaxId && !tax)
    return out("BLOCK", "已确认原始票面购买方税号为空，不符合本模拟票据制度");
  const aliases = company.companyAliases.filter((a) =>
    active(i.date, a.effectiveFrom, a.effectiveTo),
  );
  const alias = aliases.find(
    (a) =>
      normalizeName(a.name) === name &&
      normalizeTax(a.taxpayerId || company.taxpayerId) === tax,
  );
  if (alias)
    return out(
      "PASS",
      "匹配有效历史名称及税号授权",
      [],
      structuredClone(alias),
    );
  const nameOK = name === normalizeName(company.companyName),
    taxOK = tax === normalizeTax(company.taxpayerId);
  if (nameOK && (taxOK || (!policy.requireTaxId && !tax)))
    return out("PASS", "发票购买方名称及纳税人识别号与报销所属法人一致");
  if (taxOK)
    return out(
      "REVIEW",
      "税号正确但名称不一致，未匹配当前开票日期有效的历史名称授权",
    );
  const other = config.companies.find(
    (c) =>
      c.companyId !== company.companyId && normalizeTax(c.taxpayerId) === tax,
  );
  if (other)
    return out(
      "BLOCK",
      `发票购买方税号属于另一法人主体${other.companyName}，不能因集团关系放行`,
    );
  return out(
    "BLOCK",
    nameOK
      ? "发票购买方税号与报销所属法人登记税号不一致"
      : "发票购买方名称及纳税人识别号均与报销所属法人不一致（含不符合企业抬头的个人票据）",
  );
}
export function buyerRule(d: Input, c: Context): RuleResult {
  const config = c.entityConfig;
  if (!config) throw Error("R004法人政策快照缺失");
  validateEntities(config);
  const details = d.invoices.map((i) => checkBuyer(i, d, config));
  const priorities: Status[] = [
    "ERROR",
    "BLOCK",
    "INSUFFICIENT_DATA",
    "REVIEW",
    "PASS",
    "NOT_APPLICABLE",
  ];
  const status: Status = !details.length
    ? "INSUFFICIENT_DATA"
    : priorities.find((s) => details.some((r) => r.status === s))!;
  return {
    ruleId: "R004",
    ruleKey: "invoice.buyer-entity",
    ruleName: "发票抬头与税号审核",
    status,
    severity:
      status === "PASS" || status === "NOT_APPLICABLE"
        ? "none"
        : status === "REVIEW"
          ? "medium"
          : "high",
    message: !details.length
      ? "未添加发票"
      : `逐张核对${details.length}张发票，${details.filter((r) => ["BLOCK", "REVIEW", "INSUFFICIENT_DATA"].includes(r.status)).length}张需处理`,
    evidence: {
      configVersion: config.version,
      companyId: d.companyId ?? null,
      details,
    },
    suggestedAction:
      status === "BLOCK"
        ? "修正法人或票面后重审，本期无例外授权"
        : status === "INSUFFICIENT_DATA"
          ? "补充或核对原票，可记录需补材料/已核实信息，不豁免重审"
          : "核查每张票据依据并记录财务意见",
  };
}
