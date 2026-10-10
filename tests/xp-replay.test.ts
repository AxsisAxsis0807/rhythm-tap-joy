import { expect, it } from "vitest";
import { chartRevision, verifyReplay, type PlayReplay, type ReplayEvent } from "@/game/replay";
import type { Chart } from "@/game/types";
const chart: Chart = {
  id: "verified",
  title: "",
  artist: "",
  audioUrl: "/audio",
  difficultyName: "",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  notes: [0, 1, 2, 3].map((lane) => ({ beat: 1, lane, kind: "tap" })),
};
const edge = (
  kind: ReplayEvent["kind"],
  time: number,
  extra: Partial<ReplayEvent> = {},
): ReplayEvent => ({ kind, time, elapsedMs: (time + 1.5) * 1000, ...extra });
const complete: ReplayEvent = edge("tick", 4);
function chord(): PlayReplay {
  return {
    version: 1,
    events: [
      ...chart.notes.map((n) => edge("press", 1, { source: `touch:${n.lane}`, lane: n.lane })),
      complete,
    ],
  };
}
it("accepts four simultaneous independent touch sources and ignores opponent notes", () => {
  const revision = chartRevision({
    ...chart,
    fnf: { playerSide: "right", left: [{ beat: 0.5, lane: 0, kind: "tap" }], right: chart.notes },
  });
  const result = verifyReplay(revision, 2, 0, chord());
  expect(result.score).toBe("4020");
  expect(result.perfect).toBe("4");
  expect(result.miss).toBe("0");
});
it("supports fast input, multiple sources in one lane and calibration without speed penalties", () => {
  const selected = {
    ...chart,
    notes: Array.from({ length: 200 }, (_, i) => ({
      beat: 1 + i * 0.02,
      lane: i % 4,
      kind: "tap" as const,
    })),
  };
  const events = selected.notes.flatMap((n, i) => [
    edge("press", n.beat - 0.05, { source: `key:${i}`, lane: n.lane }),
    edge("release", n.beat - 0.049, { source: `key:${i}` }),
  ]);
  events.push(edge("tick", 8));
  const result = verifyReplay(chartRevision(selected), 6, 50, { version: 1, events });
  expect(result.perfect).toBe("200");
  expect(result.maxCombo).toBe("200");
});
it("matches holds, early/cancelled release, frames, missed notes, duplicate source and nearest-note rules", () => {
  const selected = {
    ...chart,
    notes: [
      { beat: 1, lane: 0, kind: "hold" as const, lengthBeats: 1 },
      { beat: 1.5, lane: 2, kind: "tap" as const },
    ],
  };
  const events = [
    edge("press", 1, { source: "key:D", lane: 0 }),
    edge("press", 1.1, { source: "touch:0", lane: 0 }),
    edge("release", 1.2, { source: "key:D" }),
    edge("release", 1.3, { source: "touch:0", cancelled: true }),
    edge("tick", 4.5),
  ];
  const result = verifyReplay(chartRevision(selected), 3, 0, { version: 1, events });
  expect(result).toMatchObject({ score: "1002", perfect: "1", miss: "2", maxCombo: "1" });
  expect(() =>
    verifyReplay(chartRevision(selected), 3, 0, {
      version: 1,
      events: [events[0]!, events[0]!, ...events.slice(1)],
    }),
  ).toThrow("replay_source");
});
it("rejects missing completion, clock jumps, out-of-order records, extra completion input and invalid lanes", () => {
  const revision = chartRevision(chart);
  expect(() =>
    verifyReplay(revision, 2, 0, { ...chord(), events: chord().events.slice(0, 4) }),
  ).toThrow("replay_incomplete");
  expect(() =>
    verifyReplay(revision, 2, 0, {
      version: 1,
      events: [edge("press", 1, { elapsedMs: 0, source: "k", lane: 0 }), complete],
    }),
  ).toThrow("replay_clock");
  expect(() =>
    verifyReplay(revision, 2, 0, { version: 1, events: [complete, ...chord().events] }),
  ).toThrow("replay_order");
  expect(() =>
    verifyReplay(revision, 2, 0, {
      version: 1,
      events: [edge("press", 1, { source: "k", lane: 4 }), complete],
    }),
  ).toThrow();
});
it("supports pauses/resume lead-in and uses the existing clear-input hold penalty", () => {
  const selected = {
    ...chart,
    notes: [{ beat: 1, lane: 0, kind: "hold" as const, lengthBeats: 1 }],
  };
  const events = [
    edge("tick", 1),
    edge("press", 1, { source: "k", lane: 0 }),
    edge("clear", 1),
    edge("pause", 1),
    edge("resume", 0.25, { elapsedMs: 6000 }),
    edge("tick", 4, { elapsedMs: 9750 }),
  ];
  expect(verifyReplay(chartRevision(selected), 3, 0, { version: 1, events })).toMatchObject({
    score: "1002",
    perfect: "1",
    miss: "1",
  });
});
it("binds both FNF sides in the revision and rejects inconsistent selected-side data", () => {
  const revision = chartRevision({
    ...chart,
    fnf: { playerSide: "left", left: [{ beat: 1, lane: 0, kind: "tap" }], right: chart.notes },
  });
  expect(() => verifyReplay(revision, 2, 0, chord())).toThrow("revision_side");
});
