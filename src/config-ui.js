import { roles } from "./organization.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const option = (value, label, current) =>
  `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
const selectorLabels = {
  manager: "申请人的直属主管",
  departmentHead: "申请人部门负责人",
  person: "指定人员",
};
export function orgView(org, role, mode = "departments") {
  const person = (p) =>
    `<div class="org-person"><span class="avatar">${esc(p.name[0])}</span><div><b>${esc(p.name)}</b><small>${esc(p.role)} · ${esc(org.departments.find((d) => d.id === p.departmentId)?.name)} · 上级 ${esc(org.people.find((x) => x.id === p.managerId)?.name || "无")}</small></div><span class="badge ${p.active ? "s3" : "s4"}">${p.active ? "在岗" : "停用"}</span>${role === "管理员" ? `<button class="link" data-edit-person="${esc(p.id)}">编辑</button>` : ""}</div>`;
  const department = (d) =>
    `<li><details open><summary><b>${esc(d.name)}</b><span>负责人：${esc(org.people.find((p) => p.id === d.headId)?.name || "未设置")}</span></summary><div class="org-content">${role === "管理员" ? `<button data-edit-department="${esc(d.id)}">编辑部门</button>` : ""}${org.people
      .filter((p) => p.departmentId === d.id)
      .map(person)
      .join("")}</div><ul>${org.departments
      .filter((x) => x.parentId === d.id)
      .map(department)
      .join("")}</ul></details></li>`;
  const report = (p) =>
    `<li>${person(p)}<ul>${org.people
      .filter((x) => x.managerId === p.id)
      .map(report)
      .join("")}</ul></li>`;
  return `<section class="panel prose"><div class="panel-title config-heading"><div><h3>组织架构</h3><span>部门归属与人员汇报分开维护，审批节点按规则解析具体人员。</span></div>${role === "管理员" ? '<div><button id="add-department">＋ 部门</button> <button id="add-person" class="primary">＋ 人员</button></div>' : '<span class="badge">切换管理员可编辑</span>'}</div><div class="tabs"><button data-org-mode="departments" class="${mode === "departments" ? "chosen" : ""}">部门树</button><button data-org-mode="reports" class="${mode === "reports" ? "chosen" : ""}">汇报树</button></div><div class="org-scroll"><ul class="org-tree">${
    mode === "departments"
      ? org.departments
          .filter((d) => d.parentId === null)
          .map(department)
          .join("")
      : org.people
          .filter((p) => p.managerId === null)
          .map(report)
          .join("")
  }</ul></div><div class="review-box"><h3>维护规则</h3>先新增部门，再添加主管、设置部门负责人，最后添加员工。现有名称和标识保留，避免历史归属变化；可调整上级、部门和在岗状态。有在途审批任务的人员不能停用或改角色。循环汇报、自身为上级、失效引用会阻止保存。这里是虚构组织与模拟身份，不是生产级账号系统。</div></section>`;
}
function nodeForm(node, index, branch, org, editable) {
  return `<div class="flow-node"><span class="node-index">${index + 1}</span><label>审批人来源<select data-selector="${branch}-${index}" ${editable ? "" : "disabled"}>${Object.entries(
    selectorLabels,
  )
    .map(([v, l]) => option(v, l, node.selector))
    .join("")}</select></label>${
    node.selector === "person"
      ? `<label>指定人员<select data-person="${branch}-${index}" ${editable ? "" : "disabled"}><option value="">请选择人员</option>${org.people
          .filter((p) => p.active && ["主管", "管理员"].includes(p.role))
          .map((p) => option(p.id, p.name, node.personId))
          .join("")}</select></label>`
      : ""
  }${editable ? `<button type="button" data-remove-node="${branch}-${index}" aria-label="移除${branch}分支第${index + 1}节点">移除</button>` : ""}</div>`;
}
export function flowView(draft, active, org, role, target = "expense") {
  const f = draft[target],
    editable = role === "管理员";
  return `<section class="panel prose"><div class="panel-title config-heading"><div><h3>审批流程树</h3><span>已发布 v${active.version} · 当前编辑 ${target === "expense" ? "报销流程" : "费用申请流程"}</span></div><span class="badge ${editable ? "s1" : ""}">${editable ? "管理员配置" : "只读预览"}</span></div>${editable ? '<p><button id="finance-flow-template" type="button">载入“部门总 → 财务 → 总账 → 付款”模板</button><small>只修改草稿，填写原因发布后才生效；不修改在途单据。</small></p>' : ""}<div class="tabs"><button data-flow-target="expense" class="${target === "expense" ? "chosen" : ""}">报销流程</button><button data-flow-target="request" class="${target === "request" ? "chosen" : ""}">费用申请流程</button></div><form id="flow-form"><div class="flow-start">员工提交</div><div class="flow-condition"><h3>条件分支</h3><div class="form-grid"><label>金额大于（元）<input name="threshold" type="number" min="0" max="1000000" step="0.01" value="${f.threshold}" ${editable ? "" : "disabled"}></label><label>并且费用类型为<select name="conditionType" ${editable ? "" : "disabled"}>${["全部", "差旅交通", "业务招待", "办公采购", "其他费用"].map((t) => option(t, t, f.type)).join("")}</select></label></div><small>命中右侧条件分支，其余进入默认分支，始终覆盖全部单据。</small></div><div class="flow-branches">${[
    ["low", "默认分支", "金额未超标，或类型不匹配"],
    ["high", "条件分支", `金额 > ${f.threshold} 且类型为 ${f.type}`],
  ]
    .map(
      ([b, title, description]) =>
        `<section class="flow-branch"><div class="branch-title"><h3>${title}</h3><small>${esc(description)}</small></div>${f[b].map((n, i) => nodeForm(n, i, b, org, editable)).join('<div class="node-arrow">↓</div>')}${editable ? `<button type="button" data-add-node="${b}">＋ 顺序审批节点</button>` : ""}</section>`,
    )
    .join("")}</div>${
    target === "expense"
      ? `<div class="flow-finance"><label>汇合：财务审核<select name="financeId" ${editable ? "" : "disabled"}>${org.people
          .filter((p) => p.active && p.role === "财务")
          .map((p) => option(p.id, p.name, draft.financeId))
          .join(
            "",
          )}</select></label><label>总账复核<select name="ledgerId" ${editable ? "" : "disabled"}><option value="">不启用（保留原流程）</option>${org.people
          .filter((p) => p.active && p.role === "总账")
          .map((p) => option(p.id, p.name, draft.ledgerId))
          .join(
            "",
          )}</select></label><label>付款负责人<select name="payerId" ${editable ? "" : "disabled"}><option value="">不启用（由原财务登记）</option>${org.people
          .filter((p) => p.active && p.role === "付款")
          .map((p) => option(p.id, p.name, draft.payerId))
          .join(
            "",
          )}</select></label><span>启用完整分工：财务审核 → 总账复核 → 付款工作台</span></div>`
      : '<div class="flow-end">审批完成 → 已批准，预留费用额度</div>'
  }<div class="review-box">发布前验证两条分支对全部在岗员工均能找到审批人。相同人员重复出现时合并；不允许申请人自批。新提交或重新提交使用最新版本；在途单据保留原流程版本、路径和人员快照。旧单据继续原固定流程，不自动迁移。</div>${editable ? '<label>发布原因<textarea name="publishReason" maxlength="200" placeholder="说明流程调整的业务原因"></textarea></label><div class="actions"><button type="button" id="save-flow-draft">保存草稿</button><button type="button" id="publish-flow" class="primary">校验并发布流程</button></div>' : ""}</form><div class="route-test"><h3>路径试算</h3><p>使用当前未发布配置解析，不创建单据、不占预算。</p><div class="form-grid"><label>申请人<select id="route-applicant">${org.people
    .filter((p) => p.active && p.role === "员工")
    .map((p) =>
      option(
        p.id,
        p.name,
        org.people.find((x) => x.active && x.role === "员工")?.id,
      ),
    )
    .join(
      "",
    )}</select></label><label>金额（元）<input id="route-amount" type="number" min="0.01" step="0.01" value="4000"></label><label>费用类型<select id="route-type">${["差旅交通", "业务招待", "办公采购", "其他费用"].map((t) => `<option>${t}</option>`).join("")}</select></label></div><button id="test-route">试算路径</button><div id="route-output" role="status"></div></div></section>`;
}
export function collectFlow(form, draft, target) {
  const next = structuredClone(draft),
    f = next[target];
  f.threshold = Number(form.elements.threshold.value);
  f.type = form.elements.conditionType.value;
  if (form.elements.financeId) next.financeId = form.elements.financeId.value;
  if (form.elements.ledgerId) {
    const ledgerId = form.elements.ledgerId.value,
      payerId = form.elements.payerId.value;
    delete next.ledgerId;
    delete next.payerId;
    if (ledgerId || payerId) {
      next.ledgerId = ledgerId;
      next.payerId = payerId;
    }
  }
  for (const branch of ["low", "high"])
    f[branch] = f[branch].map((n, i) => {
      const selector = form.querySelector(
        `[data-selector="${branch}-${i}"]`,
      ).value;
      const personId =
        form.querySelector(`[data-person="${branch}-${i}"]`)?.value ||
        n.personId ||
        "";
      return selector === "person" ? { selector, personId } : { selector };
    });
  return next;
}
export function personForm(org, id) {
  const p = org.people.find((p) => p.id === id);
  return `<div class="modal-title"><h2>${p ? "编辑人员" : "新增人员"}</h2><button data-close aria-label="关闭">✕</button></div><form id="person-form"><label>姓名<input name="name" required maxlength="30" value="${esc(p?.name || "")}" ${p ? "disabled" : ""}></label><label>部门<select name="departmentId">${org.departments.map((d) => option(d.id, d.name, p?.departmentId || "sales")).join("")}</select></label><label>岗位名称<input name="title" maxlength="40" value="${esc(p?.title || "")}" placeholder="如 CFO、部门总、总账会计"></label><label>角色<select name="role">${roles.map((r) => option(r, r, p?.role || "员工")).join("")}</select></label><label>直属上级<select name="managerId"><option value="">无（顶层管理人员）</option>${org.people
    .filter(
      (x) => x.active && x.id !== p?.id && ["主管", "管理员"].includes(x.role),
    )
    .map((x) => option(x.id, x.name, p ? p.managerId : "admin-gu"))
    .join(
      "",
    )}</select></label><label class="check-line"><input type="checkbox" name="active" ${!p || p.active ? "checked" : ""}>在岗</label><div class="actions"><button type="submit" class="primary">校验并保存人员</button></div></form>`;
}
export function departmentForm(org, id) {
  const d = org.departments.find((d) => d.id === id);
  return `<div class="modal-title"><h2>${d ? "编辑部门" : "新增部门"}</h2><button data-close aria-label="关闭">✕</button></div><form id="department-form"><label>部门名称<input name="name" required maxlength="30" value="${esc(d?.name || "")}" ${d ? "disabled" : ""}></label><label>上级部门<select name="parentId"><option value="">无（根部门）</option>${org.departments
    .filter((x) => x.id !== id)
    .map((x) => option(x.id, x.name, d?.parentId || (!d ? "company" : null)))
    .join(
      "",
    )}</select></label><label>部门负责人<select name="headId"><option value="">暂不设置（添加员工前必须配置）</option>${org.people
    .filter(
      (x) =>
        x.active &&
        x.departmentId === id &&
        ["主管", "管理员"].includes(x.role),
    )
    .map((x) => option(x.id, x.name, d?.headId))
    .join(
      "",
    )}</select></label><div class="actions"><button type="submit" class="primary">校验并保存部门</button></div></form>`;
}
export function approvalTimeline(doc) {
  const a = doc.approval;
  if (!a)
    return '<p class="footnote">历史单据：保留原固定审批流程，不自动迁移。</p>';
  const stopped = ["已退回", "已撤回", "已驳回", "已关闭"].includes(doc.status);
  return `<section class="snapshot"><h3>审批路径快照 <span class="badge">v${a.version} · ${a.branch === "high" ? "条件分支" : "默认分支"}</span></h3><ol>${a.nodes.map((n, i) => `<li class="${i < a.cursor ? "done" : i === a.cursor && !stopped ? "current" : ""}"><b>${esc(n.actorName)}</b><span>${esc(n.label)} · ${i < a.cursor ? "已通过" : i === a.cursor ? (stopped ? "已终止" : "待处理") : "后续节点"}</span></li>`).join("")}${a.paymentActor ? `<li class="${doc.status === "已付款" ? "done" : doc.status === "待付款" ? "current" : ""}"><b>${esc(a.paymentActor.actorName)}</b><span>付款登记 · ${doc.status === "已付款" ? "已登记" : doc.status === "待付款" ? "待处理" : "后续任务"}</span></li>` : ""}</ol><small>配置或汇报关系后续变化不改写本快照。报销退回或撤回后重新提交会重新解析。</small></section>`;
}
