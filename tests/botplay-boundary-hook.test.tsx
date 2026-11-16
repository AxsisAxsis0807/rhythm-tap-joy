import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { useRhythmGame } from "@/game/useRhythmGame";
import type { Chart } from "@/game/types";

const clock = vi.hoisted(() => ({ time: 0, pause: vi.fn(), resume: vi.fn() }));
vi.mock("@/game/audio", () => ({
  AudioClock: class {
    duration = 5;
    async load() {}
    async start() {
      clock.time = -1.5;
    }
    dispose() {}
    now() {
      return clock.time;
    }
    nowAt() {
      return clock.time;
    }
    async pause() {
      clock.pause(clock.time);
      return clock.time;
    }
    async resume(position: number, delay: number) {
      clock.resume(position, delay);
      clock.time = position - delay; // Same song-time countdown as AudioClock.resume.
    }
  },
}));
let frame: FrameRequestCallback | undefined;
const chart: Chart = {
  id: "boundary-hook",
  title: "",
  artist: "",
  audioUrl: "/audio",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "TEST",
  notes: [
    { beat: 0, lane: 0, kind: "hold", lengthBeats: 12 },
    { beat: 1, lane: 0, kind: "hold", lengthBeats: 4 },
    { beat: 2, lane: 0, kind: "tap" },
    { beat: 2, lane: 0, kind: "tap" },
    ...[0, 1, 2, 3].map((lane) => ({ beat: 2, lane, kind: "tap" as const })),
    { beat: 3, lane: 3, kind: "hold", lengthBeats: 11 }, // Tail at 14, audio ends at 5.
  ],
};
beforeEach(() => {
  clock.time = 0;
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
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

it.each(
  (["fnf", "mania"] as const).flatMap((playStyle) =>
    [-500, 0, 500].map((timingOffsetMs) => ({ playStyle, timingOffsetMs })),
  ),
)(
  "$playStyle / $timingOffsetMs ms: pause/resume burst, final tail beyond audio, retry and return to manual",
  async ({ playStyle, timingOffsetMs }) => {
    const offset = timingOffsetMs / 1000;
    const hook = renderHook(
      ({ autoplay }) => useRhythmGame(chart, { autoplay, playStyle, timingOffsetMs }),
      {
        initialProps: { autoplay: true },
      },
    );
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    await act(() => hook.result.current.start());
    tick(1.5 - offset);
    expect(hook.result.current.play.counts.PERFECT).toBe(2);
    expect(hook.result.current.notes.filter((note) => note.holding)).toHaveLength(2);
    expect(hook.result.current.activeLanes.has(0)).toBe(true);
    act(() => {
      hook.result.current.pressLane(0);
      hook.result.current.releaseLane(0, undefined, undefined, true);
      fireEvent.keyDown(window, { code: "KeyD" });
      fireEvent.keyUp(window, { code: "KeyD" });
    });
    expect(hook.result.current.inputs.bars).toHaveLength(0);
    const oldFrame = frame;
    await act(() => hook.result.current.pause());
    expect(clock.pause).toHaveBeenLastCalledWith(1.5 - offset);
    const frozenPlay = structuredClone(hook.result.current.play);
    const frozenNotes = structuredClone(hook.result.current.notes);
    clock.time = 100;
    act(() => oldFrame?.(0)); // Even an already-queued frame cannot progress a paused run.
    expect(hook.result.current.status).toBe("paused");
    expect(hook.result.current.play).toEqual(frozenPlay);
    expect(hook.result.current.notes).toEqual(frozenNotes);
    expect(hook.result.current.activeLanes.has(0)).toBe(true);
    await act(() => hook.result.current.resume());
    expect(clock.resume).toHaveBeenLastCalledWith(1.5 - offset, 0.75);
    tick(1 - offset); // Resume countdown rewinds AudioClock, never the BOT cursor.
    expect(hook.result.current.play).toEqual(frozenPlay);
    tick(2.25 - offset); // Six simultaneous heads in the first frame past their time.
    expect(hook.result.current.play.counts.PERFECT).toBe(8);
    expect(hook.result.current.play.counts.MISS).toBe(0);
    tick(8); // Audio ended long ago, but both long tails still need processing.
    expect(hook.result.current.status).toBe("playing");
    expect(hook.result.current.notes.at(-1)?.holding).toBe(true);
    expect(hook.result.current.completedPlay).toBeNull();
    tick(14 - offset);
    expect(hook.result.current.notes.every((note) => note.judged && !note.holding)).toBe(true);
    expect(hook.result.current.activeLanes.size).toBe(0);
    const finishBoundary = 14 - offset + 2.5;
    tick(finishBoundary);
    expect(hook.result.current.status).toBe("playing"); // Existing completion uses strict >.
    tick(finishBoundary + 0.001);
    expect(hook.result.current.status).toBe("finished");
    expect(hook.result.current.play.counts).toEqual({
      PERFECT: chart.notes.length,
      GREAT: 0,
      GOOD: 0,
      MISS: 0,
    });
    expect(hook.result.current.completedPlay?.competitive).toBe(false);
    expect(hook.result.current.completedReplay).toBeNull();
    await act(() => hook.result.current.start()); // BOT RETRY has a fresh cursor and sources.
    expect(hook.result.current.runConfiguration?.autoplay).toBe(true);
    expect(hook.result.current.play.score).toBe(0);
    tick(30); // Whole-chart dropped frame, including the tail beyond the audio duration.
    expect(hook.result.current.play.counts).toEqual({
      PERFECT: chart.notes.length,
      GREAT: 0,
      GOOD: 0,
      MISS: 0,
    });
    expect(hook.result.current.notes.every((note) => note.judged && !note.holding)).toBe(true);
    expect(hook.result.current.activeLanes.size).toBe(0);
    hook.rerender({ autoplay: false });
    await act(() => hook.result.current.start());
    expect(hook.result.current.runConfiguration).toMatchObject({
      autoplay: false,
      competitive: true,
      playStyle,
    });
    clock.time = -offset;
    act(() => fireEvent.keyDown(window, { code: "KeyD" }));
    expect(hook.result.current.play.counts.PERFECT).toBe(1);
    tick(1.5 - offset);
    // Unpressed manual notes may auto-MISS; they must never become automatic hits.
    expect(hook.result.current.play.counts.PERFECT).toBe(1);
    expect(hook.result.current.notes[1]!.judgement).not.toBe("PERFECT");
    clock.time = 12 - offset;
    act(() => fireEvent.keyUp(window, { code: "KeyD" }));
    tick(30);
    expect(hook.result.current.completedPlay?.competitive).toBe(true);
    expect(hook.result.current.completedReplay?.configuration.autoplay).toBe(false);
    expect(
      hook.result.current.completedReplay?.events.some((event) => event.type === "press"),
    ).toBe(true);
    hook.unmount();
  },
);
