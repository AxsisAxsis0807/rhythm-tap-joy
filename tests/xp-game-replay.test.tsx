import React, { StrictMode } from "react";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { useRhythmGame } from "@/game/useRhythmGame";
import { chartRevision, verifyReplay } from "@/game/replay";
import type { Chart } from "@/game/types";
const audio = vi.hoisted(() => ({ time: -1.5, elapsed: 10000, step: 0 }));
vi.mock("@/game/audio", () => ({
  AudioClock: class {
    duration = 4;
    async load() {}
    async start() {
      audio.time = -1.5;
    }
    now() {
      return audio.time;
    }
    nowAt() {
      const time = audio.time;
      audio.time += audio.step;
      return time;
    }
    async pause() {
      return audio.time;
    }
    async resume(position: number) {
      audio.time = position - 0.75;
    }
    dispose() {}
  },
}));
let frame: FrameRequestCallback | undefined;
const base: Chart = {
  id: "live-game",
  title: "",
  artist: "",
  audioUrl: "/audio",
  difficultyName: "",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  notes: [
    { beat: 1, lane: 0, kind: "hold", lengthBeats: 1 },
    ...Array.from({ length: 3 }, (_, i) => ({ beat: 1, lane: i + 1, kind: "tap" as const })),
    ...Array.from({ length: 10 }, (_, i) => ({
      beat: 1.08 + i * 0.02,
      lane: 1,
      kind: "tap" as const,
    })),
    { beat: 2, lane: 3, kind: "tap" },
  ],
};
beforeEach(() => {
  audio.elapsed = 10000;
  audio.step = 0;
  vi.spyOn(performance, "now").mockImplementation(() => audio.elapsed);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frame = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function time(raw: number) {
  audio.time = raw;
  audio.elapsed = 10000 + (raw + 1.5) * 1000;
}
function tick(raw: number) {
  time(raw);
  act(() => frame?.(audio.elapsed));
}
it.each(["mania", "left", "right"])(
  "real %s hook records a replay matching the completed score through chords, quick taps, misses and RETRY",
  async (side) => {
    const chart =
      side === "mania"
        ? base
        : {
            ...base,
            fnf: { playerSide: side as "left" | "right", left: base.notes, right: base.notes },
          };
    const { result, rerender } = renderHook(() => useRhythmGame(chart, { timingOffsetMs: 50 }), {
      wrapper: StrictMode,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() =>
      result.current.start({
        id: crypto.randomUUID(),
        verification: { sessionId: crypto.randomUUID() },
      }),
    );
    tick(0.95);
    act(() => {
      for (let lane = 0; lane < 4; lane++) result.current.pressLane(lane, `touch:${lane}`);
    });
    act(() => {
      for (let lane = 1; lane < 4; lane++) result.current.releaseLane(lane, `touch:${lane}`);
    });
    for (let i = 0; i < 10; i++) {
      time(1.03 + i * 0.02);
      act(() => {
        result.current.pressLane(1, `key:${i}`);
        result.current.releaseLane(1, `key:${i}`);
      });
    }
    time(1.4);
    act(() => result.current.releaseLane(0, "touch:0", undefined, true));
    tick(5);
    const done = result.current.completedPlay!,
      snapshot = JSON.stringify(done.verification);
    const verified = verifyReplay(chartRevision(chart), 4, 50, done.verification!.replay);
    expect(verified.score).toBe(String(done.play.score));
    expect(verified.maxCombo).toBe(String(done.play.maxCombo));
    for (const [count, field] of [
      ["PERFECT", "perfect"],
      ["GREAT", "great"],
      ["GOOD", "good"],
      ["MISS", "miss"],
    ] as const)
      expect(verified[field]).toBe(String(done.play.counts[count]));
    rerender();
    await act(() =>
      result.current.start({
        id: crypto.randomUUID(),
        verification: { sessionId: crypto.randomUUID() },
      }),
    );
    expect(JSON.stringify(done.verification)).toBe(snapshot);
    tick(5);
    expect(result.current.completedPlay!.id).not.toBe(done.id);
  },
);
it("actual pause and resume traces preserve clear penalties and are accepted without changing gameplay", async () => {
  const { result } = renderHook(() => useRhythmGame(base));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(() =>
    result.current.start({
      id: crypto.randomUUID(),
      verification: { sessionId: crypto.randomUUID() },
    }),
  );
  tick(1);
  act(() => result.current.pressLane(0));
  await act(() => result.current.pause());
  audio.elapsed += 2000;
  await act(() => result.current.resume());
  audio.elapsed += 4750;
  audio.time = 5;
  act(() => frame?.(audio.elapsed));
  const completed = result.current.completedPlay!;
  expect(verifyReplay(chartRevision(base), 4, 0, completed.verification!.replay).score).toBe(
    String(completed.play.score),
  );
});

it("legitimate calibration edits preserve existing judgments and replay verification", async () => {
  const { result, rerender } = renderHook(
    ({ offset }) => useRhythmGame(base, { timingOffsetMs: offset }),
    { initialProps: { offset: 0 } },
  );
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(() =>
    result.current.start({
      id: crypto.randomUUID(),
      verification: { sessionId: crypto.randomUUID() },
    }),
  );
  tick(1);
  act(() => {
    result.current.pressLane(1);
    result.current.releaseLane(1);
  });
  rerender({ offset: 50 });
  time(1.03);
  act(() => {
    result.current.pressLane(1);
    result.current.releaseLane(1);
  });
  tick(5);
  const done = result.current.completedPlay!;
  expect(done.verification!.replay.events.some((e) => e.kind === "calibration")).toBe(true);
  expect(verifyReplay(chartRevision(base), 4, 0, done.verification!.replay).score).toBe(
    String(done.play.score),
  );
});

it("replay and judgement use one audio-clock sample at a timing-window boundary", async () => {
  const chart = { ...base, notes: [{ beat: 1, lane: 1, kind: "tap" as const }] };
  const { result } = renderHook(() => useRhythmGame(chart));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(() =>
    result.current.start({
      id: crypto.randomUUID(),
      verification: { sessionId: crypto.randomUUID() },
    }),
  );
  time(1.044);
  audio.step = 0.02;
  act(() => result.current.pressLane(1));
  tick(5);
  const done = result.current.completedPlay!;
  expect(done.play.counts.PERFECT).toBe(1);
  expect(verifyReplay(chartRevision(chart), 4, 0, done.verification!.replay).score).toBe(
    String(done.play.score),
  );
});
