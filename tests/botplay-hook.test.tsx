import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { useRhythmGame } from "@/game/useRhythmGame";
import type { Chart } from "@/game/types";
const clock = vi.hoisted(() => ({ time: 0 }));
vi.mock("@/game/audio", () => ({
  AudioClock: class {
    duration = 5;
    async load() {}
    async start() {}
    dispose() {}
    now() {
      return clock.time;
    }
    nowAt() {
      return clock.time;
    }
    async pause() {
      return clock.time;
    }
    async resume() {}
  },
}));
let frame: FrameRequestCallback | undefined;
const chart: Chart = {
  id: "bot",
  title: "",
  artist: "",
  audioUrl: "/audio",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "",
  notes: [
    { beat: 1, lane: 0, kind: "hold", lengthBeats: 2 },
    { beat: 2, lane: 1, kind: "tap" },
  ],
};
beforeEach(() => {
  clock.time = 0;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frame = f;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const tick = (time: number) => {
  clock.time = time;
  act(() => frame?.(0));
};
it("locks BOT settings, rejects manual edges, pauses holds, retries, then restores manual input", async () => {
  const hook = renderHook(({ autoplay }) => useRhythmGame(chart, { autoplay }), {
    initialProps: { autoplay: true },
  });
  await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  await act(() => hook.result.current.start());
  hook.rerender({ autoplay: false });
  clock.time = 0.85;
  act(() => {
    hook.result.current.pressLane(0);
    hook.result.current.releaseLane(0);
    fireEvent.keyDown(window, { code: "KeyD" });
    fireEvent.keyUp(window, { code: "KeyD" });
  });
  expect(hook.result.current.play.score).toBe(0);
  expect(hook.result.current.inputs.bars).toHaveLength(0);
  tick(1);
  expect(hook.result.current.notes[0]!.holding).toBe(true);
  expect(hook.result.current.activeLanes.has(0)).toBe(true);
  await act(() => hook.result.current.pause());
  const before = structuredClone(hook.result.current.play);
  tick(10);
  expect(hook.result.current.play).toEqual(before);
  expect(hook.result.current.status).toBe("paused");
  clock.time = 1;
  await act(() => hook.result.current.resume());
  tick(3.1);
  expect(hook.result.current.play.counts).toEqual({ PERFECT: 2, GREAT: 0, GOOD: 0, MISS: 0 });
  tick(6);
  expect(hook.result.current.completedReplay).toBeNull();
  expect(hook.result.current.completedPlay?.configuration?.autoplay).toBe(true);
  expect(hook.result.current.completedPlay?.competitive).toBe(false);
  await act(() => hook.result.current.start()); // next run uses the now-OFF selection
  clock.time = 1;
  act(() => hook.result.current.pressLane(0));
  expect(hook.result.current.play.counts.PERFECT).toBe(1);
  tick(3);
  tick(6);
  expect(hook.result.current.completedPlay?.competitive).toBe(true);
  expect(hook.result.current.completedReplay?.events.some((e) => e.type === "press")).toBe(true);
});
