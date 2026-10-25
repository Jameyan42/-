import type { HumanReview } from "../r001/types";
import { centsToYuan } from "../r001/rule";
export const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const formatYuan = (value: number | null | undefined): string =>
  value == null
    ? "未可靠采集"
    : `¥ ${centsToYuan(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
export const displayTime = (at: string): string =>
  new Date(at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  }) + "（上海）";
export function ruleLinks(current: "R001" | "R002" | "R003"): string {
  return `<div class="rule-links" aria-label="规则切换"><a href="./r001.html" data-rule="R001" ${current === "R001" ? 'aria-current="page"' : ""}>R001 · 住宿费超标</a><a href="./r002.html" data-rule="R002" ${current === "R002" ? 'aria-current="page"' : ""}>R002 · 发票重复报销</a><a href="./r003.html" data-rule="R003" ${current === "R003" ? 'aria-current="page"' : ""}>R003 · 合同付款条件</a></div>`;
}
export function humanReviewCard(review: HumanReview): string {
  return `<div class="human-result ${review.decision === "approved" ? "success" : "danger"}" data-testid="human-result"><span class="eyebrow">独立人工复核记录</span><h3>${review.decision === "approved" ? "人工通过" : "人工驳回"}</h3><p><b>复核原因：</b>${escapeHtml(review.reason)}</p><p class="muted">${escapeHtml(review.reviewer)} · ${escapeHtml(displayTime(review.at))}</p><small>原始自动审核结果保留，不代表已完成整单报销审批或付款。</small></div>`;
}
