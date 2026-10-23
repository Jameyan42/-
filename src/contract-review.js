// Deterministic local screening: findings are prompts for a human, never legal conclusions.
export const contractRuleVersion = "local-contract-1";
export const demoContractText = `甲方：星河科技（虚构演示）
乙方：远帆服务有限公司（虚构）
合同总价：10000元。
服务范围：提供虚构会务服务及交付清单。
验收：交付后5个工作日按双方确认的清单验收，不合格应整改。
付款：验收通过且收到合法发票后30日一次性支付合同约定款项，不设预付款。
违约责任：按未履约金额的5%承担违约金，责任上限为合同总价。
争议解决：协商不成，向甲方所在地人民法院起诉。
解除：重大违约经书面催告10日未整改的，守约方可以解除。`;
export function screenContract(text, supplierName) {
  if (typeof text !== "string" || !text.trim() || text.length > 30000)
    throw Error("请提供1～30000字合同正文（仅虚构资料）");
  const findings = [];
  const missing = (id, label, pattern, suggestion) => {
    if (!pattern.test(text))
      findings.push({
        id,
        severity: "关注",
        label,
        evidence: "未检出相关表述",
        suggestion,
      });
  };
  if (!supplierName || !text.includes(supplierName))
    findings.push({
      id: "subject",
      severity: "高",
      label: "供应商主体待核对",
      evidence: "未检出供应商完整名称",
      suggestion: "核对合同乙方、供应商档案与收款户名，简称不能直接判为一致。",
    });
  missing(
    "scope",
    "交付与服务范围",
    /交付|服务范围|采购内容/,
    "补充交付物、数量及服务范围。",
  );
  missing(
    "acceptance",
    "验收条款待核对",
    /验收/,
    "约定验收标准、时限和不合格处理方式。",
  );
  missing(
    "payment",
    "付款条款待核对",
    /付款|支付/,
    "明确金额、付款条件、账期和收款方。",
  );
  missing(
    "invoice",
    "发票条款待核对",
    /发票/,
    "核对开票类型、时间和税费承担。",
  );
  missing(
    "breach",
    "违约责任待核对",
    /违约/,
    "核对违约触发条件、补救和责任上限。",
  );
  missing(
    "dispute",
    "争议处理待核对",
    /仲裁|法院/,
    "核对争议解决方式及管辖约定。",
  );
  const risk = (id, label, regex, suggestion) => {
    const m = text.match(regex);
    if (m)
      findings.push({ id, severity: "高", label, evidence: m[0], suggestion });
  };
  risk(
    "prepay",
    "全额预付风险",
    /(?:100%|百分之百|全部|全额)[^。\n]{0,12}(?:预付|提前支付)|(?:预付|提前支付)[^。\n]{0,12}(?:100%|百分之百|全部|全额)/,
    "核对是否需预付款担保、分期支付及交付保障。",
  );
  risk(
    "liability",
    "无限责任表述",
    /无限(?:连带)?责任|无上限[^。\n]{0,10}责任/,
    "结合业务协商合理责任边界；命中片段可能含否定，应阅读上下文。",
  );
  risk(
    "termination",
    "单方解除表述",
    /单方[^。\n]{0,12}(?:解除|终止)/,
    "核对解除条件、通知及损失补偿，结合完整上下文复核。",
  );
  return { engine: contractRuleVersion, findings };
}
