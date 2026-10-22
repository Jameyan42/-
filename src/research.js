const tasks = {
  员工: [
    [
      "报销提交",
      "报销管理",
      "使用提供的虚构样票提交一笔 268.50 元报销，并说明用途。",
      "记录首次模型加载、字段修正和提交总时间。",
    ],
    [
      "纠错与续填",
      "报销管理",
      "找到待审批的单据并修正错误，另存一笔未填完的报销供下次继续。",
      "区分独立完成、提示后完成和未完成。",
    ],
  ],
  主管: [
    [
      "正常审批",
      "审批中心",
      "找到待你处理的正常单据，查看依据后处理。",
      "观察能否理解下一处理角色。",
    ],
    [
      "要求补充",
      "审批中心",
      "一笔报销说明不足，请让员工补充，并找到处理记录。",
      "不要提前告诉参与者退回按钮的位置。",
    ],
  ],
  财务: [
    [
      "异常票据",
      "发票台账",
      "找出疑似重复号码，说出风险原因和下一步操作。",
      "记录原话，不把“识别重复”当作发票验真。",
    ],
    [
      "付款与预算",
      "预算管理",
      "解释在途占用与实际支出，完成一笔审核后的模拟付款登记。",
      "观察是否能区分审核通过与付款登记。",
    ],
  ],
};
export function researchView(role) {
  return `<section class="panel prose"><div class="section-intro"><span class="section-mark">◎</span><div><h2>把作品交给用户验证</h2><p>这是待执行的测试计划，没有填入虚构反馈或业务效果数据。</p></div></div><div class="research-summary"><span class="badge s0">待执行</span><span>计划 6 位参与者：员工、主管、财务各 2 位</span><button id="research-export">下载空白记录表 CSV</button></div><h3>${role}任务</h3><p>切换右上角角色可查看其他任务。主持人先不指路，记录行为与原话，需要提示时单独标记。</p><div class="guide-grid">${tasks[role].map(([name, page, task, observe]) => `<article class="guide-card"><h3>${name}</h3><p>${task}</p><div class="guide-why">观察重点：${observe}</div><button data-guide-role="${role}" data-guide-page="${page}">进入任务场景 →</button></article>`).join("")}</div><h3>统一记录口径</h3><div class="table-wrap"><table><thead><tr><th>指标</th><th>如何记录</th></tr></thead><tbody><tr><td>任务结果</td><td class="wrap-cell">独立完成 / 提示后完成 / 未完成，不合并为成功率。</td></tr><tr><td>输入与用时</td><td class="wrap-cell">号码和金额分别核对；首次模型下载与后续识别耗时分开。</td></tr><tr><td>理解程度</td><td class="wrap-cell">让参与者解释风险原因与下一步，记录原话，不只问是否看懂。</td></tr></tbody></table></div><div class="review-box"><h3>演示前准备</h3>使用虚构样票与独立访客窗口，保留原浏览器记录。首次 OCR 需要网络下载资源；不要把断网时引擎加载失败当成发票无效。记录前征得参与者同意，仅使用匿名代码，不收集真实财务资料。6 人小样本用于发现问题，不能证明总体效率提升。</div></section>`;
}
export function researchCsv() {
  return (
    "\ufeff" +
    [
      [
        "计划编号（非实际测试）",
        "角色",
        "任务",
        "设备",
        "结果：独立/辅助/未完成",
        "用时秒",
        "首次加载秒",
        "号码错误",
        "金额错误",
        "主持人提示",
        "观察原话",
      ],
      ...["员工", "员工", "主管", "主管", "财务", "财务"].map((role, i) => [
        "P0" + (i + 1),
        role,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]),
    ]
      .map((r) => r.map((s) => '"' + s + '"').join(","))
      .join("\r\n")
  );
}
