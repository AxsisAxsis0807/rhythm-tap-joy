import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";
const decimal = z.string().regex(/^\d+$/);
export const growthSchema = z.object({
  level: decimal,
  nextLevel: decimal,
  totalXp: decimal,
  xpInLevel: decimal,
  xpToNextLevel: decimal,
  levelPublic: z.boolean(),
});
export const outcomeSchema = z.union([
  z.object({ status: z.enum(["checking", "pending"]) }),
  z.object({ status: z.literal("error"), message: z.string(), retrying: z.boolean() }),
  z.object({ status: z.literal("ineligible"), reason: z.string() }),
  z.object({
    status: z.literal("awarded"),
    receiptId: z.string(),
    earnedXp: decimal,
    previousLevel: decimal,
    growth: growthSchema,
    breakdown: z.array(
      z.object({ label: z.string(), xp: decimal, requestedXp: decimal, cappedXp: decimal }),
    ),
  }),
]);
export const receiptSchema = z.object({ sessionId: z.string().uuid(), outcome: outcomeSchema });
export const beginSchema = z.object({
  enabled: z.boolean(),
  sessionId: z.string().uuid().nullable(),
  expiresAt: z.string().nullable(),
  reason: z.string().optional(),
});
export const runSchema = z
  .object({
    songId: z.string().min(1).max(200),
    revisionId: z.string().uuid().nullable(),
    scoringSide: z.enum(["left", "right", "shared"]),
    playStyle: z.enum(["mania", "fnf"]),
    visualMode: z.enum(["classic", "mania", "fnf"]),
    judgementPolicyId: z.enum(["pulse-mania-v1", "pulse-fnf-v1"]),
    judgementPolicyVersion: z.literal(1),
    chartParserVersion: z.literal("pulse-chart-v1"),
    scoreRulesVersion: z.literal("pulse-score-v1"),
    inputPolicyVersion: z.literal("pulse-input-v1"),
    xpRuleVersion: z.null(),
    timingOffsetMs: z.number().finite().min(-300).max(300),
    practice: z.boolean(),
    autoplay: z.boolean(),
    assist: z.boolean(),
    rate: z.number().finite().positive(),
    competitive: z.boolean(),
    windows: z.object({
      perfect: z.literal(0.045),
      great: z.literal(0.09),
      good: z.literal(0.14),
      miss: z.literal(0.2),
    }),
    scoreRules: z.object({
      base: z.object({ PERFECT: z.literal(1000), GREAT: z.literal(700), GOOD: z.literal(300) }),
      comboBonus: z.literal(2),
      maxComboBonus: z.literal(200),
    }),
  })
  .strict();
const time = {
  sequence: z.number().int().positive(),
  songTime: z.number().finite().min(-5).max(7205),
  clockTime: z.number().finite().min(-5).max(7205),
  elapsedMs: z.number().finite().min(0).max(86_400_000),
};
export const replaySchema = z
  .object({
    version: z.literal("pulse-replay-v1"),
    runId: z.string().uuid(),
    configuration: runSchema,
    status: z.literal("complete"),
    events: z
      .array(
        z.union([
          z
            .object({
              ...time,
              type: z.enum(["press", "release", "cancel"]),
              source: z.number().int().positive().max(200000),
              lane: z.number().int().min(0).max(3),
            })
            .strict(),
          z
            .object({ ...time, type: z.enum(["advance", "clear", "pause", "resume", "complete"]) })
            .strict(),
        ]),
      )
      .min(1)
      .max(200000),
  })
  .strict();
/** Stable object-key order, preserving the input event array's sequence. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}
export async function sha256(bytes: BufferSource) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function toJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object" && value)
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, toJson(v)]),
    );
  throw new Error("Invalid JSON value");
}
