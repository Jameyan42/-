import { readFileSync } from "node:fs";
// Explicit simulated setup for existing R001-R005 UI regressions, through real UI actions.
export const samplePdf = {
  name: "仅供演示-材料.pdf",
  mimeType: "application/pdf",
  buffer: readFileSync(
    new URL("../public/samples/r006-demo-invoice.pdf", import.meta.url),
  ),
};
export async function addMaterials(p) {
  if (!(await p.locator("#s001-form").count())) return;
  await p.locator("#r006-kind").selectOption("INVOICE");
  await p.locator("#r006-file").setInputFiles(samplePdf);
  await p.locator("[data-material]").first().waitFor();
  await p
    .locator("[data-material-links]")
    .first()
    .selectOption(
      await p
        .locator("[data-material-links]")
        .first()
        .locator("option")
        .evaluateAll((opts) => opts.map((o) => o.value)),
    );
  await p.locator("[data-file-verify]").first().click();
  await p.locator("#r006-kind").selectOption("TRAVEL_APPROVAL");
  await p
    .locator("#r006-file")
    .setInputFiles({
      ...samplePdf,
      name: "仅供演示-出差证明.pdf",
      buffer: readFileSync(
        new URL("../public/samples/r006-demo-travel.pdf", import.meta.url),
      ),
    });
  await p.locator("[data-material]").nth(1).waitFor();
  await p
    .locator("[data-material]")
    .nth(1)
    .locator("[data-file-verify]")
    .click();
}
export async function completeBusiness(p) {
  if (await p.locator("#r006-action-form [value=submit]").count()) {
    await p
      .locator("#r006-action-form [name=comment]")
      .fill("为原规则回归明确提交模拟业务审批");
    await p.locator("#r006-action-form [value=submit]").click();
  }
  for (let i = 0; i < 2; i++) {
    const s = await p.evaluate(() =>
        JSON.parse(localStorage.getItem("qingbao-s001-v1")),
      ),
      d = s.claims[0],
      w = d.workflows?.findLast((w) => w.reimbursementVersion === d.revision);
    if (!w) break;
    const config = w.config.approvalPolicies.filter(
        (x) => x.status === "ACTIVE" && x.expenseType === d.input.expenseType,
      ),
      amount = Math.round(Number(d.input.amountYuan) * 100),
      date = d.input.businessDate || d.input.checkIn;
    const valid = config.filter(
      (x) =>
        (!x.grade || x.grade === d.input.grade) &&
        amount >= x.minAmount &&
        (x.maxAmount === null || amount <= x.maxAmount) &&
        date >= x.effectiveFrom &&
        (!x.effectiveTo || date <= x.effectiveTo),
    );
    const policy =
      valid.find((x) => x.companyId === d.input.companyId) ||
      valid.find((x) => x.companyId === "*");
    if (!policy) break;
    const idx = w.records.filter((r) => r.approvalStatus === "APPROVED").length;
    if (idx >= policy.approvalSequence.length) break;
    const person = w.org.people.find((x) => x.id === w.applicantId),
      id =
        policy.approvalSequence[idx] === "直属主管"
          ? person.managerId
          : w.org.departments.find((x) => x.id === person.departmentId).headId;
    await p.locator("#role").selectOption("主管");
    await p.locator("#actor").selectOption(id);
    await p
      .locator("#r006-action-form [name=comment]")
      .fill("具名模拟审批同意");
    await p.locator("#r006-action-form [value=APPROVED]").click();
  }
  await p.locator("#role").selectOption("财务");
  await p.locator("#r006-audit").click();
}
