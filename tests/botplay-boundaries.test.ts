import { describe, expect, it } from "vitest";
import { Botplay } from "@/game/botplay";
import { GameplayCore } from "@/game/gameplayCore";
import { createRunConfiguration } from "@/game/runConfiguration";
import type { GameplayEventInput } from "@/game/replay";
import type { Chart, ChartNote, RuntimeNote } from "@/game/types";

const tap = (beat: number, lane = 0): ChartNote => ({ beat, lane, kind: "tap" });
const hold = (beat: number, end: number, lane = 0): ChartNote => ({
  beat,
  lane,
  kind: "hold",
  lengthBeats: end - beat,
});
const cases: { name: string; notes: ChartNote[] }[] = [
  {
    name: "three overlapping same-lane holds",
    notes: [hold(0, 4), hold(1, 5), hold(2, 6), tap(3)],
  },
  {
    name: "later holds end before earlier holds",
    notes: [hold(0, 8), hold(1, 6), hold(2, 4), tap(4), tap(6)],
  },
  { name: "tail equals tap head", notes: [hold(0, 2), tap(2), tap(2)] },
  { name: "tail equals hold head", notes: [hold(0, 2), hold(2, 4), hold(4, 6)] },
  {
    name: "duplicate simultaneous same-lane taps",
    notes: [tap(0), tap(0), tap(0), hold(1, 3), tap(2), tap(2)],
  },
  {
    name: "four-lane chord equals multiple tails",
    notes: [
      ...[0, 1, 2, 3].map((lane) => hold(0, 2, lane)),
      ...[0, 1, 2, 3].map((lane) => tap(2, lane)),
      ...[0, 1, 2, 3].map((lane) => hold(2, 4, lane)),
    ],
  },
];
function makeChart(notes: ChartNote[]): Chart {
  return {
    id: "boundary",
    title: "",
    artist: "",
    audioUrl: "/audio",
    bpm: 60,
    offset: 0,
    laneCount: 4,
    difficultyName: "TEST",
    notes,
  };
}
// Read existing private state only in tests; do not add production inspection APIs.
function internals(core: GameplayCore) {
  return {
    heldNotes: Reflect.get(core, "heldNotes") as ReadonlyMap<number, RuntimeNote>,
    holdStartedAt: Reflect.get(core, "holdStartedAt") as ReadonlyMap<number, number>,
  };
}
function assertState(core: GameplayCore, horizon: number) {
  const held = core.notes.filter(
    (note) => note.kind === "hold" && note.time <= horizon && note.endTime! > horizon,
  );
  const ended = core.notes.filter((note) => note.kind === "hold" && note.endTime! <= horizon);
  const state = internals(core);
  expect([...state.heldNotes.keys()].sort()).toEqual(held.map((note) => note.id).sort());
  expect([...state.holdStartedAt.keys()].sort()).toEqual(held.map((note) => note.id).sort());
  for (const note of held) {
    expect(state.heldNotes.get(note.id)?.holding).toBe(true);
    expect(state.holdStartedAt.get(note.id)).toBe(note.time);
    expect(core.sources.get(note.id + 1)).toBe(note.lane);
  }
  expect([...core.sources.keys()].sort()).toEqual(held.map((note) => note.id + 1).sort());
  expect([...core.successfulHoldIds].sort()).toEqual(ended.map((note) => note.id).sort());
  expect(core.heldIntervals).toHaveLength(ended.length);
  for (const interval of core.heldIntervals) {
    const note = core.notes.find((note) => note.id === interval.noteId)!;
    expect(interval).toEqual({
      noteId: note.id,
      startedAt: note.time,
      endedAt: note.endTime,
      completed: true,
    });
  }
  expect(core.play.counts.MISS).toBe(0);
}

