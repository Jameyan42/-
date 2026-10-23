import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTrip,
  tripDuration,
  travelRates,
  validateTravel,
  travelWarnings,
  assertTravelSubmission,
  travelPolicyVersion,
} from "./travel.js";
import { assertClaimLink, validateRequest } from "./requests.js";
import { validateBackup, defaultPolicy } from "./settings.js";
import { review } from "./domain.js";
const trip = () => ({
  origin: "杭州",
  destination: "上海",
  start: "2026-10-21",
  end: "2026-10-23",
  cityLevel: "重点城市",
  grade: "普通员工",
});
const travel = () => ({
  schema: 1,
  policyVersion: travelPolicyVersion,
  trip: trip(),
  exceptionReason: "",
  lines: [
    { category: "住宿", date: "2026-10-21", units: 2, amount: 1000, note: "" },
    { category: "餐补", date: "2026-10-21", units: 3, amount: 300, note: "" },
    {
      category: "城际交通",
      date: "2026-10-21",
      units: 1,
      amount: 200,
      note: "",
    },
  ],
});
const item = () => ({
  id: "X",
  name: "出差",
  employee: "林晓",
  department: "销售部",
  type: "差旅交通",
  amount: 1500,
  date: "2026-10-23",
  status: "待主管审批",
  invoice: "NEW",
  receipt: "演示.pdf",
  note: "客户拜访",
  history: [],
  travel: travel(),
});
const request = () => ({
  id: "R",
  name: "出差申请",
  employee: "林晓",
  department: "销售部",
  type: "差旅交通",
  amount: 2000,
  month: "2026-10",
  note: "拜访",
  status: "已批准",
  history: [],
  trip: trip(),
});
test("行程真实日期、月份一致及自然日/晚数，同日和闰日", () => {
  assert.deepEqual(tripDuration(trip()), { days: 3, nights: 2 });
  assert.deepEqual(tripDuration({ ...trip(), end: "2026-10-21" }), {
    days: 1,
    nights: 0,
  });
  assert.deepEqual(
    tripDuration({ ...trip(), start: "2024-02-28", end: "2024-02-29" }),
    { days: 2, nights: 1 },
  );
  for (const t of [
    { ...trip(), end: "2026-10-20" },
    { ...trip(), start: "2026-02-30" },
    { ...trip(), end: "2026-11-01" },
    { ...trip(), origin: "" },
  ])
    assert.throws(() => validateTrip(t));
  assert.throws(() => validateTrip(trip(), "2026-11"));
  assert.throws(() => validateRequest({ ...request(), type: "其他费用" }));
});
test("四档示例标准与按行金额边界、不修改输入", () => {
  const v = travel(),
    before = JSON.stringify(v);
  assert.equal(travelRates(trip()).hotel, 500);
  assert.equal(travelRates({ ...trip(), grade: "管理人员" }).hotel, 700);
  assert.equal(travelRates({ ...trip(), cityLevel: "其他城市" }).hotel, 350);
  assert.equal(
    travelRates({ ...trip(), cityLevel: "其他城市", grade: "管理人员" }).meal,
    150,
  );
  assert.deepEqual(travelWarnings(v), []);
  assertTravelSubmission(v, 1500, "差旅交通");
  assert.equal(JSON.stringify(v), before);
});
test("明细合计精度、数量类别、行数和标准版本校验", () => {
  for (const modify of [
    (v) => (v.lines[0].amount = 1000.001),
    (v) => (v.lines[2].units = 2),
    (v) => (v.lines[0].units = 1.5),
    (v) => (v.lines[0].amount = -1),
    (v) => (v.lines = []),
    (v) => (v.lines = Array(21).fill(v.lines[0])),
    (v) => (v.policyVersion = "unknown"),
    (v) => (v.lines[0].category = "随意"),
  ]) {
    const v = travel();
    modify(v);
    assert.throws(() => validateTravel(v, 1500, "差旅交通"));
  }
  assert.throws(() => validateTravel(travel(), 1500.01, "差旅交通"));
  assert.throws(() => validateTravel(travel(), 1500, "其他费用"));
  const v = {
    ...travel(),
    lines: [
      {
        category: "市内交通",
        date: "2026-10-21",
        units: 1,
        amount: 0.1,
        note: "",
      },
      {
        category: "市内交通",
        date: "2026-10-22",
        units: 1,
        amount: 0.2,
        note: "",
      },
    ],
  };
  validateTravel(v, 0.3, "差旅交通");
});
test("住宿餐补日期不可重复或超过行程，同日不允许住宿", () => {
  for (const l of [
    { category: "住宿", date: "2026-10-23", units: 1, amount: 1, note: "" },
    { category: "餐补", date: "2026-10-22", units: 3, amount: 1, note: "" },
    { category: "住宿", date: "2026-10-21", units: 1, amount: 1, note: "" },
    { category: "餐补", date: "2026-10-21", units: 1, amount: 1, note: "" },
    { category: "其他", date: "2026-10-20", units: 1, amount: 1, note: "" },
  ]) {
    const v = travel();
    v.lines.push(l);
    assert.throws(() => validateTravel(v, 1501, "差旅交通"));
  }
  const v = {
    ...travel(),
    trip: { ...trip(), end: "2026-10-21" },
    lines: [
      { category: "住宿", date: "2026-10-21", units: 1, amount: 1, note: "" },
    ],
  };
  assert.throws(() => validateTravel(v, 1, "差旅交通"));
});
test("超标需说明且不豁免重复票、单笔上限等风险", () => {
  const x = item();
  x.travel.lines[0].amount = 1100;
  x.amount = 1600;
  assert.equal(travelWarnings(x.travel).length, 1);
  assert.throws(
    () => assertTravelSubmission(x.travel, x.amount, x.type),
    /超标说明/,
  );
  assert(review(x).some((x) => x.includes("超标说明")));
  x.travel.exceptionReason = "展会期间酒店涨价，待审核";
  assertTravelSubmission(x.travel, 1600, x.type);
  assert.deepEqual(review(x), []);
  assert.equal(review(x, [], { ...defaultPolicy, limit: 1000 }).length, 1);
  assert.equal(review(x, [{ ...x, id: "other" }]).length, 1);
});
test("关联批准行程精确匹配并维持额度硬限制", () => {
  const x = { ...item(), requestId: "R" },
    r = request();
  assertClaimLink(x, [r], []);
  assert.throws(
    () => assertClaimLink({ ...x, travel: undefined }, [r], []),
    /行程/,
  );
  assert.throws(
    () =>
      assertClaimLink(
        {
          ...x,
          travel: { ...x.travel, trip: { ...trip(), destination: "北京" } },
        },
        [r],
        [],
      ),
    /行程/,
  );
  assert.throws(() => assertClaimLink(x, [{ ...r, amount: 1000 }], []), /额度/);
});
test("新差旅备份往返与篡改拒绝，旧备份无需新字段", () => {
  const b = {
    format: "qingbao-backup",
    version: 1,
    items: [item()],
    requests: [request()],
    budgets: { 销售部: 10000, 产品部: 1000, 运营部: 1000 },
    policy: { ...defaultPolicy },
    audit: [],
  };
  assert.deepEqual(validateBackup(structuredClone(b)), b);
  const bad = structuredClone(b);
  bad.items[0].amount = 1501;
  assert.throws(() => validateBackup(bad));
  const invalid = structuredClone(b);
  invalid.requests[0].trip.end = "2026-10-20";
  assert.throws(() => validateBackup(invalid));
  const old = structuredClone(b);
  delete old.items[0].travel;
  delete old.requests[0].trip;
  assert.doesNotThrow(() => validateBackup(old));
});
