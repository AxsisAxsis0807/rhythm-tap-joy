import { expect, it } from "vitest";
import {
  applySongTiming,
  metadataVersionSchema,
  previewInterval,
  saveSongSettingsSchema,
  validateSettingsMetadata,
} from "@/lib/songSettingsContract";
import type { Chart } from "@/game/types";
const id = "12345678-1234-4234-8234-123456789abc";
const metadata = {
  title: "曲",
  artist: "",
  chartAuthor: "",
  difficultyName: "",
  description: null,
  recommendedPlayStyle: null,
  previewStartMs: null,
};
const payload = {
  songId: id,
  requestId: id,
  expectedVersion: "9007199254740993",
  expectedRevisionId: null,
  metadata,
  background: { action: "keep" },
  gameplay: { action: "keep" },
};
it("keeps BIGINT versions exact and rejects number, negative, overflow and non-canonical forms", () => {
  expect(saveSongSettingsSchema.parse(payload).expectedVersion).toBe("9007199254740993");
  for (const value of [1, "-1", "01", "9223372036854775808", "1e2"])
    expect(metadataVersionSchema.safeParse(value).success).toBe(false);
});
it("rejects mass assignment at every request boundary and mismatched source consent", () => {
  for (const value of [
    { ...payload, user_id: id },
    { ...payload, metadata: { ...metadata, is_published: true } },
    { ...payload, background: { action: "keep", path: "foreign" } },
    { ...payload, gameplay: { action: "keep", bpm: 120 } },
    { ...payload, gameplay: { action: "timing", sourceOperationId: id } },
    {
      ...payload,
      gameplay: { action: "timing", sourceOperationId: id, offsetMs: 1 },
      rightsConfirmation: {
        confirmed: true,
        sourceOperationId: "22345678-1234-4234-8234-123456789abc",
      },
    },
  ])
    expect(saveSongSettingsSchema.safeParse(value).success).toBe(false);
});
it("requires fresh rights for a new revision while metadata-only saves need none", () => {
  expect(saveSongSettingsSchema.safeParse(payload).success).toBe(true);
  const change = { ...payload, gameplay: { action: "timing", sourceOperationId: id, offsetMs: 1 } };
  expect(saveSongSettingsSchema.safeParse(change).success).toBe(false);
  expect(
    saveSongSettingsSchema.safeParse({
      ...change,
      rightsConfirmation: { confirmed: true, sourceOperationId: id },
    }).success,
  ).toBe(true);
});
it("preserves nullable starts, clips only the end and rejects invalid milliseconds", () => {
  expect(previewInterval(null, 500)).toEqual({ startMs: 0, endMs: 500 });
  expect(previewInterval(89999, 90000)).toEqual({ startMs: 89999, endMs: 90000 });
  for (const value of [-1, 90000, 0.1, NaN, Infinity])
    expect(() => previewInterval(value, 90000)).toThrow();
});
it("counts Unicode as PostgreSQL characters and allows unchanged legacy long fields", () => {
  expect(
    validateSettingsMetadata({ ...metadata, artist: "😀".repeat(120) }, metadata, null),
  ).toEqual({});
  expect(
    validateSettingsMetadata({ ...metadata, artist: "😀".repeat(121) }, metadata, null),
  ).toHaveProperty("artist");
  const legacy = { ...metadata, description: "x".repeat(3000) };
  expect(validateSettingsMetadata(legacy, legacy, null)).toEqual({});
});
const chart: Chart = {
  id,
  title: "x",
  artist: "",
  difficultyName: "",
  audioUrl: "",
  bpm: 60,
  offset: 0.000123,
  laneCount: 4,
  notes: [{ beat: 1, lane: 0, kind: "tap", lengthBeats: 0.5 }],
};
it("timing edits retain both FNF sides and tap sustains without mutating the source", () => {
  const fnf: Chart = {
    ...chart,
    fnf: { playerSide: "right", left: [{ beat: 2, lane: 1, kind: "tap" }], right: chart.notes },
  };
  const next = applySongTiming(fnf, "absolute-seconds", { offsetMs: 1 }, 10000);
  expect(next.fnf).toEqual(fnf.fnf);
  expect(next.notes[0]!.kind).toBe("tap");
  expect(next.offset).toBe(0.001);
  expect(fnf.offset).toBe(0.000123);
  expect(() => applySongTiming(fnf, "absolute-seconds", { bpm: 120 }, 10000)).toThrow();
  expect(() => applySongTiming(chart, "unknown", { bpm: 120 }, 10000)).toThrow();
  expect(() => applySongTiming(chart, "beats", { offsetMs: -2000 }, 10000)).toThrow();
  expect(applySongTiming(chart, "beats", { bpm: 120 }, 10000).offset).toBe(chart.offset);
});
