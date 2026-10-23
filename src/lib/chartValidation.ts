import { z } from "zod";
import type { Chart } from "@/game/types";
import { buildRuntimeNotes } from "@/game/engine";

export const MAX_CHART_BYTES = 8 * 1024 * 1024;
const note = z.object({
  beat: z.number().finite(),
  lane: z.number().int().min(0).max(3),
  kind: z.enum(["tap", "hold"]),
  lengthBeats: z.number().finite().nonnegative().optional(),
});
export const canonicalChartSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string(),
  artist: z.string(),
  audioUrl: z.string(),
  bpm: z.number().finite().positive(),
  offset: z.number().finite(),
  laneCount: z.literal(4),
  difficultyName: z.string(),
  notes: z.array(note).min(1).max(100000),
  fnf: z
    .object({
      playerSide: z.enum(["left", "right"]),
      left: z.array(note).max(100000),
      right: z.array(note).max(100000),
    })
    .optional(),
});
export function validateCanonicalChart(value: unknown, durationMs: number): Chart {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 7_200_000)
    throw new Error("Invalid audio duration");
  const parsed = canonicalChartSchema.parse(value);
  const cleanNotes = (notes: typeof parsed.notes) =>
    notes.map(({ lengthBeats, ...rest }) => ({
      ...rest,
      ...(lengthBeats === undefined ? {} : { lengthBeats }),
    }));
  const { fnf, ...base } = parsed;
  const chart: Chart = {
    ...base,
    notes: cleanNotes(base.notes),
    ...(fnf
      ? {
          fnf: {
            playerSide: fnf.playerSide,
            left: cleanNotes(fnf.left),
            right: cleanNotes(fnf.right),
          },
        }
      : {}),
  };
  const sides = chart.fnf ? [chart.notes, chart.fnf.left, chart.fnf.right] : [chart.notes];
  for (const notes of sides) {
    for (const n of notes)
      if (n.kind === "hold" && !(n.lengthBeats && n.lengthBeats > 0))
        throw new Error("Invalid hold interval");
    const runtime = buildRuntimeNotes({ ...chart, notes });
    for (const n of runtime)
      if (n.time < 0 || n.time * 1000 > durationMs || (n.endTime ?? n.time) * 1000 > durationMs)
        throw new Error("Chart is outside audio duration");
  }
  if (chart.fnf && JSON.stringify(chart.notes) !== JSON.stringify(chart.fnf[chart.fnf.playerSide]))
    throw new Error("Scoring side does not match canonical notes");
  return chart;
}
export function assertManagedPath(path: string, ownerId?: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((x) => !x || x === "." || x === "..") ||
    /[?#]/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) < 32) ||
    (ownerId && !path.startsWith(`${ownerId}/`))
  )
    throw new Error("管理下のStorageパスが必要です");
  return path;
}

/** Reject malformed source numbers before the legacy parser's forgiving fallbacks. */
export function validateRevisionSource(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_CHART_BYTES)
    throw new Error("Chart source exceeds 8 MiB");
  if (text.trimStart().startsWith("{")) {
    const root = z.record(z.unknown()).parse(JSON.parse(text));
    const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    if (Array.isArray(root["notes"])) {
      if (
        !finite(root["bpm"]) ||
        Number(root["bpm"]) <= 0 ||
        (root["offset"] !== undefined && !finite(root["offset"]))
      )
        throw new Error("Invalid native timing");
      for (const n of root["notes"]) {
        const note = z.record(z.unknown()).parse(n);
        if (
          !finite(note["beat"]) ||
          !finite(note["lane"]) ||
          (note["lengthBeats"] !== undefined && !finite(note["lengthBeats"]))
        )
          throw new Error("Invalid native note");
      }
    } else if (root["song"] && typeof root["song"] === "object") {
      const song = z.record(z.unknown()).parse(root["song"]);
      if (!finite(song["bpm"]) || Number(song["bpm"]) <= 0) throw new Error("Invalid FNF BPM");
      const sections = z
        .array(z.object({ sectionNotes: z.array(z.array(z.unknown())) }))
        .parse(song["notes"]);
      for (const section of sections)
        for (const n of section.sectionNotes) {
          if (
            !finite(n[0]) ||
            Number(n[0]) < 0 ||
            !Number.isInteger(n[1]) ||
            Number(n[1]) < 0 ||
            Number(n[1]) > 7 ||
            !finite(n[2]) ||
            Number(n[2]) < 0
          )
            throw new Error("Invalid FNF note");
        }
    } else {
      const difficulties = z
        .record(
          z.array(
            z.object({
              t: z.number().finite().nonnegative(),
              d: z.number().int().min(0).max(7),
              l: z.number().finite().nonnegative().optional(),
            }),
          ),
        )
        .parse(root["notes"]);
      if (!Object.keys(difficulties).length) throw new Error("No FNF notes");
    }
  } else {
    const keys = text.match(/^CircleSize\s*:\s*(.+)$/m);
    if (!keys || Number(keys[1]) !== 4) throw new Error("New revisions require 4K charts");
    const lines = text.split(/\r?\n/);
    let section = "";
    for (const line of lines) {
      const clean = line.trim();
      if (clean.startsWith("[")) {
        section = clean;
        continue;
      }
      if (!clean || clean.startsWith("//")) continue;
      if (section === "[TimingPoints]" || section === "[HitObjects]") {
        const fields = clean.split(",");
        const required = section === "[TimingPoints]" ? 2 : 5;
        if (
          fields.length < required ||
          fields.slice(0, required).some((v) => !v.trim() || !Number.isFinite(Number(v)))
        )
          throw new Error("Invalid osu timing or note");
        if (section === "[HitObjects]" && Number(fields[2]) < 0)
          throw new Error("Negative note time");
      }
    }
  }
}