describe.each(["fnf", "mania"] as const)("%s BOT event boundaries", (playStyle) => {
  describe.each([-500, 0, 500])("offset %d ms", (timingOffsetMs) => {
    it.each(cases)("$name: fine frames and whole-chart catch-up agree", ({ notes }) => {
      const run = (dropped: boolean, reversed: boolean) => {
        const chart = makeChart(reversed ? [...notes].reverse() : notes);
        const core = new GameplayCore(
          chart,
          createRunConfiguration(chart, { autoplay: true, playStyle, timingOffsetMs }),
        );
        const bot = new Botplay(core);
        const offset = timingOffsetMs / 1000;
        const edges: GameplayEventInput[] = [];
        const activeSources = new Set<number>();
        let previous: GameplayEventInput | undefined;
        let lastAuthoredEdge = -Infinity;
        const emit = (event: GameplayEventInput) => {
          if (event.type === "press" || event.type === "release") {
            const authored = event.songTime + offset;
            expect(authored).toBeGreaterThanOrEqual(lastAuthoredEdge);
            expect(previous?.type).toBe("advance");
            expect(previous?.songTime).toBeCloseTo(authored, 10);
            lastAuthoredEdge = authored;
            if (event.type === "press") {
              expect(activeSources.has(event.source)).toBe(false);
              activeSources.add(event.source);
            } else {
              expect(activeSources.delete(event.source)).toBe(true);
              const note = core.notes.find((note) => note.id === event.source - 1)!;
              if (note.kind === "hold") {
                expect(note.holding).toBe(false); // advance finished the tail BEFORE release.
                expect(core.successfulHoldIds.has(note.id)).toBe(true);
              }
            }
            edges.push(event);
          }
          const result = core.process({ ...event, sequence: 0 });
          if (event.type === "press") expect(result).toBe("PERFECT");
          previous = event;
          return result;
        };
        const horizons = dropped
          ? [bot.endTime + 1]
          : [
              ...new Set([
                -1,
                ...notes.flatMap((note) => [
                  note.beat - 0.001,
                  note.beat,
                  note.beat + 0.001,
                  ...(note.kind === "hold"
                    ? [
                        note.beat + note.lengthBeats! - 0.001,
                        note.beat + note.lengthBeats!,
                        note.beat + note.lengthBeats! + 0.001,
                      ]
                    : []),
                ]),
                bot.endTime + 1,
              ]),
            ].sort((a, b) => a - b);
        for (const horizon of horizons) {
          bot.advance(horizon - offset, emit);
          assertState(core, horizon);
          for (const note of core.notes.filter((note) => note.holding))
            expect(bot.activeLanes(horizon - offset).has(note.lane)).toBe(true);
        }
        expect(core.play.counts).toEqual({ PERFECT: notes.length, GREAT: 0, GOOD: 0, MISS: 0 });
        expect(core.notes.every((note) => note.judged && !note.holding)).toBe(true);
        expect(core.hitHeadIds.size).toBe(notes.length);
        expect(core.play.timingErrorsMs.every((delta) => Math.abs(delta) < 1e-9)).toBe(true);
        expect(edges).toHaveLength(notes.length * 2);
        expect(activeSources.size).toBe(0);
        expect(bot.activeLanes(bot.endTime + 1 - offset).size).toBe(0);
        const snapshot = core.snapshotPlay();
        bot.advance(bot.endTime + 2 - offset, emit);
        core.process({
          type: "complete",
          songTime: bot.endTime + 2,
          clockTime: bot.endTime + 2,
          elapsedMs: 0,
          sequence: 0,
        });
        expect(core.snapshotPlay()).toEqual(snapshot);
        assertState(core, bot.endTime + 2);
        expect(edges).toHaveLength(notes.length * 2);
        return snapshot;
      };
      const fine = run(false, false);
      expect(run(true, false)).toEqual(fine);
      // Author order at equal times must not change score, cleanup or tail outcomes.
      expect(run(false, true)).toEqual(fine);
      expect(run(true, true)).toEqual(fine);
    });
  });

  it.each(["release", "cancel"] as const)(
    "%s of one source preserves the other hold until advance completes it",
    (type) => {
      const chart = makeChart([hold(1, 6), hold(2, 3), tap(3.5)]);
      const core = new GameplayCore(
        chart,
        createRunConfiguration(chart, { autoplay: true, playStyle }),
      );
      const bot = new Botplay(core);
      const emit = (event: GameplayEventInput) => core.process({ ...event, sequence: 0 });
      bot.advance(2, emit);
      assertState(core, 2);
      // Explicitly exercise early-return, with the second tail already completed by advance.
      emit({ type: "advance", songTime: 3, clockTime: 3, elapsedMs: 0 });
      emit({ type, source: 2, lane: 0, songTime: 3, clockTime: 3, elapsedMs: 0 });
      assertState(core, 3);
      expect(bot.activeLanes(3).has(0)).toBe(true);
      bot.advance(3.5, emit); // Scheduled release of source 2 is harmless after explicit release/cancel.
      assertState(core, 3.5);
      bot.advance(7, emit);
      assertState(core, 7);
      expect(core.play.counts).toEqual({ PERFECT: 3, GREAT: 0, GOOD: 0, MISS: 0 });
      expect(bot.activeLanes(7).size).toBe(0);
    },
  );
});

