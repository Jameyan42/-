import {
  effectiveTravelRules,
  travelLevels,
  employeeGrades,
  cityName,
  travelChecks,
} from "./travel-policy.js";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const options = (list, value) =>
  list
    .map(
      (x) =>
        `<option value="${esc(x)}" ${x === value ? "selected" : ""}>${esc(x)}</option>`,
    )
    .join("");
function overrideRow(r = {}) {
  return `<article class="review-box" data-city-override><div class="form-grid"><label>城市名称<input data-override="city" maxlength="40" value="${esc(r.city)}" placeholder="如上海"></label><label>职级<select data-override="grade">${options(employeeGrades, r.grade)}</select></label>${[
    ["hotel", "住宿/晚"],
    ["meal", "餐补/天"],
    ["local", "市内交通/天"],
  ]
    .map(
      ([k, label]) =>
        `<label>${label}<input data-override="${k}" type="number" min="0" max="100000" step="0.01" required value="${r[k] ?? 0}"></label>`,
    )
    .join(
      "",
    )}</div><button type="button" data-remove-city-override>移除此未发布特例</button></article>`;
}
export function travelStandardsView(
  policy = {},
  org = { people: [] },
  editable = false,
  healthy = true,
) {
  const r = effectiveTravelRules(policy);
  return `<section class="panel prose travel-policy"><h2>差旅标准与规则预审 · v${r.version}</h2><p>以下为企业可维护的示例制度，不代表法定标准或真实公司制度。城市自动匹配、职级绑定人员；员工不能自行选择高档。未知城市/未维护职级会明确提醒人工核实。</p><p>新报销保存提交时标准快照；制度修改作用于新单和退回重提，不追溯改写在途单。旧单无快照时保留原示例检查并提示人工核对。</p>${healthy ? "" : '<p class="risk">规则存储异常，原值保留，发布与差旅提交暂停，请恢复有效备份。</p>'}<form id="travel-policy-form"><fieldset ${editable && healthy ? "" : "disabled"}><h3>城市档 × 人员职级</h3><div class="table-wrap"><table><thead><tr><th>城市档</th><th>职级</th><th>住宿/晚</th><th>餐补/天</th><th>市内交通/天</th></tr></thead><tbody>${r.rates.map((x, i) => `<tr data-travel-rate="${i}"><td>${esc(x.level)}</td><td>${esc(x.grade)}</td>${["hotel", "meal", "local"].map((k) => `<td><input aria-label="${x.level}${x.grade}${k}" data-rate="${k}" type="number" min="0" max="100000" step="0.01" required value="${x[k]}" style="min-width:90px"></td>`).join("")}</tr>`).join("")}</tbody></table></div><p>住宿上限＝每晚标准×实际晚数；餐补上限＝每天标准×天数；同一日期的多笔市内交通合并后检查，不能靠拆行绕过。0元标准也参与检查。城际交通票价和席别暂由财务人工核对。</p><h3>城市目录</h3><p>每行一个城市，如“上海”或“上海市”；匹配忽略空白/全半角及末尾“市”。不推断“上海浦东”等模糊目的地，最多100城。</p><div class="form-grid">${travelLevels
    .map(
      (level, i) =>
        `<label>${level}<textarea data-city-level="${level}" id="travel-cities-${i}" maxlength="4500" rows="5">${esc(
          r.cities
            .filter((c) => c.level === level)
            .map((c) => c.name)
            .join("\n"),
        )}</textarea></label>`,
    )
    .join(
      "",
    )}</div><h3>单城市独立标准（可选）</h3><p>同城市同职级只能一条，优先于城市档标准；必须先维护城市目录，最多50条。</p><div id="travel-city-overrides">${r.overrides.map(overrideRow).join("")}</div><button type="button" id="travel-add-override">＋ 添加城市特例</button><h3>人员职级</h3><p>职级与审批角色分开维护，按人员ID绑定，同名不合并；此处仍为演示维护，未接入HR。</p><div class="form-grid">${org.people.map((p) => `<label>${esc(p.name)} · ${esc(p.id)}${p.active ? "" : "（停用）"}<select data-travel-person="${esc(p.id)}"><option value="">未维护（提示人工核对）</option>${options(employeeGrades, r.employees.find((x) => x.id === p.id)?.grade)}</select></label>`).join("")}</div><h3>风险处理方式</h3><p>默认提醒人工核对，可改为拦截财务/总账/付款通过；员工仍可填说明提交，主管可转交。说明及“已核对”不解除拦截。</p><div class="form-grid">${[
    ["hotel", "住宿超标"],
    ["meal", "餐补超标"],
    ["local", "市内交通超标"],
    ["hotelFolio", "住宿缺酒店水单"],
    ["tripRequest", "未关联事前申请"],
  ]
    .map(
      ([key, label]) =>
        `<label>${label}<select data-travel-effect="${key}"><option value="warn" ${r.effects[key] === "warn" ? "selected" : ""}>提醒人工核对</option><option value="block" ${r.effects[key] === "block" ? "selected" : ""}>拦截财务/总账/付款</option></select></label>`,
    )
    .join(
      "",
    )}</div><label>制度变更原因<textarea name="travelReason" minlength="5" maxlength="200" required placeholder="填写5～200字调整原因"></textarea></label><button type="submit" class="primary">发布差旅制度</button></fieldset>${editable ? "" : '<p class="footnote">切换财务身份维护制度；员工只读查看适用标准。</p>'}</form><div class="review-box"><b>当前版本维护记录</b><p>${esc(r.change.actorName)} / ${esc(r.change.actorId)} · ${esc(r.publishedAt)}</p><p>${esc(r.change.reason)}</p><p>历史处理时的标准与风险结果保留在报销预审快照中；变更操作另记操作记录。未提供生效日期排程、多目的地分段、自动核验酒店内容或自动审批。</p></div></section>`;
}
export function bindTravelPolicyRows(form, policy) {
  form.querySelector("#travel-add-override").onclick = () => {
    if (form.querySelectorAll("[data-city-override]").length >= 50) return;
    form
      .querySelector("#travel-city-overrides")
      .insertAdjacentHTML("beforeend", overrideRow());
    form.dataset.dirty = "true";
  };
  form.onclick = (e) => {
    if (e.target.closest("[data-remove-city-override]")) {
      e.target.closest("[data-city-override]").remove();
      form.dataset.dirty = "true";
    }
  };
  form.oninput = () => {
    form.dataset.dirty = "true";
  };
  return () => {
    const old = effectiveTravelRules(policy),
      people = [...form.querySelectorAll("[data-travel-person]")],
      ids = people.map((p) => p.dataset.travelPerson);
    return {
      ...structuredClone(old),
      cities: [...form.querySelectorAll("[data-city-level]")].flatMap((input) =>
        input.value
          .split(/\r?\n/)
          .filter((x) => x.trim())
          .map((name) => ({
            name: cityName(name),
            level: input.dataset.cityLevel,
          })),
      ),
      rates: [...form.querySelectorAll("[data-travel-rate]")].map((row) => ({
        ...old.rates[Number(row.dataset.travelRate)],
        ...Object.fromEntries(
          [...row.querySelectorAll("[data-rate]")].map((i) => [
            i.dataset.rate,
            Number(i.value),
          ]),
        ),
      })),
      overrides: [...form.querySelectorAll("[data-city-override]")].map((row) =>
        Object.fromEntries(
          [...row.querySelectorAll("[data-override]")].map((i) => [
            i.dataset.override,
            ["hotel", "meal", "local"].includes(i.dataset.override)
              ? Number(i.value)
              : i.dataset.override === "city"
                ? cityName(i.value)
                : i.value,
          ]),
        ),
      ),
      employees: old.employees
        .filter((x) => !ids.includes(x.id))
        .concat(
          people
            .filter((i) => i.value)
            .map((i) => ({ id: i.dataset.travelPerson, grade: i.value })),
        ),
      effects: Object.fromEntries(
        [...form.querySelectorAll("[data-travel-effect]")].map((i) => [
          i.dataset.travelEffect,
          i.value,
        ]),
      ),
    };
  };
}
export function travelAssessment(v) {
  if (!v.standard)
    return '<p class="footnote">旧单未保存城市/职级财务标准快照，需人工核对原制度。</p>';
  const s = v.standard,
    rows = travelChecks(v);
  return `<section class="travel-assessment"><h4>提交时差旅标准 · v${s.version}</h4><p>${esc(s.city)} / ${esc(s.cityLevel)} / ${esc(s.grade)} · ${esc(s.rateSource)} · ${esc(s.actorName)}（${esc(s.actorId)}）</p>${s.cityMatched ? "" : '<p class="risk">城市未匹配，暂用其他城市档，需财务核实。</p>'}${s.gradeMatched ? "" : '<p class="risk">职级未维护，暂用普通员工档，需财务核实。</p>'}<div class="table-wrap"><table><thead><tr><th>核对项目</th><th>标准计算</th><th>实际金额</th><th>超额</th><th>处理方式</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.category)}<small>${x.index ? "第" + x.index + "行 · " : "当日合计 · "}${esc(x.date)}</small></td><td>${x.rate}元/${x.unit} × ${x.units}＝${x.cap.toFixed(2)}</td><td>${x.actual.toFixed(2)}</td><td class="${x.excess ? "risk" : "safe"}">${x.excess.toFixed(2)}</td><td>${s.effects[x.key] === "block" ? "超标拦截" : "超标提醒"}</td></tr>`).join("")}</tbody></table></div><small>仅展示金额标准计算；材料及事前申请检查见规则预审，不代表自动审批或票据验真。</small></section>`;
}
