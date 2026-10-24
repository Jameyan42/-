// Deterministic company policy; example amounts, not statutory rates or HR authentication.
export const travelLevels = ["重点城市", "其他城市"];
export const employeeGrades = ["普通员工", "管理人员"];
const money = (n) =>
  Number.isFinite(n) &&
  n >= 0 &&
  n <= 100000 &&
  Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;
const text = (s, n) =>
  typeof s === "string" && s.trim().length > 0 && s.length <= n;
export const cityName = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/市$/, "");
export function defaultTravelRules() {
  return {
    schema: 1,
    version: 1,
    publishedAt: "2026-10-24T00:00:00.000Z",
    cities: ["北京", "上海", "广州", "深圳", "杭州"]
      .map((name) => ({ name, level: "重点城市" }))
      .concat(
        ["南京", "苏州", "武汉", "成都", "西安"].map((name) => ({
          name,
          level: "其他城市",
        })),
      ),
    rates: travelLevels.flatMap((level) =>
      employeeGrades.map((grade) => ({
        level,
        grade,
        hotel:
          level === "重点城市"
            ? grade === "管理人员"
              ? 700
              : 500
            : grade === "管理人员"
              ? 500
              : 350,
        meal: grade === "管理人员" ? 150 : 100,
        local: grade === "管理人员" ? 120 : 80,
      })),
    ),
    overrides: [],
    employees: [
      "lin",
      "chen",
      "tang",
      "staff-reporting",
      "staff-analysis",
      "staff-treasury",
      "staff-tax",
    ].map((id) => ({ id, grade: "普通员工" })),
    effects: {
      hotel: "warn",
      meal: "warn",
      local: "warn",
      hotelFolio: "warn",
      tripRequest: "warn",
    },
    change: {
      actorId: "demo",
      actorName: "演示制度",
      reason: "初始化虚构差旅制度，需财务按本企业制度维护",
    },
  };
}
export function validateTravelRules(r) {
  if (
    !r ||
    r.schema !== 1 ||
    !Number.isInteger(r.version) ||
    r.version < 1 ||
    r.version > 1000000 ||
    !text(r.publishedAt, 40) ||
    !Number.isFinite(Date.parse(r.publishedAt)) ||
    !Array.isArray(r.cities) ||
    r.cities.length > 100 ||
    !Array.isArray(r.rates) ||
    r.rates.length !== 4 ||
    !Array.isArray(r.overrides) ||
    r.overrides.length > 50 ||
    !Array.isArray(r.employees) ||
    r.employees.length > 500 ||
    !r.effects ||
    Object.keys(r.effects).length !== 5 ||
    Object.values(r.effects).some((x) => !["warn", "block"].includes(x)) ||
    ["hotel", "meal", "local", "hotelFolio", "tripRequest"].some(
      (k) => !["warn", "block"].includes(r.effects[k]),
    )
  )
    throw Error("差旅制度格式、版本或处理方式无效");
  const unique = (rows, key) => new Set(rows.map(key)).size === rows.length;
  if (
    r.cities.some(
      (c) =>
        !text(c?.name, 40) ||
        cityName(c.name) !== c.name ||
        !travelLevels.includes(c.level),
    ) ||
    !unique(r.cities, (c) => c.name)
  )
    throw Error("城市名称需规范且不重复，城市档必须有效");
  if (
    r.rates.some(
      (x) =>
        !x ||
        !travelLevels.includes(x.level) ||
        !employeeGrades.includes(x.grade) ||
        ![x.hotel, x.meal, x.local].every(money),
    ) ||
    !unique(r.rates, (x) => x.level + x.grade)
  )
    throw Error("四组城市档/职级标准需完整、唯一且为两位小数非负金额");
  if (
    r.overrides.some(
      (x) =>
        !x ||
        !r.cities.some((c) => c.name === x.city) ||
        !employeeGrades.includes(x.grade) ||
        ![x.hotel, x.meal, x.local].every(money),
    ) ||
    !unique(r.overrides, (x) => x.city + "|" + x.grade)
  )
    throw Error("城市特例需为已维护城市/职级，标准不得重复或无效");
  if (
    r.employees.some(
      (x) => !text(x?.id, 60) || !employeeGrades.includes(x.grade),
    ) ||
    !unique(r.employees, (x) => x.id)
  )
    throw Error("人员职级需绑定唯一人员ID及有效职级");
  if (
    !r.change ||
    !text(r.change.actorId, 60) ||
    !text(r.change.actorName, 60) ||
    !text(r.change.reason, 200) ||
    r.change.reason.trim().length < 5 ||
    JSON.stringify(r).length > 100000
  )
    throw Error("差旅制度需保存维护人员和5～200字原因，或制度超过容量上限");
  return r;
}
export function effectiveTravelRules(policy = {}) {
  return policy.travelRules === undefined
    ? defaultTravelRules()
    : validateTravelRules(policy.travelRules);
}
export function nextTravelRules(
  policy,
  input,
  actor,
  reason,
  at = new Date().toISOString(),
) {
  if (!actor?.active || actor.role !== "财务")
    throw Error("仅财务可维护差旅制度和人员职级");
  return validateTravelRules({
    ...structuredClone(input),
    schema: 1,
    version: effectiveTravelRules(policy).version + 1,
    publishedAt: at,
    change: {
      actorId: actor.id,
      actorName: actor.name,
      reason: String(reason || "").trim(),
    },
  });
}
export function resolveTravelStandard(
  policy,
  actor,
  trip,
  at = new Date().toISOString(),
) {
  const r = effectiveTravelRules(policy),
    city = cityName(trip.destination),
    mapped = r.cities.find((x) => x.name === city),
    assignment = r.employees.find((x) => x.id === actor.id),
    grade = assignment?.grade || "普通员工",
    level = mapped?.level || "其他城市",
    special = r.overrides.find((x) => x.city === city && x.grade === grade),
    rates =
      special || r.rates.find((x) => x.level === level && x.grade === grade);
  return {
    schema: 1,
    version: r.version,
    at,
    actorId: actor.id,
    actorName: actor.name,
    city,
    cityLevel: level,
    cityMatched: !!mapped,
    grade,
    gradeMatched: !!assignment,
    rateSource: special ? "城市独立标准" : "城市档标准",
    hotel: rates.hotel,
    meal: rates.meal,
    local: rates.local,
    effects: structuredClone(r.effects),
  };
}
export function validateTravelStandard(s, trip) {
  if (
    !s ||
    s.schema !== 1 ||
    !Number.isInteger(s.version) ||
    s.version < 1 ||
    s.version > 1000000 ||
    !text(s.at, 40) ||
    !Number.isFinite(Date.parse(s.at)) ||
    !text(s.actorId, 60) ||
    !text(s.actorName, 60) ||
    !text(s.city, 40) ||
    !travelLevels.includes(s.cityLevel) ||
    !employeeGrades.includes(s.grade) ||
    typeof s.cityMatched !== "boolean" ||
    typeof s.gradeMatched !== "boolean" ||
    !["城市独立标准", "城市档标准"].includes(s.rateSource) ||
    ![s.hotel, s.meal, s.local].every(money) ||
    !s.effects ||
    Object.keys(s.effects).length !== 5 ||
    ["hotel", "meal", "local", "hotelFolio", "tripRequest"].some(
      (k) => !["warn", "block"].includes(s.effects[k]),
    ) ||
    JSON.stringify(s).length > 2000
  )
    throw Error("差旅标准快照无效");
  if (
    trip &&
    (s.city !== cityName(trip.destination) ||
      s.cityLevel !== trip.cityLevel ||
      s.grade !== trip.grade)
  )
    throw Error("差旅标准快照与行程不一致");
  return s;
}
export function captureTravel(v, policy, actor, at) {
  const standard = resolveTravelStandard(policy, actor, v.trip, at);
  return {
    ...v,
    trip: { ...v.trip, cityLevel: standard.cityLevel, grade: standard.grade },
    standard,
  };
}
export function travelChecks(v) {
  if (!v.standard) return [];
  const s = validateTravelStandard(v.standard, v.trip),
    result = [];
  for (const [category, key, unit] of [
    ["住宿", "hotel", "晚"],
    ["餐补", "meal", "天"],
  ]) {
    const lines = v.lines.flatMap((l, i) =>
      l.category === category
        ? [
            {
              index: i + 1,
              category,
              date: l.date,
              actual: l.amount,
              cap: (Math.round(s[key] * 100) * l.units) / 100,
              units: l.units,
              rate: s[key],
              unit,
            },
          ]
        : [],
    );
    for (const l of lines)
      result.push({
        ...l,
        excess: Math.max(0, Math.round((l.actual - l.cap) * 100) / 100),
        key,
      });
  }
  // Aggregate every same-day local transport line before comparing, so splitting cannot bypass a daily cap.
  const dates = [
    ...new Set(
      v.lines.filter((l) => l.category === "市内交通").map((l) => l.date),
    ),
  ];
  for (const date of dates) {
    const lines = v.lines.filter(
        (l) => l.category === "市内交通" && l.date === date,
      ),
      actual = lines.reduce((n, l) => n + Math.round(l.amount * 100), 0) / 100;
    result.push({
      category: "市内交通",
      date,
      actual,
      cap: s.local,
      units: 1,
      rate: s.local,
      unit: "天",
      excess: Math.max(0, Math.round((actual - s.local) * 100) / 100),
      key: "local",
    });
  }
  return result;
}