describe.each(["fnf", "mania"] as const)("%s remaining-source semantics", (playStyle) => {
  it.each(["release", "cancel"] as const)(
    "early %s retains lane holds until remaining source reaches both tails",
    (type) => {
      const chart = makeChart([hold(1, 6), hold(2, 3)]);
      const core = new GameplayCore(
        chart,
        createRunConfiguration(chart, { autoplay: true, playStyle }),
      );
      const emit = (event: GameplayEventInput) => core.process({ ...event, sequence: 0 });
      const bot = new Botplay(core);
      bot.advance(2, emit);
      emit({ type, source: 2, lane: 0, songTime: 2.5, clockTime: 2.5, elapsedMs: 0 });
      expect([...core.sources]).toEqual([[1, 0]]);
      expect(internals(core).heldNotes.size).toBe(2);
      expect(internals(core).holdStartedAt.size).toBe(2);
      expect(core.heldIntervals).toHaveLength(0);
      expect(core.play.counts.MISS).toBe(0);
      expect(bot.activeLanes(2.5).has(0)).toBe(true);
      bot.advance(3, emit);
      assertState(core, 3);
      bot.advance(6, emit);
      assertState(core, 6);
      expect(core.play.counts).toEqual({ PERFECT: 2, GREAT: 0, GOOD: 0, MISS: 0 });
      expect(bot.activeLanes(6).size).toBe(0);
    },
  );
  it.each(["release", "cancel"] as const)(
    "early final-source %s still fails the hold and cleans both private maps",
    (type) => {
      const chart = makeChart([hold(1, 6)]);
      const core = new GameplayCore(
        chart,
        createRunConfiguration(chart, { autoplay: true, playStyle }),
      );
      core.process({
        type: "press",
        source: 1,
        lane: 0,
        songTime: 1,
        clockTime: 1,
        elapsedMs: 0,
        sequence: 1,
      });
      core.process({
        type,
        source: 1,
        lane: 0,
        songTime: 2,
        clockTime: 2,
        elapsedMs: 1000,
        sequence: 2,
      });
      expect(core.play.counts.MISS).toBe(1); // A negative control, not a valid BOT run.
      expect(core.sources.size).toBe(0);
      expect(internals(core).heldNotes.size).toBe(0);
      expect(internals(core).holdStartedAt.size).toBe(0);
      expect(core.successfulHoldIds.size).toBe(0);
      expect(core.heldIntervals).toEqual([
        { noteId: 0, startedAt: 1, endedAt: 2, completed: false },
      ]);
    },
  );
});

describe.each(["fnf", "mania"] as const)("%s paused private hold state", (playStyle) => {
  it.each([-500, 0, 500])(
    "offset %d ms: pause and countdown preserve sources/start times, resume drains every tail once",
    (timingOffsetMs) => {
      const chart = makeChart([hold(0, 8), hold(1, 4), hold(2, 3), tap(3), tap(3), hold(3, 6)]);
      const core = new GameplayCore(
        chart,
        createRunConfiguration(chart, { autoplay: true, playStyle, timingOffsetMs }),
      );
      const bot = new Botplay(core);
      const emit = (event: GameplayEventInput) => core.process({ ...event, sequence: 0 });
      const offset = timingOffsetMs / 1000;
      bot.advance(2.5 - offset, emit);
      assertState(core, 2.5);
      const frozen = core.snapshotPlay();
      emit({ type: "pause", songTime: 2.5 - offset, clockTime: 2.5 - offset, elapsedMs: 0 });
      emit({ type: "advance", songTime: 100, clockTime: 100, elapsedMs: 100000 });
      assertState(core, 2.5);
      expect(core.snapshotPlay()).toEqual(frozen);
      emit({ type: "resume", songTime: 2.5 - offset, clockTime: 1.75 - offset, elapsedMs: 100000 });
      bot.advance(1.75 - offset, emit);
      assertState(core, 2.5);
      expect(core.snapshotPlay()).toEqual(frozen);
      bot.advance(9 - offset, emit);
      assertState(core, 9);
      expect(core.play.counts).toEqual({ PERFECT: chart.notes.length, GREAT: 0, GOOD: 0, MISS: 0 });
      const done = core.snapshotPlay();
      bot.advance(20, emit);
      expect(core.snapshotPlay()).toEqual(done);
      assertState(core, 9);
    },
  );
});
