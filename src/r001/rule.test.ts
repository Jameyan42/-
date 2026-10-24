import test from "node:test";
import assert from "node:assert/strict";
import {
  auditLodging,
  calculateNights,
  calendarOrdinal,
  centsToYuan,
  parseYuan,
} from "./rule";
import { createExampleStandards } from "./standards";
import {
  appendRecord,
  createExampleState,
  loadState,
  makeRecord,
  replaceRecord,
  reviewRecord,
  R001_STORAGE_KEY,
  saveState,
  t03Input,
  upsertStandard,
  validateState,
} from "./model";
import type {
  AuditStatus,
  EmployeeGrade,
  LodgingInput,
  R001State,
} from "./types";
const at = "2026-10-24T01:00:00.000Z",
  later = "2026-10-24T02:00:00.000Z";
const input = (changes: Partial<LodgingInput> = {}): LodgingInput => ({
  ...t03Input("R001-TEST"),
  ...changes,
});
const cases: [
  string,
  string,
  EmployeeGrade,
  number,
  string,
  AuditStatus,
  number | null,
][] = [
  ["T01", "深圳", "普通员工", 3, "1200", "passed", 0],
  ["T02", "深圳", "普通员工", 3, "1500", "passed", 0],
  ["T03", "深圳", "普通员工", 3, "1800", "review_required", 30000],
  ["T04", "深圳", "部门经理", 3, "1800", "passed", 0],
  ["T05", "北京", "普通员工", 2, "1300", "review_required", 10000],
  ["T06", "东莞", "高级管理人员", 1, "800", "passed", 0],
  ["T07", "未配置城市", "普通员工", 2, "800", "review_required", null],
  ["T08", "深圳", "普通员工", 0, "800", "invalid", null],
  ["T09", "深圳", "普通员工", 2, "-1", "invalid", null],
  ["T10", "深圳", "普通员工", 2, "1000", "passed", 0],
];
for (const [
  id,
  city,
  grade,
  nights,
  amountYuan,
  status,
  excessCents,
] of cases) {
  test(`${id} ${city}/${grade}/${nights}晚/${amountYuan}元`, () => {
    const result = auditLodging(
      input({
        city,
        grade,
        checkOut: `2026-10-${String(20 + nights).padStart(2, "0")}`,
        amountYuan,
      }),
      createExampleStandards(),
    );
    assert.equal(result.status, status);
    assert.equal(result.excessCents, excessCents);
    if (id === "T03") assert.equal(result.limitCents, 150000);
    if (id === "T05") assert.equal(result.limitCents, 120000);
    if (id === "T07") {
      assert.equal(result.limitCents, null);
      assert.equal(result.standardSnapshot?.matched, false);
      assert.ok(result.reasons.includes("missing_standard"));
    }
    if (id === "T08" || id === "T09") {
      assert.equal(result.standardSnapshot, null);
      assert.equal(result.limitCents, null);
      assert.ok(result.issues.length > 0);
    }
    assert.equal(result.ruleId, "R001");
  });
}
test("模拟制度单独维护，五城市三职级共15条，新增及修改组合使用新版本", () => {
  const initial = createExampleState();
  assert.equal(initial.standards.rows.length, 15);
  const next = upsertStandard(
    initial,
    "深圳市",
    "普通员工",
    "700.00",
    "new-id",
    at,
  );
  assert.equal(next.standards.version, 2);
  assert.equal(next.standards.rows.length, 15);
  assert.equal(auditLodging(input(), next.standards).status, "passed");
  assert.equal(
    auditLodging(input(), initial.standards).status,
    "review_required",
  );
  const added = upsertStandard(
    next,
    "杭州",
    "高级管理人员",
    "900.50",
    "STD-NEW",
    later,
  );
  assert.equal(added.standards.rows.length, 16);
  assert.equal(
    auditLodging(
      input({ city: "杭州", grade: "高级管理人员" }),
      added.standards,
    ).standardSnapshot?.nightlyRateCents,
    90050,
  );
});
test("标准修改不能改变历史单据快照，重新加载仍按历史标准复算", () => {
  const old = createExampleState(),
    snapshot = JSON.stringify(old.records);
  const changed = upsertStandard(old, "深圳", "普通员工", "700", "unused", at);
  assert.equal(JSON.stringify(changed.records), snapshot);
  const stored = validateState(JSON.parse(JSON.stringify(changed)));
  assert.equal(stored.records[0]!.automatic.limitCents, 150000);
  assert.equal(
    stored.records[0]!.automatic.standardSnapshot?.nightlyRateCents,
    50000,
  );
  assert.equal(
    stored.records[0]!.automatic.standardSnapshot?.catalogVersion,
    1,
  );
  assert.equal(auditLodging(input(), stored.standards).limitCents, 210000);
});
test("原来缺标准的历史结果在新增标准后仍保持未配置，不补造历史价格", () => {
  let state = createExampleState();
  const record = makeRecord(
    input({ documentId: "NO-RATE", city: "杭州" }),
    state.standards,
    at,
  );
  state = appendRecord(state, record);
  state = upsertStandard(state, "杭州", "普通员工", "800", "HZ", later);
  validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.records[0]!.automatic.excessCents, null);
  assert.equal(state.records[0]!.automatic.standardSnapshot?.matched, false);
  assert.equal(auditLodging(record.input, state.standards).status, "passed");
});
test("人工通过/驳回均保留自动结果、原因和操作时间，不能无原因或重复复核", () => {
  const original = makeRecord(input(), createExampleStandards(), at),
    auto = JSON.stringify(original.automatic);
  for (const decision of ["approved", "rejected"] as const) {
    const reviewed = reviewRecord(
      original,
      decision,
      "人工核对后记录处理依据",
      "演示财务",
      later,
    );
    assert.equal(JSON.stringify(reviewed.automatic), auto);
    assert.equal(original.humanReview, null);
    assert.equal(reviewed.humanReview?.decision, decision);
    assert.equal(reviewed.humanReview?.at, later);
    validateState(
      replaceRecord(
        appendRecord({ ...createExampleState(), records: [] }, original),
        reviewed,
      ),
    );
    assert.throws(
      () =>
        reviewRecord(reviewed, decision, "重复操作不可覆盖", "演示财务", later),
      /已完成复核/,
    );
  }
  assert.throws(
    () => reviewRecord(original, "approved", "   ", "演示财务", later),
    /复核原因/,
  );
  assert.throws(
    () =>
      reviewRecord(
        original,
        "rejected",
        "时钟早于审核",
        "演示财务",
        "2026-10-23T01:00:00.000Z",
      ),
    /时间不能早于/,
  );
});
test("金额小数按整数分精确比较，不舍入超过两位小数、科学计数法或超安全范围", () => {
  for (const [text, cents] of [
    ["0.29", 29],
    ["0.30", 30],
    ["1000.01", 100001],
    ["0001.2", 120],
  ] as const)
    assert.deepEqual(parseYuan(text), { ok: true, cents });
  for (const value of [
    "1.001",
    "1e3",
    "1,000",
    "NaN",
    "Infinity",
    "-0.01",
    "90071992547409.92",
  ])
    assert.equal(parseYuan(value).ok, false);
  assert.deepEqual(parseYuan("90071992547409.91"), {
    ok: true,
    cents: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(centsToYuan(Number.MAX_SAFE_INTEGER), "90071992547409.91");
  const catalog = upsertStandard(
    createExampleState(),
    "深圳",
    "普通员工",
    "0.10",
    "test",
    at,
  ).standards;
  assert.equal(
    auditLodging(input({ amountYuan: "0.31" }), catalog).excessCents,
    1,
  );
  assert.equal(
    auditLodging(input({ amountYuan: "0.30" }), catalog).status,
    "passed",
  );
  assert.equal(
    auditLodging(input({ amountYuan: "0.301" }), catalog).limitCents,
    null,
  );
  const huge = upsertStandard(
    createExampleState(),
    "深圳",
    "普通员工",
    "90071992547409.91",
    "huge",
    at,
  ).standards;
  const overflow = auditLodging(input(), huge);
  assert.equal(overflow.status, "invalid");
  assert.equal(overflow.limitCents, null);
  assert.equal(overflow.excessCents, null);
  assert.match(overflow.issues[0]!.message, /安全计算范围/);
});
test("0元申请提示人工确认，不判超标；零标准也不会被当作未配置", () => {
  const result = auditLodging(
    input({ amountYuan: "0" }),
    createExampleStandards(),
  );
  assert.equal(result.status, "review_required");
  assert.deepEqual(result.reasons, ["zero_amount"]);
  assert.equal(result.excessCents, 0);
  const catalog = upsertStandard(
    createExampleState(),
    "深圳",
    "普通员工",
    "0",
    "zero",
    at,
  ).standards;
  assert.equal(
    auditLodging(input({ amountYuan: "0.01" }), catalog).excessCents,
    1,
  );
  assert.equal(
    auditLodging(input({ amountYuan: "0.01" }), catalog).standardSnapshot
      ?.matched,
    true,
  );
});
test("日历算法覆盖夏令时区间、闰日和世纪年，不用毫秒差", () => {
  for (const [start, end, nights] of [
    ["2026-03-07", "2026-03-10", 3],
    ["2026-10-03", "2026-10-06", 3],
    ["2024-02-28", "2024-03-01", 2],
    ["1900-02-28", "1900-03-01", 1],
    ["2000-02-28", "2000-03-01", 2],
    ["2026-12-31", "2027-01-02", 2],
  ] as const)
    assert.equal(calculateNights(start, end), nights);
  for (const value of [
    "2026-02-30",
    "1900-02-29",
    "2026-13-01",
    "0000-01-01",
    "2026-2-03",
  ])
    assert.equal(calendarOrdinal(value), null);
  assert.equal(calculateNights("2026-10-23", "2026-10-20"), null);
});
test("缺失字段、非法日期/职级先返回问题，不查标准也不执行超标判断", () => {
  for (const changes of [
    { employeeName: "" },
    { city: "" },
    { amountYuan: "" },
    { checkIn: "" },
    { checkOut: "" },
    { grade: "" },
    { grade: "董事" },
    { checkIn: "2026-02-30" },
    { amountYuan: "-1" },
  ]) {
    const result = auditLodging(input(changes), createExampleStandards());
    assert.ok(["incomplete", "invalid"].includes(result.status));
    assert.equal(result.limitCents, null);
    assert.equal(result.excessCents, null);
    assert.equal(result.standardSnapshot, null);
  }
  const malformed = auditLodging(
    { employeeName: "格式测试", amountYuan: 12 } as unknown as LodgingInput,
    createExampleStandards(),
  );
  assert.equal(malformed.status, "invalid");
  assert.equal(malformed.limitCents, null);
});
test("多晚只比较总金额，无逐晚金额臆测；审核函数不修改输入或标准", () => {
  const item = input({ amountYuan: "1500" }),
    catalog = createExampleStandards(),
    before = JSON.stringify([item, catalog]);
  Object.freeze(item);
  Object.freeze(catalog.rows);
  Object.freeze(catalog);
  assert.equal(auditLodging(item, catalog).status, "passed");
  assert.equal(JSON.stringify([item, catalog]), before);
});
test("破损本地数据保持原值，原始自动结果和人工记录篡改会拒绝加载", () => {
  const map = new Map<string, string>([
    [R001_STORAGE_KEY, "{broken"],
    ["qingbao-v1", "existing-other-module"],
  ]);
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
  assert.equal(loadState(storage).ok, false);
  assert.equal(map.get(R001_STORAGE_KEY), "{broken");
  saveState(storage, createExampleState());
  assert.equal(map.get("qingbao-v1"), "existing-other-module");
  assert.equal(loadState(storage).ok, true);
  const bad = structuredClone(createExampleState()) as unknown as {
    records: { automatic: { excessCents: number } }[];
  };
  bad.records[0]!.automatic.excessCents = 1;
  assert.throws(() => validateState(bad), /原始自动审核/);
});
test("存储失败不修改原数据，新审核和人工复核用保存成功后才生效", () => {
  const current = createExampleState(),
    before = JSON.stringify(current),
    next = replaceRecord(
      current,
      reviewRecord(
        current.records[0]!,
        "approved",
        "虚构例外经核对",
        "演示财务",
        later,
      ),
    );
  const storage = {
    getItem: () => before,
    setItem: () => {
      throw Error("quota");
    },
  };
  assert.throws(() => saveState(storage, next), /当前填写仍保留/);
  assert.equal(JSON.stringify(current), before);
  assert.throws(
    () => appendRecord(current, current.records[0]!),
    /原始审核已留存/,
  );
});

test("旧页面检测到存储变化后拒绝覆盖，已保存的原始记录保持", () => {
  const original = createExampleState(),
    raw = JSON.stringify(original),
    map = new Map([[R001_STORAGE_KEY, raw]]);
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
  const first = appendRecord(
    original,
    makeRecord(input(), original.standards, at),
  );
  saveState(storage, first, raw);
  const saved = map.get(R001_STORAGE_KEY);
  const stale = upsertStandard(
    original,
    "深圳",
    "普通员工",
    "750",
    "unused",
    later,
  );
  assert.throws(() => saveState(storage, stale, raw), /其他页面更新/);
  assert.equal(map.get(R001_STORAGE_KEY), saved);
});
