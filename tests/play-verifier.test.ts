import { it, expect } from "vitest";
import { verifyReplay } from "@/lib/playVerifier";
import { ReplayRecorder } from "@/game/replay";
import { createRunConfiguration } from "@/game/runConfiguration";
import type { Chart } from "@/game/types";
const chart: Chart = {
  id: "00000000-0000-4000-8000-000000000001",
  revisionId: "00000000-0000-4000-8000-000000000002",
  audioUrl: "",
  title: "x",
  artist: "x",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "normal",
  notes: Array.from({ length: 20 }, (_, i) => ({ beat: 2 + i * 3, lane: i % 4, kind: "tap" })),
};
function replay() {
  const recorder = new ReplayRecorder(
    "00000000-0000-4000-8000-000000000003",
    createRunConfiguration(chart),
  );
  for (const n of chart.notes) {
    recorder.append({
      type: "advance",
      songTime: n.beat,
      clockTime: n.beat,
      elapsedMs: (n.beat + 1.5) * 1000,
    });
    recorder.append({
      type: "press",
      lane: n.lane,
      source: 1,
      songTime: n.beat,
      clockTime: n.beat,
      elapsedMs: (n.beat + 1.5) * 1000,
    });
    recorder.append({
      type: "release",
      lane: n.lane,
      source: 1,
      songTime: n.beat + 0.01,
      clockTime: n.beat + 0.01,
      elapsedMs: (n.beat + 1.51) * 1000,
    });
  }
  recorder.append({ type: "advance", songTime: 62, clockTime: 62, elapsedMs: 63500 });
  recorder.append({ type: "complete", songTime: 62, clockTime: 62, elapsedMs: 63500 });
  return recorder.snapshot();
}
it("verifies deterministic input and union activity without trusting client score", () => {
  const r = verifyReplay(chart, 60000, replay(), 64000);
  expect(r.eligible).toBe(true);
  expect(r.successfulHeads).toBe(20);
  expect(r.countedMs).toBe(60000);
  expect(r.play.counts.PERFECT).toBe(20);
});
it("rejects clock skipping, incomplete logs, configuration changes and modified source sequences", () => {
  const evidence = replay();
  expect(() => verifyReplay(chart, 60000, evidence, 1000)).toThrow(/time/);
  expect(() =>
    verifyReplay(chart, 60000, { ...evidence, events: evidence.events.slice(0, -1) }, 64000),
  ).toThrow(/incomplete/);
  expect(() =>
    verifyReplay(
      chart,
      60000,
      { ...evidence, configuration: { ...evidence.configuration, rate: 2 } },
      64000,
    ),
  ).toThrow(/configuration/);
  expect(() =>
    verifyReplay(
      chart,
      60000,
      {
        ...evidence,
        events: evidence.events.map((e, i) => (i === 1 ? { ...e, sequence: 99 } : e)),
      },
      64000,
    ),
  ).toThrow(/sequence/);
});
it("pause elapsed time never inflates song participation", () => {
  const e = replay();
  const events = e.events
    .flatMap((event, i) =>
      i === 3
        ? [
            {
              type: "pause" as const,
              songTime: 2.01,
              clockTime: 2.01,
              elapsedMs: 3510,
              sequence: 0,
            },
            {
              type: "resume" as const,
              songTime: 2.01,
              clockTime: 2.01,
              elapsedMs: 13510,
              sequence: 0,
            },
            { ...event, elapsedMs: event.elapsedMs + 10000 },
          ]
        : [{ ...event, elapsedMs: event.elapsedMs + (i > 3 ? 10000 : 0) }],
    )
    .map((event, i) => ({ ...event, sequence: i + 1 }));
  expect(verifyReplay(chart, 60000, { ...e, events }, 74000).countedMs).toBe(60000);
});
