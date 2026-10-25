import type { State, Contract, Payment } from "./contractTypes";
export function createState(date: string): State {
  const year = Number(date.slice(0, 4));
  const evidence = [
    { id: "effective", name: "合同生效确认", status: "已提供" as const },
    { id: "delivery", name: "货物已交付及交付证明", status: "已提供" as const },
    { id: "accepted", name: "验收完成确认", status: "已提供" as const },
    { id: "report", name: "验收报告", status: "已提供" as const },
    { id: "settlement", name: "结算单", status: "已提供" as const },
  ];
  const contracts: Contract[] = [1, 2, 3, 4].map((i) => ({
    id: `HT-00${i}`,
    name: `模拟采购合同${i}`,
    supplier: `模拟供应商${i}`,
    totalCents: i === 4 ? 5000000 : 10000000,
    effectiveDate: `${year - 1}-01-01`,
    expiryDate: `${year + 2}-12-31`,
    status: i === 4 ? "已终止" : "已生效",
    mode: i === 2 ? "分阶段付款" : i === 3 ? "按结算付款" : "一次性付款",
    stages:
      i === 2
        ? [
            {
              id: "S1",
              name: "首付款",
              basisPoints: 3000,
              requirements: ["effective"],
            },
            {
              id: "S2",
              name: "第二阶段",
              basisPoints: 4000,
              requirements: ["delivery"],
            },
            {
              id: "S3",
              name: "尾款",
              basisPoints: 3000,
              requirements: ["accepted", "report"],
            },
          ]
        : [],
    settlementCents: i === 3 ? 6000000 : null,
    requirements:
      i === 2 ? [] : i === 3 ? ["settlement"] : ["accepted", "report"],
    evidence: structuredClone(evidence),
  }));
  const payments: Payment[] = [
    [1, 2000000, ""],
    [2, 3000000, "S1"],
    [2, 1000000, "S2"],
    [3, 3000000, ""],
    [4, 1000000, ""],
  ].map(([i, n, stage], j) => ({
    id: `PAY-H${j + 1}`,
    contractId: `HT-00${i}`,
    applicationId: `APP-H${j + 1}`,
    stageId: String(stage),
    amountCents: Number(n),
    date: `${year}-01-01`,
    status: "已支付",
  }));
  return { schema: 1, revision: 1, contracts, payments, documents: [] };
}
