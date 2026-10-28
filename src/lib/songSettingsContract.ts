import { z } from "zod";
import type { Chart } from "@/game/types";
import { PREVIEW_DURATION_MS } from "@/game/audioSession";
import { validateCanonicalChart } from "./chartValidation";

/** Versions never pass through a JavaScript number in this protocol. */
export const metadataVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine(
    (value) =>
      /^(0|[1-9]\d*)$/.test(value) && value.length <= 19 && BigInt(value) <= 9223372036854775807n,
    "Invalid metadata version",
  );
const uuid = z.string().uuid();
const sourceId = { sourceOperationId: uuid };
export const songSettingsMetadataSchema = z
  .object({
    title: z.string(),
    artist: z.string(),
    chartAuthor: z.string(),
    difficultyName: z.string(),
    description: z.string().nullable(),
    recommendedPlayStyle: z.enum(["mania", "fnf"]).nullable(),
    previewStartMs: z.number().int().nonnegative().max(7200000).nullable(),
  })
  .strict();
export const saveSongSettingsSchema = z
  .object({
    songId: uuid,
    requestId: uuid,
    expectedVersion: metadataVersionSchema,
    expectedRevisionId: uuid.nullable(),
    metadata: songSettingsMetadataSchema,
    background: z.discriminatedUnion("action", [
      z.object({ action: z.literal("keep") }).strict(),
      z.object({ action: z.literal("remove") }).strict(),
      z.object({ action: z.literal("replace"), assetId: uuid }).strict(),
    ]),
    gameplay: z.discriminatedUnion("action", [
      z.object({ action: z.literal("keep") }).strict(),
      z
        .object({
          action: z.literal("timing"),
          ...sourceId,
          bpm: z.number().finite().positive().optional(),
          offsetMs: z.number().int().finite().optional(),
        })
        .strict(),
      z.object({ action: z.literal("prepared-replacement"), ...sourceId }).strict(),
    ]),
    sourceOperationId: uuid.optional(),
    rightsConfirmation: z
      .object({ confirmed: z.literal(true), ...sourceId })
      .strict()
      .optional(),
    previewConsent: z
      .object({ allowed: z.boolean(), ...sourceId })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const gameplay = input.gameplay;
    const source =
      gameplay.action === "keep" ? input.sourceOperationId : gameplay.sourceOperationId;
    if (
      gameplay.action === "timing" &&
      gameplay.bpm === undefined &&
      gameplay.offsetMs === undefined
    )
      context.addIssue({ code: "custom", path: ["gameplay"], message: "Timing change required" });
    if ((gameplay.action !== "keep" || source || input.previewConsent) && !input.rightsConfirmation)
      context.addIssue({
        code: "custom",
        path: ["rightsConfirmation"],
        message: "Fresh rights confirmation required",
      });
    for (const candidate of [
      input.sourceOperationId,
      input.rightsConfirmation?.sourceOperationId,
      input.previewConsent?.sourceOperationId,
    ]) {
      if (candidate !== undefined && candidate !== source)
        context.addIssue({
          code: "custom",
          path: ["sourceOperationId"],
          message: "Source operation mismatch",
        });
    }
  });
export type SaveSongSettingsInput = z.infer<typeof saveSongSettingsSchema>;
export type SongSettingsMetadata = z.infer<typeof songSettingsMetadataSchema>;
export type TimingBasis = "beats" | "absolute-seconds" | "unknown";
export type SourceFormat = "native" | "osu" | "fnf-legacy" | "fnf-vslice" | "unknown";

export function validateSettingsMetadata(
  value: SongSettingsMetadata,
  base: SongSettingsMetadata,
  durationMs: number | null,
): Partial<Record<keyof SongSettingsMetadata, string>> {
  const errors: Partial<Record<keyof SongSettingsMetadata, string>> = {};
  const limits = {
    title: 120,
    artist: 120,
    chartAuthor: 120,
    difficultyName: 40,
    description: 2000,
  } as const;
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if (value[key] === base[key]) continue;
    const text = key === "title" ? value.title.trim() : (value[key] ?? "");
    if ([...text].length > limits[key] || (key === "title" && !text.length))
      errors[key] = `${key === "title" ? "1〜" : ""}${limits[key]}文字以内で入力してください`;
  }
  const start = value.previewStartMs;
  if (
    start !== null &&
    (!Number.isSafeInteger(start) ||
      start < 0 ||
      (durationMs === null ? start !== base.previewStartMs && start !== 0 : start >= durationMs))
  )
    errors.previewStartMs = "検証済み音源の範囲内で指定してください";
  return errors;
}

