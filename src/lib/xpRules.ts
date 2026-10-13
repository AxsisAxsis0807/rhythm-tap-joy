import type { GrowthSnapshot } from "./accountGrowth";

export const XP_RULE_VERSION = "pulse-xp-v1";
export const XP_DAILY_LIMIT = 1500;
export type TimeInterval = readonly [number, number];
export const XP_RULES = [
  "承認された譜面を通常プレイで完了すると、検証した参加時間1分につき30 XPを獲得します。",
  "同じ曲グループの1日6〜10回目はプレイXPが1/2、11回目以降は1/4になります。",
  "UTC日の初回と曲グループの生涯初回に各50 XP。合計上限は1日1,500 XPです。",
  "1日の切替はUTC 00:00（日本時間09:00）。最初のサーバー受付日を使います。",
  "上限到達後も有効完了回数と初クリアは記録され、ボーナスは翌日に繰り越されません。",
  "参加時間は成功ノーツの前後2.5秒と実際の保持区間から算出する近似値です。",
];

export function levelThreshold(level: bigint): bigint {
  if (level < 1n) throw new Error("Level must be positive");
  return 25n * (level - 1n) * (level + 18n);
}
export function getGrowthSnapshot(totalXp: bigint, levelPublic = true): GrowthSnapshot {
  if (totalXp < 0n) throw new Error("XP cannot be negative");
  let low = 1n;
  let high = 2n;
  while (levelThreshold(high) <= totalXp) high *= 2n;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (levelThreshold(middle) <= totalXp) low = middle;
    else high = middle;
  }
  return {
    level: String(low),
    nextLevel: String(low + 1n),
    totalXp: String(totalXp),
    xpInLevel: String(totalXp - levelThreshold(low)),
    // This existing display contract means the whole level, not remaining XP.
    xpToNextLevel: String(500n + 50n * (low - 1n)),
    levelPublic,
  };
}
export function unionIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const sorted = intervals
    .map(([start, end]) => {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
        throw new Error("Activity coordinates must be integer milliseconds");
      return [start, end] as const;
    })
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const output: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = output[output.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else output.push([start, end]);
  }
  return output;
}
export function intersectIntervals(a: readonly TimeInterval[], b: readonly TimeInterval[]) {
  const left = unionIntervals(a);
  const right = unionIntervals(b);
  const result: TimeInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i]!;
    const y = right[j]!;
    const start = Math.max(x[0], y[0]);
    const end = Math.min(x[1], y[1]);
    if (end > start) result.push([start, end]);
    if (x[1] < y[1]) i++;
    else j++;
  }
  return result;
}
export function subtractIntervals(a: readonly TimeInterval[], removed: readonly TimeInterval[]) {
  let result = unionIntervals(a);
  for (const [start, end] of unionIntervals(removed)) {
    result = result.flatMap(([aStart, aEnd]): TimeInterval[] => {
      if (end <= aStart || start >= aEnd) return [[aStart, aEnd]];
      return [
        ...(start > aStart ? ([[aStart, start]] as TimeInterval[]) : []),
        ...(end < aEnd ? ([[end, aEnd]] as TimeInterval[]) : []),
      ];
    });
  }
  return result;
}
export function intervalDuration(intervals: readonly TimeInterval[]) {
  return unionIntervals(intervals).reduce((sum, [start, end]) => sum + end - start, 0);
}
export type ActivityHead = { id: number; timeMs: number; holdEndMs?: number };
export function evaluateParticipation(input: {
  heads: readonly ActivityHead[];
  successfulHeadIds: ReadonlySet<number>;
  heldIntervals: readonly TimeInterval[];
  durationMs: number;
  pauseIntervals?: readonly TimeInterval[];
}) {
  const { heads, successfulHeadIds, durationMs } = input;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    throw new Error("Invalid canonical duration");
  const audio: TimeInterval[] = [[0, durationMs]];
  const headWindows = (subset: readonly ActivityHead[]) =>
    subset.map((head): TimeInterval => [head.timeMs - 2500, head.timeMs + 2500]);
  const holds = heads.flatMap((head): TimeInterval[] =>
    head.holdEndMs !== undefined && head.holdEndMs > head.timeMs
      ? [[head.timeMs, head.holdEndMs]]
      : [],
  );
  const active = intersectIntervals([...headWindows(heads), ...holds], audio);
  const successes = heads.filter((head) => successfulHeadIds.has(head.id));
  const participation = subtractIntervals(
    intersectIntervals([...headWindows(successes), ...input.heldIntervals], active),
    input.pauseIntervals ?? [],
  );
  const chartActiveMs = intervalDuration(active);
  const participationMs = intervalDuration(participation);
  const reason =
    heads.length < 20
      ? "not_enough_heads"
      : durationMs < 45000
        ? "audio_too_short"
        : chartActiveMs < 45000
          ? "chart_activity_too_short"
          : successes.length < 10 || successes.length * 2 < heads.length
            ? "not_enough_successful_heads"
            : participationMs < 30000
              ? "participation_too_short"
              : null;
  return {
    headCount: heads.length,
    successfulHeads: successes.length,
    chartActiveMs,
    participationMs,
    countedMs: Math.min(participationMs, 600000),
    eligible: reason === null,
    reason,
  };
}
export function calculateXpAward(input: {
  countedMs: number;
  completionNumber: number;
  dailyAwarded: number;
  dailyFirst: boolean;
  groupFirst: boolean;
}) {
  const { countedMs, completionNumber, dailyAwarded } = input;
  if (
    !Number.isSafeInteger(countedMs) ||
    countedMs < 0 ||
    countedMs > 600000 ||
    !Number.isSafeInteger(completionNumber) ||
    completionNumber < 1 ||
    !Number.isSafeInteger(dailyAwarded) ||
    dailyAwarded < 0 ||
    dailyAwarded > XP_DAILY_LIMIT
  )
    throw new Error("Invalid XP calculation input");
  const denominator = completionNumber <= 5 ? 1 : completionNumber <= 10 ? 2 : 4;
  let remaining = XP_DAILY_LIMIT - dailyAwarded;
  const requested = [
    { type: "daily_bonus", label: "今日の初回", amount: input.dailyFirst ? 50 : 0 },
    { type: "first_clear_bonus", label: "初クリア", amount: input.groupFirst ? 50 : 0 },
    { type: "play", label: "プレイ", amount: Math.floor((countedMs * 30) / (60000 * denominator)) },
  ];
  const breakdown = requested.map(({ type, label, amount }) => {
    const awarded = Math.min(amount, remaining);
    remaining -= awarded;
    return { type, label, requested: amount, awarded, capped: amount - awarded };
  });
  return {
    repeatDenominator: denominator,
    breakdown,
    total: breakdown.reduce((sum, row) => sum + row.awarded, 0),
  };
}
