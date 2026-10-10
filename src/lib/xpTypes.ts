import { z } from "zod";
import type { GrowthSnapshot, XpOutcome } from "./accountGrowth";
const decimal = z.string().regex(/^\d+$/);
export const visibilitySchema = z
  .object({ levelPublic: z.boolean(), xpPublic: z.boolean(), supporterPublic: z.boolean() })
  .strict();
export type AccountVisibility = z.infer<typeof visibilitySchema>;
export const growthSchema = z
  .object({
    level: decimal,
    nextLevel: decimal,
    totalXp: decimal,
    xpInLevel: decimal,
    xpToNextLevel: decimal,
    levelPublic: z.boolean(),
  })
  .strict()
  .refine((g) => {
    const total = BigInt(g.totalXp);
    return (
      BigInt(g.level) === total / 500n + 1n &&
      BigInt(g.nextLevel) === total / 500n + 2n &&
      BigInt(g.xpInLevel) === total % 500n &&
      g.xpToNextLevel === "500"
    );
  });
export const outcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ineligible"), reason: z.string() }),
  z.object({
    status: z.literal("awarded"),
    earnedXp: decimal,
    previousLevel: decimal,
    growth: growthSchema,
    breakdown: z.array(z.object({ label: z.string(), xp: decimal, boost: z.boolean().optional() })),
  }),
]);
export const growthResponseSchema = z.object({
  enabled: z.boolean(),
  growth: growthSchema,
  visibility: visibilitySchema,
  supporter: z.object({ badge: z.string(), tier: z.string(), syncState: z.string() }).nullable(),
  boostEnabled: z.literal(false),
  rules: z.array(z.string()),
});
export type GrowthResponse = z.infer<typeof growthResponseSchema>;
export type ConfirmedXpOutcome = z.infer<typeof outcomeSchema>;
export const XP_REASONS: Record<string, string> = {
  disabled: "XP機能は現在無効です。",
  unreviewed: "この譜面RevisionはXP対象として未審査です。",
  session_limit: "Session発行の時間内上限に達しました。",
  expired: "保存待ちがSessionの有効期間（7日）を超えました。",
  elapsed: "Session発行からの経過時間とreplayが一致しません。",
  daily_cap: "UTC日次XP上限に達しました。",
  repeat_limit: "同じ譜面のUTC日内XP対象回数を超えました。",
  no_hits: "採点対象ノーツの成功判定がありません。",
  practice: "PracticeはXP対象外です。",
  autoplay: "AutoplayはXP対象外です。",
  session_unavailable: "開始前に検証Sessionを取得できませんでした。",
  replay_limit: "入力履歴が保存可能な上限を超えました。",
  verification_failed: "譜面・入力履歴・保存された結果の照合に失敗しました。",
};
export function displayOutcome(value: ConfirmedXpOutcome): XpOutcome {
  return value.status === "ineligible"
    ? { ...value, reason: XP_REASONS[value.reason] ?? value.reason }
    : {
        ...value,
        breakdown: value.breakdown.map((row) => ({
          label: row.label,
          xp: row.xp,
          ...(row.boost === undefined ? {} : { boost: row.boost }),
        })),
      };
}
export type XpSnapshot = GrowthSnapshot;
