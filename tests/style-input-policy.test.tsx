import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { useRhythmGame } from "@/game/useRhythmGame";
import { findHittableNote, buildRuntimeNotes } from "@/game/engine";
import { DEFAULT_WINDOWS } from "@/game/config";
import { TouchInput } from "@/components/game/TouchInput";
import { InputOverlay } from "@/components/game/InputOverlay";
import { DEFAULT_SETTINGS } from "@/game/settings";
import type { Chart } from "@/game/types";
const clock = vi.hoisted(() => ({ time: 0, hit: vi.fn() }));
vi.mock("@/game/audio", () => ({
  AudioClock: class {
    duration = 6;
    async load() {}
    async start() {}
    now() {
      return clock.time;
    }
    nowAt() {
      return clock.time;
    }
    playHit = clock.hit;
    async pause() {
      return clock.time;
    }
    async resume() {}
    dispose() {}
  },
}));
let frame: FrameRequestCallback | undefined;
const chart: Chart = {
  id: "policy",
  title: "policy",
  artist: "",
  audioUrl: "/audio",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "TEST",
  notes: [
    { beat: 0.5, lane: 3, kind: "tap" },
    { beat: 1, lane: 0, kind: "tap" },
  ],
};
beforeEach(() => {
  clock.time = 0;
  clock.hit.mockClear();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frame = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function game(selected = chart, style: "mania" | "fnf" = "fnf") {
  const hook = renderHook(
    ({ playStyle }) => useRhythmGame(selected, { playStyle, hitSoundVolume: 1 }),
    { initialProps: { playStyle: style } },
  );
  await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  await act(() => hook.result.current.start());
  return hook;
}
function source(hook: Awaited<ReturnType<typeof game>>, kind: "keyboard" | "touch") {
  const codes = ["KeyD", "KeyF", "KeyJ", "KeyK"];
  if (kind === "keyboard")
    return {
      down: (lane: number) => fireEvent.keyDown(window, { code: codes[lane] }),
      up: (lane: number) => fireEvent.keyUp(window, { code: codes[lane] }),
    };
  const { getByTestId } = render(
    <TouchInput
      onPress={(lane, id, stamp) => hook.result.current.pressLane(lane, id, stamp)}
      onRelease={(id, stamp, cancel) => hook.result.current.releaseLane(0, id, stamp, cancel)}
    />,
  );
  const surface = getByTestId("touch-input");
  surface.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect;
  function edge(type: string, lane: number) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: lane + 1, pointerType: "touch", clientX: lane * 100 + 50 });
    fireEvent(surface, e);
  }
  return {
    down: (lane: number) => edge("pointerdown", lane),
    up: (lane: number) => edge("pointerup", lane),
  };
}
it.each(["keyboard", "touch"] as const)(
  "FNF ignores early %s without penalties, still visualizes it, and allows the SAME note after release",
  async (kind) => {
    const hook = await game(),
      input = source(hook, kind);
    clock.time = 0.5;
    act(() => {
      input.down(3);
      input.up(3);
    });
    const before = structuredClone(hook.result.current.play);
    clock.hit.mockClear();
    clock.time = 0.85;
    act(() => input.down(0));
    expect(hook.result.current.play).toEqual(before);
    expect(hook.result.current.notes[1]!.judged).toBe(false);
    expect(hook.result.current.inputs.bars.at(-1)!.outcome).toBe("outside-window");
    expect(hook.result.current.activeLanes.has(0)).toBe(true);
    expect(clock.hit).not.toHaveBeenCalled();
    const overlay = render(
      <InputOverlay inputs={hook.result.current.inputs} settings={DEFAULT_SETTINGS} />,
    );
    expect(
      overlay.getByTestId("input-overlay").querySelectorAll("i[data-source]").length,
    ).toBeGreaterThan(0);
    overlay.unmount();
    clock.time = 1;
    act(() => {
      input.up(0);
      input.down(0);
    });
    expect(hook.result.current.play.counts.PERFECT).toBe(2);
    expect(hook.result.current.play.combo).toBe(2);
    expect(hook.result.current.play.counts.MISS).toBe(0);
  },
);
it.each(["keyboard", "touch"] as const)(
  "mania retains the existing early-MISS band for %s",
  async (kind) => {
    const hook = await game(chart, "mania"),
      input = source(hook, kind);
    clock.time = 0.5;
    act(() => {
      input.down(3);
      input.up(3);
    });
    clock.time = 0.85;
    act(() => input.down(0));
    expect(hook.result.current.play.counts).toEqual({ PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 1 });
    expect(hook.result.current.play.combo).toBe(0);
    expect(hook.result.current.notes[1]!.judged).toBe(true);
    expect(hook.result.current.play.lastJudgement!.judgement).toBe("MISS");
  },
);
it("FNF holding an early key is never buffered; unhit notes still auto-miss", async () => {
  const selected = { ...chart, notes: [{ beat: 1, lane: 0, kind: "tap" as const }] };
  const hook = await game(selected),
    input = source(hook, "keyboard");
  clock.time = 0.85;
  act(() => input.down(0));
  clock.time = 1;
  act(() => frame?.(0));
  expect(hook.result.current.play.score).toBe(0);
  expect(hook.result.current.notes[0]!.judged).toBe(false);
  clock.time = 1.201;
  act(() => frame?.(0));
  expect(hook.result.current.play.counts.MISS).toBe(1);
  expect(hook.result.current.notes[0]!.judged).toBe(true);
});
it("FNF filters early future notes before choosing among valid same-lane candidates; late MISS remains", () => {
  const selected = {
      ...chart,
      notes: [
        { beat: 0.81, lane: 0, kind: "tap" as const },
        { beat: 1.15, lane: 0, kind: "tap" as const },
      ],
    },
    notes = buildRuntimeNotes(selected);
  expect(findHittableNote(notes, 0, 1, DEFAULT_WINDOWS)?.id).toBe(1);
  expect(findHittableNote(notes, 0, 1, DEFAULT_WINDOWS, "pulse-fnf-v1")?.id).toBe(0);
});
it.each(["keyboard", "touch"] as const)(
  "FNF long-note head ignores early %s, then preserves successful hold/tail and other-lane inputs",
  async (kind) => {
    const selected = {
      ...chart,
      notes: [
        { beat: 1, lane: 0, kind: "hold" as const, lengthBeats: 1 },
        { beat: 1.5, lane: 1, kind: "tap" as const },
      ],
    };
    const hook = await game(selected),
      input = source(hook, kind);
    clock.time = 0.85;
    act(() => {
      input.down(0);
      input.up(0);
    });
    expect(hook.result.current.play.counts.MISS).toBe(0);
    clock.time = 1;
    act(() => input.down(0));
    expect(hook.result.current.notes[0]!.holding).toBe(true);
    clock.time = 1.5;
    act(() => {
      input.down(1);
      input.up(1);
    });
    clock.time = 2;
    act(() => frame?.(0));
    act(() => input.up(0));
    expect(hook.result.current.play.counts.PERFECT).toBe(2);
    expect(hook.result.current.play.counts.MISS).toBe(0);
  },
);
it.each(["keyboard", "touch"] as const)(
  "four-key %s chords and rapid attacks remain accepted in FNF",
  async (kind) => {
    const selected = {
      ...chart,
      notes: [
        ...[0, 1, 2, 3].map((lane) => ({ beat: 1, lane, kind: "tap" as const })),
        { beat: 1.03, lane: 0, kind: "tap" as const },
        { beat: 1.06, lane: 0, kind: "tap" as const },
      ],
    };
    const hook = await game(selected),
      input = source(hook, kind);
    clock.time = 1;
    act(() => {
      for (let lane = 0; lane < 4; lane++) input.down(lane);
    });
    expect(hook.result.current.play.counts.PERFECT).toBe(4);
    for (const time of [1.03, 1.06]) {
      clock.time = time;
      act(() => {
        input.up(0);
        input.down(0);
      });
    }
    expect(hook.result.current.play.counts.PERFECT).toBe(6);
  },
);
it("style edits apply on the next run and preserve the active replay policy", async () => {
  const hook = await game(),
    input = source(hook, "keyboard");
  hook.rerender({ playStyle: "mania" });
  clock.time = 0.85;
  act(() => {
    input.down(0);
    input.up(0);
  });
  expect(hook.result.current.play.counts.MISS).toBe(0);
  expect(hook.result.current.runConfiguration?.playStyle).toBe("fnf");
  await act(() => hook.result.current.start());
  act(() => {
    input.down(0);
    input.up(0);
  });
  expect(hook.result.current.play.counts.MISS).toBe(1);
  expect(hook.result.current.runConfiguration?.playStyle).toBe("mania");
});
it("FNF hold cancellation/early release remains a MISS, distinct from an ignored head attack", async () => {
  const selected = {
    ...chart,
    notes: [{ beat: 1, lane: 0, kind: "hold" as const, lengthBeats: 1 }],
  };
  const hook = await game(selected);
  clock.time = 1;
  act(() => hook.result.current.pressLane(0));
  clock.time = 1.5;
  act(() => hook.result.current.releaseLane(0, undefined, undefined, true));
  expect(hook.result.current.play.counts).toEqual({ PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 1 });
});
