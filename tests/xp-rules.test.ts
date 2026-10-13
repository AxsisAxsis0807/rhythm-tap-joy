import { it, expect } from "vitest";
import {
  getGrowthSnapshot,
  levelThreshold,
  calculateXpAward,
  evaluateParticipation,
  unionIntervals,
} from "@/lib/xpRules";
it("Level curve boundaries remain exact including integers beyond JS precision", () => {
  for (const level of [1n, 2n, 3n, 4n, 5n, 10n, 27n, 28n, 1000000000n]) {
    const threshold = levelThreshold(level);
    expect(getGrowthSnapshot(threshold).level).toBe(String(level));
    if (level > 1n) expect(getGrowthSnapshot(threshold - 1n).level).toBe(String(level - 1n));
  }
  expect([1n, 2n, 3n, 4n, 5n, 10n, 27n, 28n].map(levelThreshold)).toEqual([
    0n,
    500n,
    1050n,
    1650n,
    2300n,
    6300n,
    29250n,
    31050n,
  ]);
  expect(getGrowthSnapshot(30690n)).toMatchObject({
    level: "27",
    xpInLevel: "1440",
    xpToNextLevel: "1800",
  });
});
it("repeat floors and daily cap allocate bonuses first", () => {
  const base = { countedMs: 180000, dailyAwarded: 0, dailyFirst: false, groupFirst: false };
  expect(
    [1, 5, 6, 10, 11].map(
      (completionNumber) => calculateXpAward({ ...base, completionNumber }).total,
    ),
  ).toEqual([90, 90, 45, 45, 22]);
  expect(
    calculateXpAward({ ...base, completionNumber: 1, dailyFirst: true, groupFirst: true }).total,
  ).toBe(190);
  expect(
    calculateXpAward({
      ...base,
      completionNumber: 1,
      dailyAwarded: 1475,
      dailyFirst: true,
      groupFirst: true,
    }).breakdown.map((x) => x.awarded),
  ).toEqual([25, 0, 0]);
  expect(calculateXpAward({ ...base, countedMs: 45000, completionNumber: 1 }).total).toBe(22);
});
it("unions overlaps and ignores silent gaps/unheld tails", () => {
  expect(
    unionIntervals([
      [0, 10],
      [5, 20],
      [50, 60],
      [60, 65],
    ]),
  ).toEqual([
    [0, 20],
    [50, 65],
  ]);
  const heads = Array.from({ length: 24 }, (_, id) => ({ id, timeMs: 2500 + id * 2500 }));
  expect(
    evaluateParticipation({
      heads,
      successfulHeadIds: new Set(heads.map((h) => h.id)),
      heldIntervals: [],
      durationMs: 65000,
    }),
  ).toMatchObject({ eligible: true, chartActiveMs: 62500, countedMs: 62500 });
  expect(
    evaluateParticipation({
      heads,
      successfulHeadIds: new Set(),
      heldIntervals: [],
      durationMs: 65000,
    }).eligible,
  ).toBe(false);
});
