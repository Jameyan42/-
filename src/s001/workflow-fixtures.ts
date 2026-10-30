import { readFileSync } from "node:fs";
// Test-only arrangements: explicit synthetic file bytes and simulated named approvals.
// Never imported by the application UI or rule registry.
// @ts-ignore Existing org fixture
import { defaultOrg } from "../organization.js";
import {
  activeWorkflow,
  submitWorkflow,
  recordApproval,
} from "./workflow-model";
import { selectPolicy, approvalNodes } from "./workflow-rule";
import {
  defaultWorkflowConfig,
  type StoredFile,
  type Org,
} from "./workflow-config";
import { execute as executeRaw } from "./model";
import type { Input, State, Context } from "./types";
export const testAt = "2026-10-30T03:00:00.000Z";
export function sampleFiles(invoiceIds: string[]): StoredFile[] {
  return ["INVOICE", "TRAVEL_APPROVAL"].map((materialType, i) => {
    const bytes = readFileSync(
      new URL(
        i
          ? "../../public/samples/r006-demo-travel.pdf"
          : "../../public/samples/r006-demo-invoice.pdf",
        import.meta.url,
      ),
    );
    const data = "data:application/pdf;base64," + bytes.toString("base64");
    return {
      id: `TEST-FILE-${i}`,
      name: `synthetic-${i}.pdf`,
      type: "application/pdf",
      size: atob(data.split(",")[1]!).length,
      data,
      kind: i ? "其他材料" : "发票",
      materialType: materialType as StoredFile["materialType"],
      storageStatus: "SAVED",
      verificationStatus: "VERIFIED",
      uploadTime: testAt,
      uploadedBy: "模拟录入人",
      verifiedBy: "模拟财务",
      verifiedAt: testAt,
      linkedInvoiceIds: i ? [] : invoiceIds,
    };
  });
}
export function fixtureOrg(d: Input): Org {
  const org = defaultOrg() as Org;
  org.people.find((p) => p.id === "lin")!.name = d.employee;
  org.departments.find((d) => d.id === "sales")!.name = d.department;
  return org;
}
export function executePrepared(
  s: State,
  id: string,
  c: Context,
  batchId: string,
): State {
  const d = s.claims.find((d) => d.id === id)!,
    match = selectPolicy(
      d.input,
      (s.workflowConfig || defaultWorkflowConfig()).approvalPolicies,
    );
  let n = s;
  if (match.policy) {
    const org = fixtureOrg(d.input);
    if (!activeWorkflow(d))
      n = submitWorkflow(
        n,
        id,
        org,
        { id: "finance-zhou", name: "周宁", role: "财务" },
        "测试显式准备业务审批",
        c.at,
        "TEST-WF-" + batchId,
      );
    const w = activeWorkflow(n.claims.find((d) => d.id === id)!)!;
    for (const [i, node] of approvalNodes(
      d.input,
      w.org,
      match.policy,
    ).entries())
      if (
        !w.records.some(
          (r) => r.approvalLevel === i && r.approvalStatus === "APPROVED",
        )
      )
        n = recordApproval(
          n,
          id,
          { id: node.actorId, name: node.actorName, role: node.role },
          "APPROVED",
          "模拟具名节点明确同意",
          c.at,
          `TEST-${batchId}-${i}`,
        );
  }
  return executeRaw(n, id, c, batchId);
}
