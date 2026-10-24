import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultTravelRules,
  validateTravelRules,
  effectiveTravelRules,
  resolveTravelStandard,
  nextTravelRules,
  captureTravel,
  travelChecks,
  validateTravelStandard,
} from "./travel-policy.js";
import {
  travelPolicyVersion,
  validateTravel,
  assertTravelSubmission,
} from "./travel.js";
import {
  evaluatePrecheck,
  validatePrecheckReport,
  assertPrecheck,
  basePolicy,
} from "./precheck.js";
import { validatePolicy, validateBackup } from "./settings.js";
import { assertClaimLink } from "./requests.js";

const at = "2026-10-24T00:00:00Z";
const actor = { id: "lin", name: "林晓", active: true, role: "员工" };
const finance = {
  id: "finance-zhou",
  name: "周宁",
  active: true,
  role: "财务",
};
const trip = () => ({
  origin: "杭州",
  destination: "上海市",
  cityLevel: "其他城市",
  grade: "管理人员",
  start: "2026-10-21",
  end: "2026-10-23",
});
const travel = () => ({
  schema: 1,
  policyVersion: travelPolicyVersion,
  trip: trip(),
  exceptionReason: "展会期间费用超标，请财务核对",
  lines: [
    {
      category: "住宿",
      date: "2026-10-21",
      units: 2,
      amount: 1100,
      note: "虚构住宿",
    },
  ],
});
const doc = (policy = {}) => ({
  id: "BX-TRAVEL",
  name: "差旅预审",
  employee: "林晓",
  department: "销售部",
  date: "2026-10-24",
  type: "差旅交通",
  amount: 1100,
  invoice: "DEMO-TRAVEL",
  receipt: "虚构发票.pdf",
  note: "虚构差旅",
  status: "待财务审核",
  history: [],
  travel: captureTravel(travel(), policy, actor, at),
});

