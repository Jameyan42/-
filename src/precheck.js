import { validateTravelStandard, travelChecks } from "./travel-policy.js";
import {
  invoiceEvidence,
  effectiveInvoiceBuyer,
  validateInvoiceBuyer,
} from "./invoice-data.js";
import { assertTravelSubmission, validateTravel } from "./travel.js";
// Fixed rule catalog, no eval, external model, invoice verification or arbitrary user code.
export const ruleCatalog = [
  {
    id: "expense-invoice",
    kind: "expense",
    label: "未填写发票号码",
    description: "缺号码时无法按号码查重；不等于没有开票。",
  },
  {
    id: "expense-file",
    kind: "expense",
    label: "未留存发票原文件",
    description: "只有旧附件名称，或没有分类为发票的已存原文件。",
  },
  {
    id: "expense-similar",
    kind: "expense",
    label: "疑似重复报销",
    description: "同一申请人、部门、日期、类型和分币金额，与其他有效单据一致。",
  },
  {
    id: "expense-age",
    kind: "expense",
    label: "单据日期距检查日过久",
    description: "按上海自然日计算，不把单据日期当作发票开具日期。",
    threshold: 90,
    min: 1,
    max: 365,
  },
  {
    id: "corporate-amount",
    kind: "corporate",
    label: "对公单笔大额",
    description: "本次金额大于配置阈值，不自动判断付款不合理。",
    threshold: 50000,
    min: 0.01,
    max: 1000000,
  },
  {
    id: "corporate-supplier",
    kind: "corporate",
    label: "供应商当前已停用",
    description: "在途单可能仍有合法付款义务，需核对停用原因。",
  },
  {
    id: "corporate-account",
    kind: "corporate",
    label: "当前档案与收款快照不一致",
    description: "比较主体、开户行、户名、账号；不回改在途快照。",
  },
  {
    id: "corporate-similar",
    kind: "corporate",
    label: "疑似重复对公支付",
    description: "同一合同、期望付款日和分币金额，与其他有效单据一致。",
  },
  {
    id: "corporate-date",
    kind: "corporate",
    label: "期望付款日超出合同起止范围",
    description: "尾款可在履约期后支付，需结合合同付款条件判断。",
  },
  {
    id: "corporate-usage",
    kind: "corporate",
    label: "合同累计占用接近总额",
    description: "在途及已付共同占用，达到配置百分比提示。",
    threshold: 90,
    min: 1,
    max: 100,
  },
];
ruleCatalog.push(
  {
    id: "invoice-buyer",
    kind: "both",
    label: "票面抬头/税号与财务基准不一致",
    description: "按已确认票面字段与财务统一基准核对；缺字段不视作一致。",
  },
  {
    id: "invoice-total",
    kind: "both",
    label: "多票合计与申请金额不同",
    description: "按分比较；分期或拆分可能合法，默认提醒人工核对。",
  },
  {
    id: "invoice-duplicate",
    kind: "both",
    label: "结构化票据号码重复",
    description: "检查本单多票及其他有效报销/对公单；不是发票真伪校验。",
  },
  {
    id: "invoice-arithmetic",
    kind: "both",
    label: "票面金额与税额勾稽不符",
    description: "不含税金额及税额均已采集时，检查两者之和是否等于价税合计。",
  },
);
export const basePolicy = {
  limit: 3000,
  requireReceipt: true,
  checkDuplicate: true,
};
export function defaultPrecheck() {
  return {
    schema: 1,
    version: 1,
    rules: ruleCatalog.map((r) => ({
      id: r.id,
      enabled: true,
      effect: "warn",
      ...(r.threshold === undefined ? {} : { threshold: r.threshold }),
    })),
  };
}
export function validatePrecheck(value) {
  if (
    !value ||
    value.schema !== 1 ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    value.version > 1000000 ||
    !Array.isArray(value.rules) ||
    ![10, ruleCatalog.length].includes(value.rules.length)
  )
    throw Error("预审规则配置格式或版本无效");
  const ids = new Set();
  for (const r of value.rules) {
    const c = ruleCatalog.find((c) => c.id === r?.id);
    if (
      !c ||
      ids.has(r.id) ||
      typeof r.enabled !== "boolean" ||
      !["warn", "block"].includes(r.effect) ||
      (c.threshold === undefined
        ? r.threshold !== undefined
        : !Number.isFinite(r.threshold) ||
          r.threshold < c.min ||
          r.threshold > c.max ||
          Math.abs(r.threshold * 100 - Math.round(r.threshold * 100)) > 1e-7) ||
      (["expense-age", "corporate-usage"].includes(r.id) &&
        !Number.isInteger(r.threshold))
    )
      throw Error("预审规则ID、开关、处理方式或阈值无效");
    ids.add(r.id);
  }
  if (
    value.rules.length === 10 &&
    value.rules.some((r) => r.id.startsWith("invoice-"))
  )
    throw Error("旧预审规则目录不完整");
  return value;
}
export function effectivePrecheck(policy = {}) {
  if (policy.precheck === undefined) return defaultPrecheck();
  const old = validatePrecheck(policy.precheck);
  return {
    ...old,
    rules: [
      ...old.rules,
      ...defaultPrecheck().rules.filter(
        (r) => !old.rules.some((x) => x.id === r.id),
      ),
    ],
  };
}
export function nextPrecheck(policy, rules) {
  return validatePrecheck({
    schema: 1,
    version: effectivePrecheck(policy).version + 1,
    rules,
  });
}
const cents = (n) => Math.round(n * 100);
const inactive = new Set(["草稿", "已撤回", "已退回"]);
const bounded = (s) => String(s ?? "").slice(0, 500);
function realDate(d) {
  return (
    typeof d === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !Number.isNaN(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d
  );
}
export function evaluatePrecheck(
  kind,
  doc,
  context = {},
  policy = basePolicy,
  at = new Date().toISOString(),
) {
  if (
    !["expense", "corporate"].includes(kind) ||
    !doc ||
    !Number.isFinite(Date.parse(at))
  )
    throw Error("预审检查参数无效");
  const config = effectivePrecheck(policy),
    legacy = {
      limit: policy.limit ?? basePolicy.limit,
      requireReceipt: policy.requireReceipt ?? true,
      checkDuplicate: policy.checkDuplicate ?? true,
    };
  const report = {
    schema: 1,
    kind,
    docId: doc.id,
    at,
    policy: {
      ...legacy,
      invoiceBuyer: structuredClone(effectiveInvoiceBuyer(policy)),
      precheck: structuredClone(config),
    },
    document: { amount: doc.amount, date: doc.date || "" },
    findings: [],
  };
  if (["草稿", "已撤回"].includes(doc.status)) return report;
  const add = (id, effect, message, evidence, suggestion) =>
    report.findings.push({
      id,
      effect,
      severity: effect === "block" ? "高" : "中",
      message: bounded(message),
      evidence: bounded(evidence),
      suggestion: bounded(suggestion),
    });
  const optional = (id, condition, message, evidence, suggestion) => {
    const r = config.rules.find((r) => r.id === id);
    if (r.enabled && condition)
      add(id, r.effect, message, evidence, suggestion);
  };
  const related = (rows) =>
    rows
      .slice(0, 3)
      .map((x) => x.id)
      .join("、") + (rows.length > 3 ? `等${rows.length}笔` : "");
  if (doc.invoices?.records?.length) {
    const buyer = effectiveInvoiceBuyer(policy),
      ev = invoiceEvidence(kind, doc, context, buyer);
    optional(
      "invoice-buyer",
      ev.buyer.length > 0,
      "票面抬头或税号与财务基准不一致",
      `基准 ${buyer.name}${buyer.taxId ? " / " + buyer.taxId : "（未设税号）"}；${ev.buyer.slice(0, 3).join("；")}`,
      "对照原件核实购买方及纳税人识别号；识别不清应修正字段，不自动视作通过。",
    );
    optional(
      "invoice-total",
      Math.round(ev.total * 100) !== Math.round(doc.amount * 100),
      "票面合计与申请金额不同",
      `已确认票面合计 ${ev.total} 元；申请 ${doc.amount} 元`,
      "核对是否漏票、部分报销、分期支付或金额填写错误。票面金额不自动覆盖申请金额。",
    );
    optional(
      "invoice-duplicate",
      ev.duplicates.length > 0,
      "结构化发票号码存在重复线索",
      ev.duplicates.slice(0, 3).join("；"),
      "核对同单或跨单票据是否重复使用；本浏览器匹配不等于税务验真或重复银行付款。",
    );
    optional(
      "invoice-arithmetic",
      ev.arithmetic.length > 0,
      "不含税金额加税额与价税合计不符",
      ev.arithmetic.slice(0, 3).join("；"),
      "对照票面复核三项金额及OCR小数点；未采集的金额不按零推断。",
    );
    if (context.enterpriseHealthy === false)
      add(
        "invoice-context",
        "block",
        "对公票据上下文无法读取，不能完整查重",
        "当前仅有部分报销数据可读",
        "恢复企业业务数据后再审核，不将部分查重结果视作完整。",
      );
  }
  if (kind === "expense") {
    const items = context.items || [];
    if (doc.travel)
      try {
        assertTravelSubmission(doc.travel, doc.amount, doc.type);
      } catch (e) {
        add(
          "travel-integrity",
          "block",
          e.message,
          "差旅明细与示例制度校验未通过",
          "退回核对行程、明细合计及超标说明。",
        );
      }
    if (doc.travel) {
      try {
        validateTravel(doc.travel, doc.amount, doc.type);
        const standard = doc.travel.standard;
        if (!standard)
          add(
            "travel-legacy",
            "warn",
            "旧差旅单未保存财务城市/人员职级标准快照",
            "仅按原手选示例档位复核，未按当前制度追溯改写",
            "人工核对原适用制度；退回重提时按财务维护标准生成新快照。",
          );
        else {
          report.policy.travelStandard = structuredClone(standard);
          if (!standard.cityMatched)
            add(
              "travel-city",
              "warn",
              "目的地未维护城市档",
              `${standard.city}未匹配；暂按其他城市标准，不能视作已核定城市`,
              "财务核实目的地，维护城市目录后必要时退回重提。",
            );
          if (!standard.gradeMatched)
            add(
              "travel-grade",
              "warn",
              "申请人尚未维护职级",
              `${standard.actorName} / ${standard.actorId}，暂按普通员工标准，非已核定职级`,
              "财务在差旅标准维护人员职级，必要时退回重提；不允许员工自行选高档。",
            );
          for (const [key, label] of [
            ["hotel", "住宿"],
            ["meal", "餐补"],
            ["local", "市内交通"],
          ]) {
            const hits = travelChecks(doc.travel).filter(
              (x) => x.key === key && x.excess > 0,
            );
            if (hits.length)
              add(
                "travel-" + key,
                standard.effects[key],
                `${label}超过城市/职级差旅标准`,
                `制度v${standard.version}；${standard.city} / ${standard.grade}；` +
                  hits
                    .slice(0, 3)
                    .map(
                      (x) =>
                        `${x.index ? "第" + x.index + "行" : x.date + "当日合计"}：${x.actual.toFixed(2)}元 > ${x.rate}元/${x.unit} × ${x.units}，超额${x.excess.toFixed(2)}元`,
                    )
                    .join("；"),
                "核对真实发生金额、天数/晚数及超标说明；说明或核对留痕不自动解除拦截。",
              );
          }
          if (
            doc.travel.lines.some((l) => l.category === "住宿") &&
            !doc.attachments?.some((f) => f.kind === "酒店水单")
          )
            add(
              "travel-hotel-folio",
              standard.effects.hotelFolio,
              "住宿缺少酒店水单",
              "存在住宿明细，未留存分类为酒店水单的附件；发票不自动替代水单",
              "补充酒店水单，核对入住人、日期及实际住宿晚数；系统只检查材料分类，不读取内容真实性。",
            );
          if (!doc.requestId)
            add(
              "travel-request",
              standard.effects.tripRequest,
              "差旅报销未关联事前费用申请",
              "单据未关联出差/费用申请；不代表业务不真实",
              "核对企业是否要求事前申请及补批依据；关联仍须通过申请额度、本人和行程校验。",
            );
        }
      } catch {
        /* The fixed travel-integrity finding above reports malformed data. */
      }
    }
    if (doc.amount > legacy.limit)
      add(
        "legacy-limit",
        "block",
        `超过单笔 ${legacy.limit.toLocaleString("zh-CN")} 元标准，需说明业务必要性`,
        `本单 ${doc.amount} 元；上限 ${legacy.limit} 元`,
        "退回核对金额与制度；确需变更标准时由财务填写原因调整规则。",
      );
    if (
      legacy.requireReceipt &&
      !doc.receipt &&
      !doc.attachments?.some((f) => f.kind === "发票")
    )
      add(
        "legacy-receipt",
        "block",
        "缺少票据附件，财务审核前需补充",
        "未记录原票据名称，也未留存发票类附件",
        "退回补充票据。酒店水单等证明材料不能代替发票。",
      );
    const duplicates = items.filter(
      (x) =>
        x.id !== doc.id && !inactive.has(x.status) && x.invoice === doc.invoice,
    );
    if (legacy.checkDuplicate && doc.invoice && duplicates.length)
      add(
        "legacy-duplicate",
        "block",
        "发票号码与历史报销重复，请核对",
        `号码 ${doc.invoice}；关联 ${related(duplicates)}`,
        "核对重复票据，退回修正；号码一致不等于已验真。",
      );
    optional(
      "expense-invoice",
      !String(doc.invoice || "").trim() &&
        !doc.invoices?.records?.some((r) => r.number),
      "未填写发票号码",
      "号码字段为空，无法完成号码查重",
      "核对是否需要发票，补录号码或说明特殊情形。",
    );
    optional(
      "expense-file",
      !doc.attachments?.some((f) => f.kind === "发票"),
      "未留存发票原文件",
      doc.receipt
        ? `仅记录旧票据名称：${doc.receipt}`
        : "未发现已留存的发票类原文件",
      "核对报销附件中的发票原文件。OCR来源或附件名称不代表文件已留存。",
    );
    const similar = items.filter(
      (x) =>
        x.id !== doc.id &&
        !inactive.has(x.status) &&
        x.department === doc.department &&
        x.employee === doc.employee &&
        (!x.approval?.applicantId ||
          !doc.approval?.applicantId ||
          x.approval.applicantId === doc.approval.applicantId) &&
        x.date === doc.date &&
        x.type === doc.type &&
        cents(x.amount) === cents(doc.amount),
    );
    optional(
      "expense-similar",
      similar.length > 0,
      "存在同人同日同类型同金额的有效报销",
      `匹配 ${related(similar)}；日期 ${doc.date}，金额 ${doc.amount} 元`,
      "核对是否为不同真实支出；仅提示疑似重复，不将匹配直接认定为违规。",
    );
    const today = new Date(at).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai",
      }),
      age = realDate(doc.date)
        ? Math.round((Date.parse(today) - Date.parse(doc.date)) / 86400000)
        : null,
      days = config.rules.find((r) => r.id === "expense-age").threshold;
    optional(
      "expense-age",
      age !== null && age > days,
      "单据日期距检查日超过配置天数",
      `单据日期 ${doc.date}；检查日 ${today}（上海）；相距 ${age} 天，阈值 ${days} 天`,
      "核对报销时效及延期原因；该日期不代表发票开具日期。",
    );
  } else {
    const state = context.enterprise,
      c = state?.contracts?.find((x) => x.id === doc.contractId),
      s = state?.suppliers?.find((x) => x.id === doc.supplierId);
    if (context.enterpriseHealthy === false || !state || !c || !s) {
      add(
        "corporate-context",
        "block",
        "无法完成对公关联校验",
        "合同或供应商上下文无法读取",
        "恢复完整有效数据后重试；不使用空数据冒充检查通过。",
      );
      return report;
    }
    const rows = state.payments || [],
      active = rows.filter(
        (p) => p.contractId === c.id && !inactive.has(p.status),
      );
    const total =
      active.reduce((n, p) => n + cents(p.amount), 0) +
      (active.some((p) => p.id === doc.id) ? 0 : cents(doc.amount));
    if (c.status !== "已复核" || c.version !== doc.contractVersion)
      add(
        "corporate-contract",
        "block",
        "合同尚未复核或版本不一致",
        `合同 ${c.number}；状态 ${c.status}；当前版本 ${c.version}，本单 ${doc.contractVersion}`,
        "退回核对已复核合同与版本。此项为固定完整性校验。",
      );
    if (total > cents(c.amount))
      add(
        "corporate-balance",
        "block",
        "合同累计在途及已付超过总额",
        `合同 ${c.amount} 元；累计 ${(total / 100).toFixed(2)} 元`,
        "退回核对合同额度；固定额度校验不可通过关闭提醒绕过。",
      );
    const cap = config.rules.find((r) => r.id === "corporate-amount").threshold;
    optional(
      "corporate-amount",
      doc.amount > cap,
      "对公单笔金额超过配置阈值",
      `本次 ${doc.amount} 元；阈值 ${cap} 元`,
      "核对用途、付款条件和审批依据；提示不等于认定付款异常。",
    );
    optional(
      "corporate-supplier",
      !s.active,
      "供应商当前已停用",
      `供应商 ${s.name}；当前停用；本单已提交`,
      "核对停用原因及存续付款义务。若需更新依据，退回处理。",
    );
    const changes = [
      ["name", "主体名称"],
      ["creditCode", "统一代码"],
      ["accountName", "收款户名"],
      ["bankName", "开户行"],
      ["bankAccount", "收款账号"],
    ].filter(([k]) => s[k] !== doc.supplierSnapshot?.[k]);
    optional(
      "corporate-account",
      changes.length > 0,
      "供应商当前档案与本单收款快照不一致",
      `变更字段：${changes.map((x) => x[1]).join("、")}；快照账号 ${doc.supplierSnapshot?.bankAccount}，当前账号 ${s.bankAccount}`,
      "核对账户变更授权。本单保留原快照，不自动更新；必要时退回重提。",
    );
    const similar = rows.filter(
      (p) =>
        p.id !== doc.id &&
        !inactive.has(p.status) &&
        p.contractId === doc.contractId &&
        p.date === doc.date &&
        cents(p.amount) === cents(doc.amount),
    );
    optional(
      "corporate-similar",
      similar.length > 0,
      "同合同同期望日同金额的有效对公单",
      `匹配 ${related(similar)}；期望日 ${doc.date}，金额 ${doc.amount} 元`,
      "核对是否重复申请或合法分期付款，不能仅凭匹配认定重复转账。",
    );
    optional(
      "corporate-date",
      realDate(doc.date) && (doc.date < c.startDate || doc.date > c.endDate),
      "期望付款日超出合同起止范围",
      `期望日 ${doc.date}；合同 ${c.startDate} 至 ${c.endDate}`,
      "核对合同尾款、账期与履约条件；期望日不是实际付款或到账日。",
    );
    const percent = config.rules.find(
      (r) => r.id === "corporate-usage",
    ).threshold;
    optional(
      "corporate-usage",
      total * 100 >= cents(c.amount) * percent,
      "合同累计占用达到配置比例",
      `在途加已付 ${(total / 100).toFixed(2)} 元 / 合同 ${c.amount} 元；阈值 ${percent}%`,
      "核对剩余合同额度及后续分期安排；不会计入原部门报销预算。",
    );
  }
  return report;
}
export function assertPrecheck(report, status) {
  if (!["待财务审核", "待总账复核", "待付款"].includes(status)) return;
  const blocked = report.findings.filter((f) => f.effect === "block");
  if (blocked.length)
    throw Error(
      `存在未解决的预审风险，不能通过：${blocked.map((f) => f.message).join("；")}`,
    );
}
export function validatePrecheckReport(r, kind, docId) {
  const text = (v, n) => typeof v === "string" && v.length <= n;
  const known = new Set([
    ...ruleCatalog.map((x) => x.id),
    "travel-integrity",
    "travel-legacy",
    "travel-city",
    "travel-grade",
    "travel-hotel",
    "travel-meal",
    "travel-local",
    "travel-hotel-folio",
    "travel-request",
    "legacy-limit",
    "legacy-receipt",
    "legacy-duplicate",
    "corporate-context",
    "corporate-contract",
    "corporate-balance",
    "invoice-context",
  ]);
  if (
    !r ||
    r.schema !== 1 ||
    r.kind !== kind ||
    r.docId !== docId ||
    !text(r.docId, 60) ||
    !r.docId ||
    !text(r.at, 40) ||
    !Number.isFinite(Date.parse(r.at)) ||
    !r.policy ||
    !Number.isFinite(r.policy.limit) ||
    r.policy.limit <= 0 ||
    r.policy.limit > 1000000 ||
    typeof r.policy.requireReceipt !== "boolean" ||
    typeof r.policy.checkDuplicate !== "boolean" ||
    !r.document ||
    !Number.isFinite(r.document.amount) ||
    r.document.amount < 0 ||
    r.document.amount > 1000000 ||
    !text(r.document.date, 10) ||
    !Array.isArray(r.findings) ||
    r.findings.length > 20
  )
    throw Error("预审结果快照格式无效");
  validatePrecheck(r.policy.precheck);
  if (r.policy.travelStandard !== undefined)
    validateTravelStandard(r.policy.travelStandard);
  if (r.policy.invoiceBuyer !== undefined)
    validateInvoiceBuyer(r.policy.invoiceBuyer);
  const ids = new Set();
  for (const f of r.findings) {
    if (
      !f ||
      !known.has(f.id) ||
      ids.has(f.id) ||
      !["warn", "block"].includes(f.effect) ||
      f.severity !== (f.effect === "block" ? "高" : "中") ||
      ![f.message, f.evidence, f.suggestion].every((v) => text(v, 500)) ||
      (kind === "expense" && f.id.startsWith("corporate-")) ||
      (kind === "corporate" &&
        !f.id.startsWith("corporate-") &&
        !f.id.startsWith("invoice-"))
    )
      throw Error("预审风险条目格式无效");
    ids.add(f.id);
  }
  if (JSON.stringify(r).length > 18000) throw Error("预审快照超过容量限制");
  return r;
}
export function appendPrecheck(doc, report) {
  validatePrecheckReport(report, "expense", doc.id);
  const history = doc.history.map((h, i) =>
    i === doc.history.length - 1
      ? { ...h, precheck: structuredClone(report) }
      : h,
  );
  return { ...doc, history };
}
