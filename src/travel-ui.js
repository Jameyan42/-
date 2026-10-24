import { captureTravel, resolveTravelStandard } from "./travel-policy.js";
import { travelAssessment } from "./travel-policy-ui.js";
import {
  travelPolicyVersion,
  travelCategories,
  cityLevels,
  travelGrades,
  tripDuration,
  travelRates,
  validateTravel,
  travelWarnings,
} from "./travel.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const options = (list, value) =>
  list
    .map((x) => `<option ${x === value ? "selected" : ""}>${x}</option>`)
    .join("");
function tripFields(t = {}) {
  return `<div class="form-grid">${[
    ["origin", "出发地"],
    ["destination", "目的地"],
    ["start", "出发日期"],
    ["end", "返回日期"],
  ]
    .map(
      ([k, label]) =>
        `<label>${label}<input data-trip="${k}" type="${["start", "end"].includes(k) ? "date" : "text"}" ${["origin", "destination"].includes(k) ? 'maxlength="40"' : ""} value="${esc(t[k])}"></label>`,
    )
    .join(
      "",
    )}<label>目的地城市档<select data-trip="cityLevel">${options(cityLevels, t.cityLevel)}</select></label><label>示例职级档<select data-trip="grade">${options(travelGrades, t.grade)}</select></label></div><small>城市档自动匹配目的地，职级由财务维护并绑定人员，非HR鉴权。行程限同一月份、最多31天；住宿按晚数，餐补按自然日。</small>`;
}
export function travelForm(mode, existing) {
  const trip = mode === "request" ? existing : existing?.trip;
  return `<section class="review-box travel-form" data-travel-mode="${mode}"><label class="check-line"><input id="travel-enabled" type="checkbox" ${existing ? "checked" : ""}>${mode === "request" ? "这是出差行程申请" : "启用差旅费用明细"}</label><div id="travel-fields" ${existing ? "" : "hidden"}>${tripFields(trip)}<p id="travel-match" role="status"></p>${mode === "expense" ? `<h3>费用明细（最多20行）</h3><p class="footnote">每行金额为该行合计；住宿数量为晚数、餐补为天数，交通/其他为1。可在报销附件区上传多份证明材料；尚未逐行绑定或逐票OCR。</p><div id="travel-lines">${(existing?.lines || [{}]).map(lineForm).join("")}</div><button type="button" id="travel-add-line">＋ 添加明细</button><label>超标说明<textarea id="travel-exception" maxlength="500">${esc(existing?.exceptionReason)}</textarea></label><p id="travel-total" role="status"></p><div id="travel-checks" aria-live="polite"></div><small>超标说明不等于审批通过。启用差旅后，保存草稿也需完整的行程及明细；总金额由明细合计，OCR金额不会替代明细。</small>` : ""}</div></section>`;
}
function lineForm(l = {}) {
  return `<div class="travel-line"><div class="form-grid"><label>类别<select data-line="category">${options(travelCategories, l.category)}</select></label><label>发生/起始日期<input data-line="date" type="date" value="${esc(l.date)}"></label><label>行金额（元）<input data-line="amount" type="number" min="0.01" max="1000000" step="0.01" value="${esc(l.amount)}"></label><label>数量（晚/天/1）<input data-line="units" type="number" min="1" max="31" step="1" value="${esc(l.units ?? 1)}"></label></div><label>行备注<input data-line="note" maxlength="100" value="${esc(l.note)}"></label><button type="button" data-travel-remove>移除此行</button></div>`;
}
export function mountTravelForm(form, onChange = () => {}, context = null) {
  const capturedAt = new Date().toISOString();
  const enabled = form.querySelector("#travel-enabled"),
    fields = form.querySelector("#travel-fields"),
    mode = form.querySelector("[data-travel-mode]").dataset.travelMode;
  const rawTrip = () =>
    Object.fromEntries(
      [...form.querySelectorAll("[data-trip]")].map((e) => [
        e.dataset.trip,
        e.value.trim(),
      ]),
    );
  const readTrip = () => {
    const trip = rawTrip();
    if (!context) return trip;
    const standard = resolveTravelStandard(
      context.policy,
      context.actor,
      trip,
      capturedAt,
    );
    return { ...trip, cityLevel: standard.cityLevel, grade: standard.grade };
  };
  const readLegacy = () =>
    !enabled.checked
      ? null
      : mode === "request"
        ? readTrip()
        : {
            schema: 1,
            trip: readTrip(),
            policyVersion: travelPolicyVersion,
            exceptionReason: form
              .querySelector("#travel-exception")
              .value.trim(),
            lines: [...form.querySelectorAll(".travel-line")].map((row) =>
              Object.fromEntries(
                [...row.querySelectorAll("[data-line]")].map((e) => [
                  e.dataset.line,
                  ["amount", "units"].includes(e.dataset.line)
                    ? Number(e.value)
                    : e.value.trim(),
                ]),
              ),
            ),
          };
  const read = () => {
    const value = readLegacy();
    return value && mode === "expense" && context
      ? captureTravel(value, context.policy, context.actor, capturedAt)
      : value;
  };
  const refresh = () => {
    fields.hidden = !enabled.checked;
    fields
      .querySelectorAll("input,select,textarea,button")
      .forEach((e) => (e.disabled = !enabled.checked));
    if (context) {
      try {
        const s = resolveTravelStandard(
          context.policy,
          context.actor,
          rawTrip(),
          capturedAt,
        );
        for (const [key, value] of [
          ["cityLevel", s.cityLevel],
          ["grade", s.grade],
        ]) {
          const control = form.querySelector(`[data-trip=${key}]`);
          control.value = value;
          control.disabled = true;
        }
        form.querySelector("#travel-match").textContent =
          `制度v${s.version} · ${s.city || "待填目的地"}：${s.cityMatched ? s.cityLevel : "城市未维护，暂用其他城市"} · ${s.actorName}：${s.gradeMatched ? s.grade : "职级未维护，暂用普通员工"} · 住宿${s.hotel}/晚、餐补${s.meal}/天、市内交通${s.local}/天；${s.rateSource}`;
      } catch (e) {
        form.querySelector("#travel-match").textContent = e.message;
      }
    }
    if (mode === "expense") {
      form.elements.amount.readOnly = enabled.checked;
      if (enabled.checked) {
        const v = read(),
          total =
            v.lines.reduce((n, l) => n + Math.round(l.amount * 100), 0) / 100;
        form.elements.amount.value = total || "";
        form.querySelector("#travel-total").textContent =
          `明细合计：${Number.isFinite(total) ? total.toFixed(2) : "无效"} 元`;
        try {
          validateTravel(v, total, form.elements.type.value);
          const warnings = travelWarnings(v);
          form.querySelector("#travel-checks").innerHTML = warnings.length
            ? warnings.map((w) => `<p class="risk">${esc(w)}</p>`).join("")
            : '<p class="safe">金额未超过适用差旅标准；仍需核对材料、业务真实性及事前申请。</p>';
        } catch (e) {
          form.querySelector("#travel-checks").textContent = e.message;
        }
      }
    }
  };
  enabled.addEventListener("change", () => {
    if (enabled.checked) form.elements.type.value = "差旅交通";
    refresh();
    form.dataset.dirty = "true";
    onChange();
  });
  fields.addEventListener("input", () => {
    refresh();
    form.dataset.dirty = "true";
  });
  fields.addEventListener("change", () => {
    refresh();
    onChange();
  });
  fields.addEventListener("click", (e) => {
    if (e.target.closest("[data-travel-remove]")) {
      e.target.closest(".travel-line").remove();
      refresh();
      form.dataset.dirty = "true";
      onChange();
    }
  });
  form.querySelector("#travel-add-line")?.addEventListener("click", () => {
    if (form.querySelectorAll(".travel-line").length >= 20) {
      form.querySelector("#travel-checks").textContent = "最多20行明细";
      return;
    }
    form
      .querySelector("#travel-lines")
      .insertAdjacentHTML("beforeend", lineForm({ date: readTrip().start }));
    refresh();
    form.dataset.dirty = "true";
    onChange();
  });
  refresh();
  return {
    read,
    refresh,
    setTrip(t) {
      enabled.checked = true;
      for (const e of form.querySelectorAll("[data-trip]"))
        e.value = t[e.dataset.trip];
      form.elements.type.value = "差旅交通";
      refresh();
    },
  };
}
export function tripSummary(t) {
  if (!t) return "";
  let duration;
  try {
    duration = tripDuration(t);
  } catch {
    return '<p class="risk">行程格式异常，请核对。</p>';
  }
  return `<div class="review-box trip-summary"><h3>出差行程</h3><p>${esc(t.origin)} → ${esc(t.destination)} · ${esc(t.start)} 至 ${esc(t.end)}</p><p>${duration.days}天 / ${duration.nights}晚 · ${esc(t.cityLevel)} · ${esc(t.grade)}</p></div>`;
}
export function travelSummary(v) {
  if (!v) return "";
  try {
    validateTravel(
      v,
      v.lines.reduce((n, l) => n + Math.round(l.amount * 100), 0) / 100,
      "差旅交通",
    );
  } catch (e) {
    return `<div class="review-box risk">差旅数据或标准快照异常：${esc(e.message)}。请恢复有效备份或退回核对，不将部分数据视作通过。</div>`;
  }
  return `${tripSummary(v.trip)}${travelAssessment(v)}<div class="review-box travel-summary"><h3>差旅费用明细</h3><div class="table-wrap"><table><thead><tr><th>类别/日期</th><th>数量</th><th>金额</th><th>备注</th></tr></thead><tbody>${v.lines.map((l) => `<tr><td>${esc(l.category)}<small>${esc(l.date)}</small></td><td>${l.units}</td><td>${l.amount.toFixed(2)}</td><td>${esc(l.note)}</td></tr>`).join("")}</tbody></table></div><p>明细格式版本：${esc(v.policyVersion)}</p>${travelWarnings(
    v,
  )
    .map((w) => `<p class="risk">${esc(w)}</p>`)
    .join(
      "",
    )}${v.exceptionReason ? `<p>超标说明：${esc(v.exceptionReason)}</p>` : ""}<small>超标有说明后仍需人工审核；未做票据验真或实际转账。</small></div>`;
}
export { travelStandardsView } from "./travel-policy-ui.js";
