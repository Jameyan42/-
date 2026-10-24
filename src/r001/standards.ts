import type { StandardsCatalog } from "./types";
import { GRADES } from "./types";

// Simulation policy is separate from the audit function. Unit: CNY cents/night.
const EXAMPLE_RATES = [
  { city: "深圳", cents: [50000, 70000, 100000] },
  { city: "北京", cents: [60000, 80000, 120000] },
  { city: "上海", cents: [60000, 80000, 120000] },
  { city: "东莞", cents: [35000, 50000, 80000] },
  { city: "成都", cents: [40000, 60000, 90000] },
] as const;

export function createExampleStandards(): StandardsCatalog {
  return {
    version: 1,
    updatedAt: "2026-10-24T00:00:00.000Z",
    rows: EXAMPLE_RATES.flatMap((row, cityIndex) =>
      GRADES.map((grade, gradeIndex) => ({
        id: `STD-${cityIndex + 1}-${gradeIndex + 1}`,
        city: row.city,
        grade,
        nightlyRateCents: row.cents[gradeIndex]!,
      })),
    ),
  };
}
