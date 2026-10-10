import { z } from "zod";
import type { Chart } from "./types";
import { START_DELAY, DEFAULT_WINDOWS, DEFAULT_SCORE_RULES } from "./config";
import {
  applyJudgement,
  buildRuntimeNotes,
  createPlayState,
  findHittableNote,
  judgeDelta,
} from "./engine";

const noteSchema = z
  .object({
    beat: z.number().finite().min(0).max(144000),
    lane: z.number().int().min(0).max(3),
    kind: z.enum(["tap", "hold"]),
    lengthBeats: z.number().finite().positive().max(144000).optional(),
  })
  .strict();
export const revisionSchema = z
  .object({
    id: z.string().min(1).max(200),
    bpm: z.number().finite().positive().max(1000),
    offset: z.number().finite().min(-30).max(30),
    laneCount: z.literal(4),
    notes: z.array(noteSchema).min(1).max(100000),
    fnf: z
      .object({
        playerSide: z.enum(["left", "right"]),
        left: z.array(noteSchema).max(100000),
        right: z.array(noteSchema).max(100000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ChartRevision = Pick<Chart, "id" | "bpm" | "offset" | "laneCount" | "notes" | "fnf">;
/** Strip URLs/display metadata; enumerate fields in a stable order for content hashes. */
export function chartRevision(chart: ChartRevision): ChartRevision {
  const notes = (ns: Chart["notes"]) =>
    ns.map((n) => ({
      beat: n.beat,
      lane: n.lane,
      kind: n.kind,
      ...(n.lengthBeats === undefined ? {} : { lengthBeats: n.lengthBeats }),
    }));
  return revisionSchema.parse({
    id: chart.id,
    bpm: chart.bpm,
    offset: chart.offset,
    laneCount: chart.laneCount,
    notes: notes(chart.notes),
    ...(chart.fnf
      ? {
          fnf: {
            playerSide: chart.fnf.playerSide,
            left: notes(chart.fnf.left),
            right: notes(chart.fnf.right),
          },
        }
      : {}),
  }) as ChartRevision;
}
export async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const replayEventSchema = z
  .object({
    kind: z.enum(["tick", "press", "release", "clear", "pause", "resume", "calibration"]),
    elapsedMs: z
      .number()
      .finite()
      .min(0)
      .max(7 * 86400000),
    time: z.number().finite().min(-32).max(7205),
    source: z.string().min(1).max(80).optional(),
    lane: z.number().int().min(0).max(3).optional(),
    cancelled: z.boolean().optional(),
    offsetMs: z.number().finite().min(-300).max(300).optional(),
  })
  .strict();
export type ReplayEvent = z.infer<typeof replayEventSchema>;
export const replaySchema = z
  .object({ version: z.literal(1), events: z.array(replayEventSchema).max(250000) })
  .strict();
export type PlayReplay = z.infer<typeof replaySchema>;
export type PlayVerification = { sessionId?: string; reason?: string; replay: PlayReplay };
export class ReplayRecorder {
  private startAt = performance.now();
  readonly replay: PlayReplay = { version: 1, events: [] };
  overflow = false;
  record(
    kind: ReplayEvent["kind"],
    time: number,
    extra: Pick<ReplayEvent, "source" | "lane" | "cancelled" | "offsetMs"> = {},
  ) {
    if (this.replay.events.length >= 250000) {
      this.overflow = true;
      return;
    }
    this.replay.events.push({
      kind,
      time,
      elapsedMs: Math.max(0, performance.now() - this.startAt),
      ...extra,
    });
  }
}
/** Executes the ordered input + frame operations of useRhythmGame, using the SAME
 * engine/windows/rules. Frames are recorded because auto-miss order affects combo.
 * No input frequency heuristic: chords and multiple independent touch sources work.
 */
export function verifyReplay(
  revision: ChartRevision,
  audioDuration: number,
  offsetMs: number,
  replay: PlayReplay,
) {
  revision = chartRevision(revision);
  replay = replaySchema.parse(replay);
  if (
    revision.fnf &&
    JSON.stringify(revision.notes) !== JSON.stringify(revision.fnf[revision.fnf.playerSide])
  )
    throw new Error("revision_side");
  if (
    !Number.isFinite(audioDuration) ||
    audioDuration <= 0 ||
    audioDuration > 7200 ||
    !Number.isFinite(offsetMs) ||
    Math.abs(offsetMs) > 300
  )
    throw new Error("revision_invalid");
  const chart: Chart = { ...revision, title: "", artist: "", audioUrl: "", difficultyName: "" };
  const notes = buildRuntimeNotes(chart),
    state = createPlayState();
  const sources = new Map<string, number>(),
    held = new Map<number, (typeof notes)[number]>();
  let cursor = 0,
    lastElapsed = 0,
    baseElapsed = 0,
    baseTime = -START_DELAY,
    paused = false,
    finished = false;
  let offset = offsetMs / 1000;
  const clear = (time: number) => {
    sources.clear();
    for (const note of held.values()) {
      note.holding = false;
      note.judgement = "MISS";
      applyJudgement(state, "MISS", 0, DEFAULT_SCORE_RULES, time);
    }
    held.clear();
  };
  for (const event of replay.events) {
    if (finished || event.elapsedMs < lastElapsed) throw new Error("replay_order");
    lastElapsed = event.elapsedMs;
    const expected = baseTime + (paused ? 0 : (event.elapsedMs - baseElapsed) / 1000);
    // DOM edges can be delivered after a paint; initial calibration is in the Session; bounded edits are replayed.
    // Clear uses the last painted song position, exactly as the existing engine does.
    if (event.kind !== "clear" && Math.abs(event.time - expected) > 0.3 && event.kind !== "resume")
      throw new Error("replay_clock");
    if (event.kind === "clear") {
      if (event.time > expected + 0.3) throw new Error("replay_clear");
      clear(event.time);
      continue;
    }
    if (event.kind === "pause") {
      if (paused) throw new Error("replay_pause");
      paused = true;
      baseElapsed = event.elapsedMs;
      baseTime = event.time;
      continue;
    }
    if (event.kind === "resume") {
      if (!paused || Math.abs(event.time - (Math.max(0, baseTime) - 0.75)) > 0.3)
        throw new Error("replay_resume");
      paused = false;
      baseElapsed = event.elapsedMs;
      baseTime = event.time;
      continue;
    }
    if (event.kind === "calibration") {
      if (event.offsetMs === undefined) throw new Error("replay_calibration");
      offset = event.offsetMs / 1000;
      continue;
    }
    if (paused) throw new Error("replay_paused_input");
    if (event.kind === "tick") {
      for (const [lane, note] of held)
        if (note.endTime !== undefined && event.time >= note.endTime) {
          note.holding = false;
          held.delete(lane);
        }
      while (cursor < notes.length) {
        const n = notes[cursor]!;
        if (n.judged) {
          cursor++;
          continue;
        }
        if (event.time - n.time > DEFAULT_WINDOWS.miss) {
          n.judged = true;
          n.judgement = "MISS";
          applyJudgement(state, "MISS", 0, DEFAULT_SCORE_RULES, event.time);
          cursor++;
        } else break;
      }
      finished = event.time > Math.max(audioDuration, (notes.at(-1)?.time ?? 0) + 2.5);
    } else if (event.kind === "press") {
      if (event.source === undefined || event.lane === undefined || sources.has(event.source))
        throw new Error("replay_source");
      sources.set(event.source, event.lane);
      const time = event.time + offset,
        note = findHittableNote(notes, event.lane, time, DEFAULT_WINDOWS);
      if (!note) continue;
      const judgement = judgeDelta(time - note.time, DEFAULT_WINDOWS)!;
      note.judged = true;
      note.judgement = judgement;
      if (note.kind === "hold" && judgement !== "MISS") {
        note.holding = true;
        held.set(event.lane, note);
      }
      applyJudgement(state, judgement, (time - note.time) * 1000, DEFAULT_SCORE_RULES, time);
    } else {
      if (event.source === undefined || !sources.has(event.source))
        throw new Error("replay_source");
      const lane = sources.get(event.source)!;
      sources.delete(event.source);
      if ([...sources.values()].includes(lane)) continue;
      const note = held.get(lane);
      if (!note) continue;
      const time = event.time + offset;
      if (
        event.cancelled ||
        (note.endTime !== undefined && time < note.endTime - DEFAULT_WINDOWS.good)
      ) {
        note.judgement = "MISS";
        applyJudgement(state, "MISS", 0, DEFAULT_SCORE_RULES, time);
      }
      note.holding = false;
      held.delete(lane);
    }
  }
  if (!finished || notes.some((n) => !n.judged)) throw new Error("replay_incomplete");
  const c = state.counts,
    total = c.PERFECT + c.GREAT + c.GOOD + c.MISS;
  return {
    score: String(state.score),
    maxCombo: String(state.maxCombo),
    perfect: String(c.PERFECT),
    great: String(c.GREAT),
    good: String(c.GOOD),
    miss: String(c.MISS),
    accuracy: total ? ((c.PERFECT + c.GREAT * 0.7 + c.GOOD * 0.4) * 100) / total : 100,
    elapsedMs: lastElapsed,
  };
}
