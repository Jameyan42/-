// 仅为演示企业制度，不是通用会计科目表。
export type Mapping = {
  ruleId: string;
  companyId: string;
  expenseType: string;
  allowedAccountCodes: string[];
  recommendedAccountCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "DISABLED";
  description: string;
};
export type AccountConfig = {
  version: number;
  accounts: { code: string; name: string }[];
  mappings: Mapping[];
  scenarios: { scenario: string; expenseTypes: string[] }[];
};
export const expenseTypes = [
  "住宿费",
  "差旅交通费",
  "业务招待费",
  "办公费",
  "培训费",
  "设备维修费",
  "固定资产购置",
  "预付款",
  "在建工程",
  "其他费用",
];
export function defaultAccounts(): AccountConfig {
  return {
    version: 1,
    accounts: [
      ["6602.01", "差旅费"],
      ["6602.02", "业务招待费"],
      ["6602.03", "办公费"],
      ["6602.04", "培训费"],
      ["6602.05", "职工培训支出（模拟）"],
      ["6602.11", "差旅住宿费"],
    ].map(([code, name]) => ({ code: code!, name: name! })),
    mappings: [
      ...["住宿费", "差旅交通费", "业务招待费", "办公费", "培训费"].map(
        (expenseType, i) => ({
          ruleId: `MAP-G${i + 1}`,
          companyId: "*",
          expenseType,
          allowedAccountCodes:
            i === 4
              ? ["6602.04", "6602.05"]
              : [i < 2 ? "6602.01" : `6602.0${i}`],
          recommendedAccountCode: i < 2 ? "6602.01" : `6602.0${i}`,
          effectiveFrom: "2020-01-01",
          effectiveTo: null,
          status: "ACTIVE" as const,
          description: "集团通用模拟费用核算政策",
        }),
      ),
      {
        ruleId: "MAP-DG-HOTEL",
        companyId: "DG",
        expenseType: "住宿费",
        allowedAccountCodes: ["6602.11"],
        recommendedAccountCode: "6602.11",
        effectiveFrom: "2020-01-01",
        effectiveTo: null,
        status: "ACTIVE",
        description: "东莞住宿费用专属模拟政策",
      },
    ],
    scenarios: [
      { scenario: "出差住宿", expenseTypes: ["住宿费"] },
      { scenario: "出差交通", expenseTypes: ["差旅交通费"] },
      { scenario: "客户宴请", expenseTypes: ["业务招待费"] },
      { scenario: "日常办公", expenseTypes: ["办公费"] },
      { scenario: "员工培训", expenseTypes: ["培训费"] },
    ],
  };
}
