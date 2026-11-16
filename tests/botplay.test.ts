import { describe, expect, it } from "vitest";
import { Botplay } from "@/game/botplay";
import { GameplayCore } from "@/game/gameplayCore";
import { createRunConfiguration } from "@/game/runConfiguration";
import type { Chart } from "@/game/types";

const chart: Chart = {
  id: "bot",
  title: "BOT",
  artist: "",
  audioUrl: "/audio",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "TEST",
  notes: [
    ...[0, 1, 2, 3].map((lane) => ({ beat: 0, lane, kind: "tap" as const })),
    ...Array.from({ length: 250 }, (_, i) => ({
      beat: 0.1 + i * 0.005,
      lane: i % 4,
      kind: "tap" as const,
    })),
    { beat: 2, lane: 0, kind: "hold", lengthBeats: 4 },
    { beat: 2, lane: 1, kind: "hold", lengthBeats: 3 },
    { beat: 3, lane: 0, kind: "hold", lengthBeats: 4 },
    { beat: 3.5, lane: 0, kind: "tap" },
    { beat: 5, lane: 1, kind: "tap" },
    { beat: 9.99, lane: 3, kind: "tap" },
  ],
};
function setup(offset = 0, playStyle: "fnf" | "mania" = "mania") {
  const core = new GameplayCore(
    chart,
    createRunConfiguration(chart, { autoplay: true, timingOffsetMs: offset, playStyle }),
  );
  const bot = new Botplay(core);
  const emit = (
    event: Parameters<Botplay["advance"]>[1] extends (event: infer E) => unknown ? E : never,
  ) => core.process({ ...event, sequence: 0 });
  return { core, bot, emit };
}
describe.each(["fnf", "mania"] as const)("%s BOTPLAY", (style) => {
  it.each([-500, -125, 0, 125, 500])(
    "all heads and overlapping holds are perfect after a dropped frame, offset %s",
    (offset) => {
      const { core, bot, emit } = setup(offset, style);
      bot.advance(-1, emit);
      expect(core.play.score).toBe(0);
      bot.advance(20, emit); // Entire chart in one delayed frame.
      bot.advance(20, emit);
      expect(core.play.counts).toEqual({ PERFECT: chart.notes.length, GREAT: 0, GOOD: 0, MISS: 0 });
      expect(core.play.timingErrorsMs.every((n) => Math.abs(n) < 1e-9)).toBe(true);
      expect(core.notes.every((n) => n.judged && !n.holding)).toBe(true);
      expect(core.successfulHoldIds.size).toBe(3);
      expect(core.heldIntervals.every((x) => x.completed)).toBe(true);
      expect(core.sources.size).toBe(0);
      expect(core.configuration.competitive).toBe(false);
    },
  );
  it("matches fine-grained frames and preserves simultaneous holds through pause", () => {
    const { core, bot, emit } = setup(125, style);
    for (let time = -1; time < 2.5; time += 0.017) bot.advance(time, emit);
    emit({ type: "pause", songTime: 2.5, clockTime: 2.5, elapsedMs: 0 });
    const before = core.snapshotPlay();
    expect(core.notes.filter((n) => n.holding)).toHaveLength(2);
    expect(core.play).toEqual(before);
    emit({ type: "resume", songTime: 2.5, clockTime: 2.5, elapsedMs: 1000 });
    for (let time = 2.5; time <= 11; time += 0.017) bot.advance(time, emit);
    expect(core.play.counts.PERFECT).toBe(chart.notes.length);
    expect(core.play.counts.MISS).toBe(0);
    expect(core.successfulHoldIds.size).toBe(3);
    const single = setup(125, style);
    single.bot.advance(11, single.emit);
    expect(core.snapshotPlay()).toEqual(single.core.snapshotPlay());
  });
});
it("manual core pause still fails a held note and clears its sources", () => {
  const core = new GameplayCore(chart, createRunConfiguration(chart));
  core.process({
    type: "press",
    source: 1,
    lane: 0,
    songTime: 2,
    clockTime: 2,
    elapsedMs: 0,
    sequence: 1,
  });
  core.process({ type: "pause", songTime: 2.5, clockTime: 2.5, elapsedMs: 500, sequence: 2 });
  expect(core.play.counts.MISS).toBe(1);
  expect(core.sources.size).toBe(0);
});

it("BOTPLAY does not relax the core's early-release hold judgement", () => {
  const { core, emit } = setup();
  emit({ type: "press", source: 1, lane: 0, songTime: 2, clockTime: 2, elapsedMs: 0 });
  emit({ type: "release", source: 1, lane: 0, songTime: 2.1, clockTime: 2.1, elapsedMs: 100 });
  expect(core.play.counts.MISS).toBe(1);
  expect(core.successfulHoldIds.size).toBe(0);
});
