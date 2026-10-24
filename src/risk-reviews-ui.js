import {
  appendRiskReview,
  riskReviewRows,
  riskReviewCsv,
  riskDecisions,
} from "./risk-reviews.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const time = (v) =>
  new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
export function riskReviewPanel() {
  return `<section class="review-box risk-review-panel"><h3>风险逐项核对</h3><p>记录人工核对依据或待补材料，不代表疑点已消除、发票真实或审批通过；“已核对”不会解除原有拦截。</p><p data-risk-state role="status" aria-live="polite">正在对比当前依据…</p><div data-risk-current></div><div data-risk-editor></div><details class="risk-review-history"><summary>查看全部核对记录</summary><div data-risk-history></div></details><button type="button" data-risk-export disabled>导出本单核对记录 CSV</button></section>`;
}
export function mountRiskReviews(
  root,
  { kind, getDoc, getReport, getActor, editable, healthy = true, save },
) {
  const panel = root.querySelector(".risk-review-panel"),
    state = panel.querySelector("[data-risk-state]"),
    editor = panel.querySelector("[data-risk-editor]");
  let rows = [],
    busy = false;
  async function refresh() {
    try {
      const doc = getDoc(),
        report = getReport();
      rows = await riskReviewRows(doc, kind, report);
      if (!panel.isConnected) return;
      const latest = report.findings.map((f) => ({
        finding: f,
        row: rows.findLast((r) => r.record.ruleId === f.id),
      }));
      state.textContent = healthy
        ? `当前命中 ${latest.length} 项；其中 ${latest.filter((x) => x.row?.current && x.row.record.decision === "已核对").length} 项有当前依据下的已核对说明。记录不自动流转单据。`
        : "相关数据异常，当前依据比对不完整；历史记录仅供回看，暂停记录和导出。";
      panel.querySelector("[data-risk-current]").innerHTML =
        latest
          .map(
            ({ finding: f, row }) =>
              `<article class="risk-review-item"><b>${esc(f.message)}</b><p>${row ? `${esc(row.record.actorName)}（${esc(row.record.role)}）：${esc(row.record.decision)} · ${!healthy ? "当前依据状态未知" : row.current ? "当前依据一致" : "依据已变化，需重新核对"}` : "尚无人工核对记录"}</p>${row ? `<p>${esc(row.record.note)}</p>` : ""}</article>`,
          )
          .join("") ||
        "<p>当前未命中规则疑点；历史记录仍保留，不推断已验真。</p>";
      panel.querySelector("[data-risk-history]").innerHTML =
        [...rows]
          .reverse()
          .map(
            ({ record: r, current, active }) =>
              `<article class="risk-review-record"><b>${esc(r.decision)} · ${esc(r.report.findings[0].message)}</b><p>${esc(r.actorName)} / ${esc(r.role)} / ${esc(r.stage)} · ${esc(time(r.at))}（上海）</p><p class="${current ? "safe" : "precheck-warning"}">${!healthy ? "当前依据状态未知" : current ? "当前依据一致" : active ? "依据已变化，需重新核对" : "当前未命中，仅保留历史"}</p><p>${esc(r.note)}</p><p>核对时申请：¥${Number(r.report.document.amount).toFixed(2)} / 单据日期 ${esc(r.report.document.date || "未提供")} / 流程 ${r.flowVersion ? "v" + r.flowVersion : "历史固定流程"}</p>${r.evidence.map((f) => `<p>核对时关联：${esc(f.name)}（${esc(f.kind)}）${doc.attachments?.some((a) => a.id === f.id) ? "，原文件在本单附件中" : "，当前单据已不含此原件"}</p>`).join("")}<details><summary>核对时的触发依据</summary><p>${esc(r.report.findings[0].evidence)}</p><p>规则 v${r.report.policy.precheck.version} · ${r.report.findings[0].effect === "block" ? "拦截" : "提醒"}</p></details></article>`,
          )
          .join("") || "<p>尚无核对记录，旧审批备注不会自动转成逐项结论。</p>";
      const can = healthy && editable();
      editor.innerHTML =
        can && latest.length
          ? `<form class="risk-review-editor" data-risk-form><label>本次核对疑点<select data-risk-rule>${latest.map(({ finding: f }) => `<option value="${esc(f.id)}">${esc(f.message)}</option>`).join("")}</select></label><label>人工结论<select data-risk-decision>${riskDecisions.map((d) => `<option>${esc(d)}</option>`).join("")}</select></label><label>核对依据 / 待补材料（5～500字）<textarea data-risk-note maxlength="500" placeholder="说明已查看的材料、判断依据或需申请人补充的内容"></textarea></label><label>关联本单已保存材料（可选）<select data-risk-evidence><option value="">不关联文件</option>${(doc.attachments || []).map((f) => `<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.kind)}</option>`).join("")}</select></label><button type="button" data-risk-save>保存本项核对记录</button><button type="button" data-risk-clear>放弃本次未保存填写</button></form>`
          : `<p class="footnote">${!healthy ? "相关规则或业务数据异常，暂停记录；原始数据保留。" : "仅当前节点处理人可追加核对；其他身份及已结束单据只读。"}</p>`;
      panel.querySelector("[data-risk-export]").disabled =
        !healthy || !rows.length;
      const form = editor.querySelector("[data-risk-form]");
      form?.addEventListener("submit", (e) => e.preventDefault());
      editor
        .querySelector("[data-risk-clear]")
        ?.addEventListener("click", () => {
          form.reset();
          form.dataset.dirty = "false";
          state.textContent = "已清空本次未保存填写，已保存核对记录保留。";
        });
      const dirty = () => {
        const form = editor.querySelector("[data-risk-form]");
        if (form) form.dataset.dirty = "true";
      };
      editor
        .querySelectorAll("textarea,select")
        .forEach((el) => el.addEventListener("input", dirty));
      editor
        .querySelector("[data-risk-save]")
        ?.addEventListener("click", async () => {
          if (busy) return;
          busy = true;
          const button = editor.querySelector("[data-risk-save]");
          button.disabled = true;
          try {
            const original = getDoc(),
              actor = getActor();
            if (!healthy || !editable())
              throw Error("当前身份或相关数据状态已变化，请重新查看");
            const next = await appendRiskReview(
              original,
              kind,
              actor,
              getReport(),
              {
                ruleId: editor.querySelector("[data-risk-rule]").value,
                decision: editor.querySelector("[data-risk-decision]").value,
                note: editor.querySelector("[data-risk-note]").value,
                evidenceId: editor.querySelector("[data-risk-evidence]").value,
              },
            );
            if (!panel.isConnected) return;
            if (
              getDoc() !== original ||
              getActor()?.id !== actor.id ||
              !editable()
            )
              throw Error("单据或处理人已变化，未保存，请重新查看");
            save(next);

            await refresh();
            state.textContent += " 已保存一条核对记录，审批状态未改变。";
          } catch (e) {
            if (panel.isConnected) state.textContent = e.message;
          } finally {
            busy = false;
            if (button.isConnected) button.disabled = false;
          }
        });
    } catch (e) {
      if (panel.isConnected) {
        state.textContent =
          "核对记录无法读取：" +
          e.message +
          "。原始数据未改动，请恢复有效备份。";
        editor.innerHTML = "";
        panel.querySelector("[data-risk-export]").disabled = true;
      }
    }
  }
  panel.querySelector("[data-risk-export]").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([riskReviewCsv(rows)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "轻报-本单风险核对记录.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  void refresh();
}
