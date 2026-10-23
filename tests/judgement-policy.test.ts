import { describe, it, expect } from "vitest";
import { GameplayCore } from "@/game/gameplayCore";
import { createRunConfiguration } from "@/game/runConfiguration";
import { ReplayRecorder } from "@/game/replay";
import { findHittableNote, judgeDelta, buildRuntimeNotes } from "@/game/engine";
import { DEFAULT_WINDOWS } from "@/game/config";
import type { Chart } from "@/game/types";
const chart: Chart = {
  id: "x",
  audioUrl: "",
  title: "x",
  artist: "x",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "x",
  notes: [{ beat: 1, lane: 0, kind: "tap" }],
};
function run(style: "mania" | "fnf", source = chart) {
  const config = createRunConfiguration(source, { playStyle: style });
  const core = new GameplayCore(source, config);
  let sequence = 0;
  const event = (
    type: "press" | "release" | "cancel" | "advance" | "clear" | "pause" | "resume",
    time: number,
    lane = 0,
    source = 1,
  ) =>
    core.process({
      type,
      songTime: time,
      clockTime: time,
      elapsedMs: time * 1000,
      sequence: ++sequence,
      lane,
      source,
    });
  return { core, event };
}
describe("style-specific early input", () => {
  for (const delta of [-0.199, -0.15])
    it(`ignores FNF ${delta}s without consuming; release + press can hit`, () => {
      const { core, event } = run("fnf");
      event("press", 1 + delta);
      expect(core.play.score).toBe(0);
      expect(core.notes[0]?.judged).toBe(false);
      event("advance", 1);
      expect(core.play.score).toBe(0);
      event("release", 1);
      event("press", 1);
      expect(core.play.counts.PERFECT).toBe(1);
    });
  for (const style of ["mania", "fnf"] as const)
    it(`${style} late miss and timeout count once`, () => {
      const { core, event } = run(style);
      event("press", 1.15);
      event("advance", 1.201);
      expect(core.play.counts.MISS).toBe(1);
    });
  it("preserves mania early MISS and stable candidate selection", () => {
    const { core, event } = run("mania");
    event("press", 0.85);
    expect(core.play.counts.MISS).toBe(1);
    const notes = buildRuntimeNotes({
      ...chart,
      notes: [
        { beat: 1, lane: 0, kind: "tap" },
        { beat: 1.35, lane: 0, kind: "tap" },
      ],
    });
    expect(findHittableNote(notes, 0, 1.18, DEFAULT_WINDOWS, "pulse-fnf-v1")?.time).toBe(1);
    expect(findHittableNote(notes, 0, 1.18, DEFAULT_WINDOWS, "pulse-mania-v1")?.time).toBe(1.35);
  });
  it("judges four concurrent sources; duplicate source cannot hit twice", () => {
    const source = {
      ...chart,
      notes: [0, 1, 2, 3].map((lane) => ({ beat: 1, lane, kind: "tap" as const })),
    };
    const { core, event } = run("fnf", source);
    for (let lane = 0; lane < 4; lane++) event("press", 1, lane, lane + 1);
    event("press", 1, 0, 1);
    expect(core.play.counts.PERFECT).toBe(4);
  });
  for (const [boundary, expected] of [
    [0.045, "PERFECT"],
    [0.09, "GREAT"],
    [0.14, "GOOD"],
    [0.2, "MISS"],
  ] as const)
    for (const sign of [-1, 1])
      it(`boundary ${sign * boundary}`, () => {
        expect(judgeDelta(sign * boundary, DEFAULT_WINDOWS)).toBe(expected);
        expect(judgeDelta(sign * (boundary - 1e-6), DEFAULT_WINDOWS)).toBe(expected);
        expect(judgeDelta(sign * (boundary + 1e-6), DEFAULT_WINDOWS)).not.toBe(expected);
      });
  it("native hold counts head and early-release miss separately; final source releases", () => {
    const source = {
      ...chart,
      notes: [{ beat: 1, lane: 0, kind: "hold" as const, lengthBeats: 2 }],
    };
    const { core, event } = run("fnf", source);
    event("press", 1, 0, 1);
    event("press", 1, 0, 2);
    event("release", 1.1, 0, 1);
    expect(core.play.counts.MISS).toBe(0);
    event("release", 1.2, 0, 2);
    event("advance", 4);
    expect(core.play.counts).toEqual({ PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 1 });
    expect(core.hitHeadIds.size).toBe(1);
  });
  it("pause/blur clear produces exactly one hold-release MISS", () => {
    const { core, event } = run("mania", {
      ...chart,
      notes: [{ beat: 1, lane: 0, kind: "hold", lengthBeats: 3 }],
    });
    event("press", 1);
    event("clear", 1.1);
    event("pause", 1.1);
    expect(core.play.counts.MISS).toBe(1);
  });
  it("replay overflow does not prevent the returned event reaching the game", () => {
    const r = new ReplayRecorder("test", createRunConfiguration(chart), {
      maxEvents: 1,
      maxBytes: 10000,
    });
    r.append({ type: "advance", songTime: 0, clockTime: 0, elapsedMs: 0 });
    const e = r.append({
      type: "press",
      source: 1,
      lane: 0,
      songTime: 1,
      clockTime: 1,
      elapsedMs: 1000,
    });
    expect(r.snapshot().status).toBe("event-limit");
    const core = new GameplayCore(chart, createRunConfiguration(chart));
    core.process(e);
    expect(core.play.counts.PERFECT).toBe(1);
  });
});