export function previewInterval(startMs: number | null, durationMs: number) {
  const start = startMs ?? 0;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(durationMs) ||
    start < 0 ||
    start >= durationMs
  )
    throw new Error("Invalid preview interval");
  return { startMs: start, endMs: Math.min(start + PREVIEW_DURATION_MS, durationMs) };
}

/** Clone a canonical snapshot, preserving FNF sides and the importer's sustain kind. */
export function applySongTiming(
  original: Chart,
  basis: TimingBasis,
  change: { bpm?: number | undefined; offsetMs?: number | undefined },
  durationMs: number,
): Chart {
  if (change.bpm !== undefined && basis !== "beats")
    throw new Error("BPM provenance is not beat based");
  if (change.offsetMs !== undefined && !Number.isSafeInteger(change.offsetMs))
    throw new Error("Offset requires integer milliseconds");
  return validateCanonicalChart(
    {
      ...original,
      ...(change.bpm === undefined ? {} : { bpm: change.bpm }),
      ...(change.offsetMs === undefined ? {} : { offset: change.offsetMs / 1000 }),
    },
    durationMs,
  );
}

/** Owner-facing projection; paths and hashes are resolved on the server. */
export const songSettingsRowSchema = z.object({
  id: uuid,
  user_id: uuid,
  title: z.string(),
  artist: z.string(),
  chart_author: z.string(),
  difficulty_name: z.string(),
  description: z.string().nullable(),
  recommended_play_style: z.enum(["mania", "fnf"]).nullable(),
  preview_start_ms: z.number().int().nonnegative().nullable(),
  metadata_version: metadataVersionSchema,
  current_revision_id: uuid.nullable(),
  background_asset_id: uuid.nullable(),
  is_published: z.boolean(),
  published_at: z.string().nullable(),
  bpm: z.number().finite(),
  offset_sec: z.number().finite(),
  lane_count: z.number().int(),
  note_count: z.number().int(),
  chart_type: z.string(),
  fnf_side: z.string().nullable(),
});
export type SongSettingsRow = z.infer<typeof songSettingsRowSchema>;
export const songSettingsReceiptSchema = z.object({
  requestId: uuid,
  version: metadataVersionSchema,
  revisionId: uuid.nullable(),
  song: songSettingsRowSchema,
});
export type SongSettingsReceipt = z.infer<typeof songSettingsReceiptSchema>;
export function settingsMetadata(row: SongSettingsRow): SongSettingsMetadata {
  return {
    title: row.title,
    artist: row.artist,
    chartAuthor: row.chart_author,
    difficultyName: row.difficulty_name,
    description: row.description,
    recommendedPlayStyle: row.recommended_play_style,
    previewStartMs: row.preview_start_ms,
  };
}
export const songSettingsIdentitySchema = z.object({ songId: uuid }).strict();
export const prepareSongSourceSchema = z
  .object({
    songId: uuid,
    operationId: uuid,
    expectedVersion: metadataVersionSchema,
    expectedRevisionId: uuid.nullable(),
  })
  .strict();
export type PrepareSongSourceInput = z.infer<typeof prepareSongSourceSchema>;
export const preparedSongSourceSchema = z.object({
  operationId: uuid,
  audioHash: z.string().regex(/^[a-f0-9]{64}$/),
  durationMs: z.number().int().positive(),
  audioUrl: z.string(),
  chartUrl: z.string(),
  expiresAt: z.number(),
  bpm: z.number().finite().positive(),
  offset: z.number().finite(),
  sourceFormat: z.enum(["native", "osu", "fnf-legacy", "fnf-vslice", "unknown"]),
  timingBasis: z.enum(["beats", "absolute-seconds", "unknown"]),
  previewAllowed: z.boolean(),
});
export type PreparedSongSource = z.infer<typeof preparedSongSourceSchema>;
export const reserveReplacementSchema = prepareSongSourceSchema
  .extend({
    audioBytes: z.number().int().positive().max(104857600),
    chartBytes: z.number().int().positive().max(8388608),
    audioMime: z.enum(["audio/wav", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm"]),
    chartType: z.enum(["mania", "fnf"]),
    side: z.enum(["left", "right"]),
  })
  .strict();

export type SongBackgroundAsset = {
  assetId: string;
  hash: string;
  url: string;
  expiresAt: number;
  width: number;
  height: number;
};
