import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  validateDateRange,
  processingDate,
  withinDateRange,
  datePreset,
} from "./processing-dates.js";
import { processedRows, processedCsv, makeOperation } from "./operations.js";
import { defaultOrg } from "./organization.js";
test("日期校验拒绝倒置、非日期与不存在的日历日，允许只填一端", () => {
  assert.deepEqual(validateDateRange("2026-10-01", ""), {
    from: "2026-10-01",
    to: "",
  });
  assert.deepEqual(validateDateRange("", "2026-10-23"), {
    from: "",
    to: "2026-10-23",
  });
  assert.doesNotThrow(() => validateDateRange("2024-02-29", "2024-02-29"));
  for (const [from, to] of [
    ["2026-10-24", "2026-10-23"],
    ["2026-02-29", ""],
    ["2026-02-30", ""],
    ["2026-13-01", ""],
    ["10/23/2026", ""],
    ["0000-01-01", ""],
    [{}, ""],
  ])
    assert.throws(() => validateDateRange(from, to));
  assert.equal(processingDate("not a date"), null);
});
test("常用时间段跨月跨年和闰年正确，近7天含今天，不改传入时钟", () => {
  const now = new Date(2027, 0, 3, 12),
    snapshot = now.getTime();
  assert.deepEqual(datePreset("last7", now), {
    from: "2026-12-28",
    to: "2027-01-03",
  });
  assert.deepEqual(datePreset("lastMonth", now), {
    from: "2026-12-01",
    to: "2026-12-31",
  });
  assert.deepEqual(datePreset("month", now), {
    from: "2027-01-01",
    to: "2027-01-03",
  });
  assert.deepEqual(datePreset("today", now), {
    from: "2027-01-03",
    to: "2027-01-03",
  });
  assert.deepEqual(datePreset("lastMonth", new Date(2024, 2, 15, 12)), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.deepEqual(datePreset("all", now), { from: "", to: "" });
  assert.equal(now.getTime(), snapshot);
  assert.throws(() => datePreset("unknown", now));
});
function checkZone(zone, times, range) {
  const url = new URL("./processing-dates.js", import.meta.url).href;
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {processingDate,withinDateRange,processingTimeZone} from ${JSON.stringify(url)};const times=${JSON.stringify(times)},range=${JSON.stringify(range)};console.log(JSON.stringify({days:times.map(processingDate),match:times.map(t=>withinDateRange(t,range)),zone:processingTimeZone()}));`,
      ],
      { env: { ...process.env, TZ: zone }, encoding: "utf8" },
    ),
  );
}
test("上海时区以本地午夜分日，起止日期均包含全天", () => {
  const r = checkZone(
    "Asia/Shanghai",
    [
      "2026-10-22T15:59:59.999Z",
      "2026-10-22T16:00:00.000Z",
      "2026-10-23T15:59:59.999Z",
      "2026-10-23T16:00:00.000Z",
    ],
    { from: "2026-10-23", to: "2026-10-23" },
  );
  assert.deepEqual(r.days, [
    "2026-10-22",
    "2026-10-23",
    "2026-10-23",
    "2026-10-24",
  ]);
  assert.deepEqual(r.match, [false, true, true, false]);
  assert.equal(r.zone, "Asia/Shanghai");
});
test("夏令时23小时和25小时的本地日均完整包含，不靠固定24小时偏移", () => {
  const spring = checkZone(
    "America/New_York",
    [
      "2026-03-08T04:59:59.999Z",
      "2026-03-08T05:00:00Z",
      "2026-03-09T03:59:59.999Z",
      "2026-03-09T04:00:00Z",
    ],
    { from: "2026-03-08", to: "2026-03-08" },
  );
  const fall = checkZone(
    "America/New_York",
    [
      "2026-11-01T03:59:59.999Z",
      "2026-11-01T04:00:00Z",
      "2026-11-02T04:59:59.999Z",
      "2026-11-02T05:00:00Z",
    ],
    { from: "2026-11-01", to: "2026-11-01" },
  );
  assert.deepEqual(spring.match, [false, true, true, false]);
  assert.deepEqual(fall.match, [false, true, true, false]);
});
test("日期与身份、类型、结果组合筛选一致，导出写明本地日及范围", () => {
  const actor = defaultOrg().people.find((p) => p.id === "manager-zhao");
  const create = (id, day) => {
    const d = {
      id,
      name: id,
      employee: "林晓",
      department: "销售部",
      type: "差旅交通",
      amount: 200,
      status: "待主管审批",
      history: [],
    };
    const operation = makeOperation({
      doc: d,
      kind: "expense",
      actor,
      action: "approve",
      stage: "business",
      label: "主管审批",
      toStatus: "待财务审核",
    });
    operation.at = new Date(2026, 9, day, 12).toISOString();
    return {
      ...d,
      status: "待财务审核",
      history: [{ text: "主管通过", time: day + "日", operation }],
    };
  };
  const docs = [create("日期内", 23), create("日期外", 22)],
    range = { from: "2026-10-23", to: "2026-10-23" };
  const rows = processedRows(docs, [], actor, {
    ...range,
    kind: "expense",
    result: "approve",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doc.name, "日期内");
  assert.equal(
    processedRows(docs, [], { ...actor, id: "other" }, range).length,
    0,
  );
  assert.equal(
    processedRows(docs, [], actor, { ...range, result: "reject" }).length,
    0,
  );
  assert.throws(() =>
    processedRows(docs, [], actor, { from: "2026-10-24", to: "2026-10-23" }),
  );
  const csv = processedCsv(rows, range);
  assert.ok(csv.includes("日期筛选时区"));
  assert.ok(csv.includes("本地处理日期"));
  assert.ok(csv.includes("2026-10-23"));
  assert.ok(!csv.includes("日期外"));
  assert.equal(docs.length, 2);
});
