import { expect, it } from "vitest";
import { audioMetadata } from "@/lib/audioMetadata";
import {
  assertManagedPath,
  validateCanonicalChart,
  validateRevisionSource,
} from "@/lib/chartValidation";

function wav() {
  const bytes = new Uint8Array(16044);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WAVE"],
    [12, "fmt "],
    [36, "data"],
  ] as const)
    bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 16000, true);
  return bytes;
}
it("derives WAV duration from bytes and rejects truncation, spoofed codec and inconsistent rate", () => {
  expect(audioMetadata(wav())).toEqual({ durationMs: 1000, mime: "audio/wav" });
  expect(() => audioMetadata(wav().slice(0, -1))).toThrow();
  const codec = wav();
  new DataView(codec.buffer).setUint16(20, 999, true);
  expect(() => audioMetadata(codec)).toThrow(/encoding/);
  const rate = wav();
  new DataView(rate.buffer).setUint32(28, 1, true);
  expect(() => audioMetadata(rate)).toThrow(/encoding/);
  expect(() => audioMetadata(new TextEncoder().encode("OggS unsupported"))).toThrow();
});
it("rejects non-finite source numbers before forgiving legacy imports", () => {
  expect(() => validateRevisionSource('{"bpm":120,"notes":[{"beat":1e999,"lane":0}]}')).toThrow();
  expect(() =>
    validateRevisionSource('{"song":{"bpm":120,"notes":[{"sectionNotes":[[100,8,0]]}]}}'),
  ).toThrow();
  expect(() => validateRevisionSource("[Difficulty]\nCircleSize:7\n[HitObjects]\n")).toThrow(/4K/);
});
it("validates complete hold intervals, duration bounds, four lanes and selected FNF side", () => {
  const chart = {
    id: "test",
    title: "test",
    artist: "",
    audioUrl: "",
    difficultyName: "test",
    bpm: 60,
    offset: 0,
    laneCount: 4,
    notes: [{ beat: 0, lane: 0, kind: "hold", lengthBeats: 1 }],
  };
  expect(validateCanonicalChart(chart, 1000).notes).toHaveLength(1);
  expect(() => validateCanonicalChart(chart, 999)).toThrow(/duration/);
  expect(() =>
    validateCanonicalChart({ ...chart, notes: [{ beat: 0, lane: 0, kind: "hold" }] }, 1000),
  ).toThrow(/hold/);
  expect(() => validateCanonicalChart({ ...chart, laneCount: 7 }, 1000)).toThrow();
  expect(() =>
    validateCanonicalChart(
      { ...chart, fnf: { playerSide: "left", left: [], right: chart.notes } },
      1000,
    ),
  ).toThrow(/Scoring side/);
});
it("managed paths cannot traverse, switch owner or add control/query delimiters", () => {
  expect(assertManagedPath("owner/revision/audio", "owner")).toBe("owner/revision/audio");
  for (const path of [
    "/owner/audio",
    "owner/../audio",
    "owner//audio",
    "other/audio",
    "owner/a?x",
    "owner/a\u0000",
    "owner/a\\b",
  ])
    expect(() => assertManagedPath(path, "owner")).toThrow();
});