test("默认配置兼容旧政策，规范匹配城市并绑定人员职级，忽略员工自选高档", () => {
  validateTravelRules(defaultTravelRules());
  assert.equal(effectiveTravelRules({}).version, 1);
  const s = resolveTravelStandard({}, actor, trip(), at);
  assert.equal(s.city, "上海");
  assert.equal(s.cityLevel, "重点城市");
  assert.equal(s.grade, "普通员工");
  assert.equal(s.hotel, 500);
  assert.equal(s.cityMatched, true);
  assert.equal(s.gradeMatched, true);
  const unknown = resolveTravelStandard(
    {},
    { ...actor, id: "new-person" },
    { ...trip(), destination: "上海浦东" },
    at,
  );
  assert.equal(unknown.cityMatched, false);
  assert.equal(unknown.gradeMatched, false);
  assert.equal(unknown.cityLevel, "其他城市");
  assert.equal(unknown.hotel, 350);
});
test("财务维护不同城市职级，单城市标准优先，版本原因和身份校验", () => {
  const r = defaultTravelRules();
  r.overrides = [
    { city: "上海", grade: "管理人员", hotel: 880, meal: 180, local: 160 },
  ];
  r.employees.find((x) => x.id === "lin").grade = "管理人员";
  const next = nextTravelRules({}, r, finance, "调整上海管理人员差旅标准", at);
  assert.equal(next.version, 2);
  assert.equal(next.change.actorId, finance.id);
  const s = resolveTravelStandard({ travelRules: next }, actor, trip(), at);
  assert.equal(s.hotel, 880);
  assert.equal(s.rateSource, "城市独立标准");
  assert.equal(
    resolveTravelStandard(
      { travelRules: next },
      actor,
      { ...trip(), destination: "南京" },
      at,
    ).hotel,
    500,
  );
  assert.throws(
    () => nextTravelRules({}, r, actor, "非财务不能维护", at),
    /仅财务/,
  );
  assert.throws(() => nextTravelRules({}, r, finance, "短", at), /原因/);
});
test("制度拒绝重名城市/不完整矩阵/坏金额/重复人员/未知特例及超限，旧policy保持", () => {
  for (const mutate of [
    (r) => r.cities.push(r.cities[0]),
    (r) => r.rates.pop(),
    (r) => (r.rates[0].hotel = 0.001),
    (r) => (r.rates[0].meal = -1),
    (r) => r.employees.push(r.employees[0]),
    (r) =>
      r.overrides.push({
        city: "未维护",
        grade: "普通员工",
        hotel: 1,
        meal: 1,
        local: 1,
      }),
    (r) => (r.effects.hotel = "auto"),
    (r) => (r.publishedAt = 0),
    (r) =>
      (r.cities = Array.from({ length: 101 }, (_, i) => ({
        name: "城" + i,
        level: "重点城市",
      }))),
  ]) {
    const r = defaultTravelRules();
    mutate(r);
    assert.throws(() => validateTravelRules(r));
  }
  assert.deepEqual(validatePolicy(basePolicy), basePolicy);
  const r = defaultTravelRules();
  assert.deepEqual(
    validatePolicy({ ...basePolicy, travelRules: r }).travelRules,
    r,
  );
});
test("住宿餐补按晚/天计算，分币相等不超标，同日市内交通合并防拆行，零标准有效", () => {
  const v = captureTravel(travel(), {}, actor, at);
  v.lines = [
    { category: "住宿", date: "2026-10-21", units: 2, amount: 1000, note: "" },
    { category: "餐补", date: "2026-10-21", units: 3, amount: 300, note: "" },
    {
      category: "市内交通",
      date: "2026-10-21",
      units: 1,
      amount: 50,
      note: "",
    },
    {
      category: "市内交通",
      date: "2026-10-21",
      units: 1,
      amount: 30.01,
      note: "",
    },
  ];
  validateTravel(v, 1380.01, "差旅交通");
  const checks = travelChecks(v);
  assert.deepEqual(
    checks.map((x) => x.excess),
    [0, 0, 0.01],
  );
  v.standard.local = 0;
  assert.equal(travelChecks(v).at(-1).excess, 80.01);
  v.exceptionReason = "";
  assert.throws(
    () => assertTravelSubmission(v, 1380.01, "差旅交通"),
    /超标说明/,
  );
});
test("超标依据、缺水单和未关联申请进入统一预审，说明不解除财务拦截", () => {
  const r = defaultTravelRules();
  r.effects.hotel = "block";
  const d = doc({ travelRules: r }),
    report = evaluatePrecheck(
      "expense",
      d,
      { items: [d] },
      { ...basePolicy, travelRules: r },
      at,
    );
  assert.equal(
    report.findings.find((f) => f.id === "travel-hotel").effect,
    "block",
  );
  assert.match(
    report.findings.find((f) => f.id === "travel-hotel").evidence,
    /超额100.00元/,
  );
  assert.ok(report.findings.some((f) => f.id === "travel-hotel-folio"));
  assert.ok(report.findings.some((f) => f.id === "travel-request"));
  assert.doesNotThrow(() => assertPrecheck(report, "待主管审批"));
  for (const status of ["待财务审核", "待总账复核", "待付款"])
    assert.throws(() => assertPrecheck(report, status), /住宿/);
  validatePrecheckReport(report, "expense", d.id);
  d.attachments = [{ kind: "酒店水单" }];
  d.requestId = "REQUEST";
  const after = evaluatePrecheck("expense", d, { items: [d] }, basePolicy, at);
  assert.equal(
    after.findings.some((f) =>
      ["travel-request", "travel-hotel-folio"].includes(f.id),
    ),
    false,
  );
});
test("已提交标准与当前制度分开，新配置不追溯改写，退回重提捕获新标准", () => {
  const d = doc(),
    before = JSON.stringify(d.travel.standard),
    r = defaultTravelRules();
  r.rates[0].hotel = 800;
  r.effects.hotel = "block";
  const p = {
    ...basePolicy,
    travelRules: nextTravelRules({}, r, finance, "提高新的住宿标准", at),
  };
  const report = evaluatePrecheck("expense", d, { items: [d] }, p, at);
  assert.equal(report.policy.travelStandard.version, 1);
  assert.equal(
    report.findings.find((f) => f.id === "travel-hotel").effect,
    "warn",
  );
  assert.equal(JSON.stringify(d.travel.standard), before);
  const resubmitted = captureTravel(d.travel, p, actor, at);
  assert.equal(resubmitted.standard.version, 2);
  assert.equal(travelChecks(resubmitted)[0].excess, 0);
});
test("未知城市/职级和旧单明确提醒，不按当前制度补造历史快照", () => {
  const d = doc();
  d.travel = captureTravel(
    { ...travel(), trip: { ...trip(), destination: "未维护城" } },
    {},
    { ...actor, id: "new-person" },
    at,
  );
  let report = evaluatePrecheck("expense", d, { items: [d] }, basePolicy, at);
  assert.ok(report.findings.some((f) => f.id === "travel-city"));
  assert.ok(report.findings.some((f) => f.id === "travel-grade"));
  delete d.travel.standard;
  report = evaluatePrecheck("expense", d, { items: [d] }, basePolicy, at);
  assert.ok(report.findings.some((f) => f.id === "travel-legacy"));
  assert.equal(report.policy.travelStandard, undefined);
});
test("差旅制度/快照可备份，拒绝标准与城市/职级/申请人冲突及篡改快照", () => {
  const d = doc();
  d.status = "草稿";
  const b = {
    format: "qingbao-backup",
    version: 1,
    items: [d],
    budgets: { 销售部: 10000, 产品部: 1000, 运营部: 1000 },
    policy: { ...basePolicy, travelRules: defaultTravelRules() },
    audit: [],
  };
  validateBackup(structuredClone(b));
  for (const mutate of [
    (x) => (x.items[0].travel.standard.grade = "管理人员"),
    (x) => (x.items[0].travel.standard.hotel = -1),
    (x) => (x.items[0].travel.standard.actorName = "同名另一人"),
    (x) => (x.policy.travelRules.rates = []),
  ]) {
    const bad = structuredClone(b);
    mutate(bad);
    assert.throws(() => validateBackup(bad));
  }
  assert.throws(() => validateTravelStandard({ ...d.travel.standard, at: 0 }));
});

test("关联事前行程时新财务职级可更新，物理行程和申请额度限制不放松", () => {
  const r = {
    id: "R",
    name: "出差申请",
    employee: actor.name,
    department: "销售部",
    type: "差旅交通",
    amount: 2000,
    month: "2026-10",
    note: "虚构申请",
    status: "已批准",
    history: [],
    trip: trip(),
  };
  const d = { ...doc(), requestId: "R" };
  // The original request used a hand-selected grade; the claim now uses its verified policy binding.
  assert.notEqual(d.travel.trip.grade, r.trip.grade);
  assert.doesNotThrow(() => assertClaimLink(d, [r], []));
  assert.throws(
    () =>
      assertClaimLink(d, [{ ...r, trip: { ...r.trip, origin: "北京" } }], []),
    /行程/,
  );
  assert.throws(() => assertClaimLink(d, [{ ...r, amount: 1000 }], []), /额度/);
  const invalid = structuredClone(d);
  invalid.travel.standard = {};
  assert.throws(() => assertClaimLink(invalid, [r], []), /快照/);
});
