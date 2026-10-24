import { canHandleDocument } from "./inbox.js";
import { validatePrecheckReport } from "./precheck.js";
export const riskDecisions = ["已核对", "待补充", "建议退回"];
const text = (v, max) => typeof v === "string" && !!v.trim() && v.length <= max;
const instant = (v) =>
  text(v, 40) &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v));
const roles = ["主管", "管理员", "财务", "总账", "付款"];
export function validateRiskReviews(records, kind, docId) {
  if (records === undefined) return [];
  if (
    !["expense", "corporate"].includes(kind) ||
    !Array.isArray(records) ||
    records.length > 100
  )
    throw Error("每单最多100条风险核对记录，旧记录不会自动删除");
  const ids = new Set();
  for (const r of records) {
    if (
      !r ||
      r.schema !== 1 ||
      r.kind !== kind ||
      r.docId !== docId ||
      !text(r.id, 60) ||
      ids.has(r.id) ||
      !instant(r.at) ||
      !text(r.actorId, 60) ||
      !text(r.actorName, 30) ||
      !roles.includes(r.role) ||
      !riskDecisions.includes(r.decision) ||
      !text(r.note, 500) ||
      r.note.trim().length < 5 ||
      !/^[a-f0-9]{64}$/.test(r.basis) ||
      !(r.runId === null || instant(r.runId)) ||
      !(
        r.flowVersion === null ||
        (Number.isInteger(r.flowVersion) && r.flowVersion > 0)
      ) ||
      (r.runId === null) !== (r.flowVersion === null) ||
      !text(r.stage, 40) ||
      !Array.isArray(r.evidence) ||
      r.evidence.length > 1 ||
      r.evidence.some(
        (f) => !f || !text(f.id, 60) || !text(f.name, 120) || !text(f.kind, 30),
      )
    )
      throw Error("风险核对记录格式、人员、结论或依据无效");
    validatePrecheckReport(r.report, kind, docId);
    if (r.report.findings.length !== 1 || r.report.findings[0].id !== r.ruleId)
      throw Error("风险核对记录的规则与预审快照不一致");
    ids.add(r.id);
  }
  if (JSON.stringify(records).length > 400000)
    throw Error("风险核对记录超过本地容量上限，原记录未改动");
  return records;
}
function canonical(v) {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
async function digest(value) {
  if (!globalThis.crypto?.subtle)
    throw Error("当前页面缺少安全计算能力，请使用HTTPS在线版或localhost");
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function documentBasis(doc) {
  // Status/cursor and processing history may advance; underlying business facts must not change.
  const {
    history,
    riskReviews,
    flags,
    status,
    ledgerReview,
    payment,
    ...business
  } = doc;
  if (business.approval) {
    const { cursor, ...snapshot } = business.approval;
    business.approval = snapshot;
  }
  return digest(business); // Includes original file bytes, never just their names.
}
function selectedReport(report, finding) {
  const { at, ...basis } = report;
  return { ...basis, findings: [finding] };
}
const basisFor = (hash, report, finding) =>
  digest({ schema: 1, document: hash, check: selectedReport(report, finding) });
export async function riskReviewRows(doc, kind, report) {
  const records = validateRiskReviews(doc.riskReviews, kind, doc.id);
  validatePrecheckReport(report, kind, doc.id);
  const hash = await documentBasis(doc);
  const bases = new Map(
    await Promise.all(
      report.findings.map(async (f) => [f.id, await basisFor(hash, report, f)]),
    ),
  );
  return records.map((r) => ({
    record: r,
    current: bases.has(r.ruleId) && bases.get(r.ruleId) === r.basis,
    active: bases.has(r.ruleId),
  }));
}
export async function appendRiskReview(doc, kind, actor, report, input) {
  validateRiskReviews(doc.riskReviews, kind, doc.id);
  validatePrecheckReport(report, kind, doc.id);
  if (!actor?.active || !canHandleDocument(doc, kind, actor))
    throw Error("仅当前节点指定处理人可记录风险核对");
  if (
    report.document.amount !== doc.amount ||
    report.document.date !== (doc.date || "")
  )
    throw Error("单据与当前检查不一致，请重新检查");
  const finding = report.findings.find((f) => f.id === input.ruleId);
  if (!finding) throw Error("该风险当前未命中，请刷新检查后记录");
  const note = String(input.note || "").trim();
  if (
    !riskDecisions.includes(input.decision) ||
    note.length < 5 ||
    note.length > 500
  )
    throw Error("请选择核对结论，填写5～500字的依据或待补材料");
  const file = input.evidenceId
    ? doc.attachments?.find((f) => f.id === input.evidenceId)
    : null;
  if (input.evidenceId && !file) throw Error("关联材料已变化，请重新选择");
  const node =
    doc.status === "待付款"
      ? doc.approval?.paymentActor || doc.approval?.nodes.at(-1)
      : doc.approval?.nodes[doc.approval.cursor];
  const record = {
    schema: 1,
    id: crypto.randomUUID(),
    kind,
    docId: doc.id,
    ruleId: finding.id,
    basis: await basisFor(await documentBasis(doc), report, finding),
    runId: doc.approval?.submittedAt || null,
    flowVersion: doc.approval?.version || null,
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    role: actor.role,
    stage: doc.status === "待付款" ? "付款登记" : node?.label || doc.status,
    decision: input.decision,
    note,
    evidence: file ? [{ id: file.id, name: file.name, kind: file.kind }] : [],
    report: structuredClone({ ...report, findings: [finding] }),
  };
  const next = { ...doc, riskReviews: [...(doc.riskReviews || []), record] };
  validateRiskReviews(next.riskReviews, kind, doc.id);
  return next;
}
export function riskReviewCsv(rows) {
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^\s*[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [
      [
        "单据类型",
        "单号",
        "风险规则",
        "当时疑点",
        "当时依据",
        "当时处理方式",
        "核对结论",
        "当前有效性",
        "核对人",
        "当时岗位",
        "节点",
        "核对时间",
        "说明/待补材料",
        "关联材料名称",
        "规则版本",
        "核对时金额",
        "核对时单据日期",
        "流程版本",
        "提交轮次",
      ],
      ...rows.map(({ record: r, current, active }) => [
        r.kind === "expense" ? "报销" : "对公支付",
        r.docId,
        r.ruleId,
        r.report.findings[0].message,
        r.report.findings[0].evidence,
        r.report.findings[0].effect === "block" ? "拦截" : "提醒",
        r.decision,
        current
          ? "当前依据一致"
          : active
            ? "依据已变化，需重新核对"
            : "当前未命中，仅保留历史",
        r.actorName,
        r.role,
        r.stage,
        r.at,
        r.note,
        r.evidence.map((f) => f.name).join(" / "),
        r.report.policy.precheck.version,
        r.report.document.amount,
        r.report.document.date,
        r.flowVersion || "历史固定流程",
        r.runId || "旧流程未提供",
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
