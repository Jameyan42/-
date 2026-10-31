import { buildAIContext } from './ai-context';
import type { Batch, Input } from './types';
// Synthetic settings self-test, not a submitted reimbursement or claimed deterministic PASS.
export function aiSelfTestContext(description = '周末家庭旅行酒店住宿。') {
    const d: Input = { id: 'AI-SETTINGS-SELFTEST', employee: '虚构自检人员', department: '模拟部门', companyId: 'SZ', grade: '普通员工', expenseType: '住宿费', amountYuan: '800', currency: 'CNY', city: '深圳', checkIn: '2026-10-20', checkOut: '2026-10-22', hotel: '虚构酒店', hotelAmountYuan: '800', partialReason: '', businessDate: '2026-10-20', businessDescription: description, invoices: [] };
    const b: Batch = { id: 'SELFTEST-NOT-AUDIT', version: 1, revision: 1, at: '2026-10-31T00:00:00.000Z', input: d, ruleKeys: [], results: [], review: null, context: { standards: null, invoiceHistory: null } };
    return buildAIContext(b);
}
