import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { InputLedger, inputTime, laneAt } from "@/game/input";
import { InputOverlay } from "@/components/game/InputOverlay";
import { FnfField } from "@/components/game/FnfField";
import { getMode } from "@/game/modes";
import { TouchInput } from "@/components/game/TouchInput";
import { useRhythmGame } from "@/game/useRhythmGame";
import { DEFAULT_SETTINGS, sanitizeSettings } from "@/game/settings";
import type { Chart } from "@/game/types";
let songTime = 1;
vi.mock("@/game/audio", () => ({
  AudioClock: class {
    duration = 10;
    load = async () => {};
    start = async () => {};
    now = () => songTime;
    nowAt = (stamp?: number) =>
      songTime - (performance.now() - (stamp ?? performance.now())) / 1000;
    pause = async () => songTime;
    resume = async () => {};
    dispose = () => {};
  },
}));
afterEach(() => {
  cleanup();
  songTime = 1;
});
const chart: Chart = {
  id: "test",
  title: "test",
  artist: "test",
  audioUrl: "test",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "test",
  notes: [
    ...[0, 1, 2, 3].map((lane) => ({ beat: 1, lane, kind: "tap" as const })),
    { beat: 1.05, lane: 0, kind: "tap" },
    { beat: 2, lane: 1, kind: "hold", lengthBeats: 3 },
  ],
};
async function running() {
  const hook = renderHook(() => useRhythmGame(chart));
  await act(async () => {});
  await act(async () => {
    await hook.result.current.start();
  });
  return hook;
}
describe("ordered physical inputs", () => {
  it("retains rapid same-frame taps and independent 2/3/4-lane presses", () => {
    const input = new InputLedger();
    for (let i = 0; i < 20; i++) {
      input.press("pointer:1", 0);
      input.release("pointer:1");
    }
    expect(input.bars).toHaveLength(20);
    expect(input.bars.every((b) => b.end !== undefined)).toBe(true);
    for (let i = 0; i < 4; i++) input.press(`pointer:${i}`, i);
    expect([...input.activeLanes]).toEqual([0, 1, 2, 3]);
  });
  it("ignores duplicate source/repeat and retains a lane until its final owner releases", () => {
    const input = new InputLedger();
    input.press("pointer:1", 1);
    input.press("pointer:2", 1);
    input.press("key:KeyF", 1);
    input.press("key:KeyF", 1);
    expect(input.accepted).toBe(3);
    input.release("pointer:1");
    input.release("key:KeyF");
    expect(input.activeLanes.has(1)).toBe(true);
    input.release("pointer:2", undefined, true);
    input.release("pointer:2");
    expect(input.activeLanes.size).toBe(0);
    expect(input.bars[1]?.cancelled).toBe(true);
  });
  it("bounds history while keeping long active holds", () => {
    const input = new InputLedger();
    input.press("hold", 2);
    for (let i = 0; i < 1000; i++) {
      input.press("tap", 0);
      input.release("tap");
    }
    expect(input.bars.length).toBeLessThanOrEqual(258);
    input.prune(performance.now() + 11000);
    expect(input.bars).toHaveLength(1);
    input.clear();
    expect(input.activeLanes.size).toBe(0);
  });
  it("normalizes epoch timestamps and assigns every boundary without gaps", () => {
    expect(inputTime(performance.timeOrigin + 80, 100)).toBeCloseTo(80);
    expect(inputTime(80, 100)).toBe(80);
    expect([0, 99.99, 100, 200, 300, 400].map((x) => laneAt(x, 0, 400))).toEqual([
      0, 0, 1, 2, 3, 3,
    ]);
  });
});
describe("game integration", () => {
  it("judges all four lanes and new same-lane sources even while another owner holds", async () => {
    const { result } = await running();
    act(() => {
      for (let lane = 0; lane < 4; lane++) result.current.pressLane(lane, `pointer:${lane}`);
    });
    expect(result.current.play.counts.PERFECT).toBe(4);
    songTime = 1.05;
    act(() => result.current.pressLane(0, "key:KeyD"));
    expect(result.current.play.counts.PERFECT).toBe(5);
    act(() => result.current.releaseLane(0, "key:KeyD"));
    expect(result.current.activeLanes.has(0)).toBe(true);
  });
  it("does not turn outside-window input into a hit; uses the edge timestamp", async () => {
    const { result } = await running();
    songTime = 1.2;
    act(() => {
      result.current.pressLane(2, "pointer:1", performance.now() - 200);
      result.current.releaseLane(2, "pointer:1");
    });
    expect(result.current.play.counts.PERFECT).toBe(1);
    songTime = 5;
    act(() => result.current.pressLane(3, "pointer:2"));
    expect(result.current.inputs.bars.at(-1)?.outcome).toBe("outside-window");
    expect(result.current.play.counts.PERFECT).toBe(1);
  });
  it("keeps a hold through another owner releasing, then fails cancellation, clears pause/restart", async () => {
    const { result } = await running();
    songTime = 2;
    act(() => {
      result.current.pressLane(1, "pointer:1");
      result.current.pressLane(1, "key:KeyF");
      result.current.releaseLane(1, "pointer:1");
    });
    expect(result.current.notes.find((n) => n.kind === "hold")?.holding).toBe(true);
    act(() => result.current.releaseLane(1, "key:KeyF", undefined, true));
    expect(result.current.play.counts.MISS).toBe(1);
    expect(result.current.notes.find((n) => n.kind === "hold")?.holding).toBe(false);
    act(() => result.current.pressLane(0, "pointer:2"));
    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.activeLanes.size).toBe(0);
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.inputs.sources.size).toBe(0);
  });
  it("keyboard repeat creates no extra bars and blur releases every source", async () => {
    const { result } = await running();
    act(() => {
      fireEvent.keyDown(window, { code: "KeyD" });
      fireEvent.keyDown(window, { code: "KeyD", repeat: true });
    });
    expect(result.current.inputs.accepted).toBe(1);
    await act(async () => {
      fireEvent.blur(window);
    });
    expect(result.current.activeLanes.size).toBe(0);
    expect(result.current.status).toBe("paused");
  });
  it("overlay preferences preserve migration and never enter the game options", () => {
    expect(sanitizeSettings({}).inputOverlayEnabled).toBe(true);
    expect(sanitizeSettings({ inputOverlayDuration: 99 }).inputOverlayDuration).toBe(5);
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
it("pointer capture handles multiple fingers, outside release/cancel, and ignores compatibility click", () => {
  // jsdom lacks PointerEvent; supply the browser event fields explicitly.
  const input = new InputLedger();
  const { getByTestId } = render(
    <TouchInput
      onPress={(lane, source, time) => {
        input.press(source, lane, time);
      }}
      onRelease={(source, time, cancel) => {
        input.release(source, time, cancel);
      }}
    />,
  );
  const target = getByTestId("touch-input");
  target.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect;
  target.setPointerCapture = vi.fn();
  const edge = (type: string, id: number, x: number) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: id, pointerType: "touch", clientX: x });
    fireEvent(target, e);
  };
  for (let i = 0; i < 4; i++) edge("pointerdown", i, i * 100 + 50);
  expect(input.activeLanes.size).toBe(4);
  expect(target.setPointerCapture).toHaveBeenCalledTimes(4);
  edge("pointerup", 0, -100);
  edge("pointercancel", 1, 150);
  edge("lostpointercapture", 2, 250);
  edge("lostpointercapture", 0, 50);
  fireEvent.click(target);
  expect(input.accepted).toBe(4);
  expect([...input.activeLanes]).toEqual([3]);
});

it("preserves a held key across rerenders and changed bindings; release uses the original source", async () => {
  let keys = [["KeyA"], ["KeyS"], ["KeyL"], ["Semicolon"]];
  const { result, rerender, unmount } = renderHook(() =>
    useRhythmGame(chart, { keyMap: keys.map((x) => [...x]) }),
  );
  await act(async () => {});
  await act(async () => {
    await result.current.start();
  });
  act(() => fireEvent.keyDown(window, { code: "KeyA" }));
  rerender();
  rerender();
  act(() => fireEvent.keyDown(window, { code: "KeyA", repeat: true }));
  expect(result.current.inputs.accepted).toBe(1);
  keys = [["KeyZ"], ["KeyS"], ["KeyL"], ["Semicolon"]];
  rerender();
  act(() => fireEvent.keyUp(window, { code: "KeyA" }));
  expect(result.current.activeLanes.size).toBe(0);
  act(() => fireEvent.keyDown(window, { code: "KeyZ" }));
  expect(result.current.activeLanes.has(0)).toBe(true);
  const ledger = result.current.inputs;
  unmount();
  expect(ledger.sources.size).toBe(0);
});

it("does not accept input while asynchronous pause is completing", async () => {
  const { result } = await running();
  await act(async () => {
    const pausing = result.current.pause();
    result.current.pressLane(0, "pointer:late");
    await pausing;
  });
  expect(result.current.inputs.accepted).toBe(0);
});

it("releases outside the surface even when pointer capture fails and cleans up on unmount", () => {
  const input = new InputLedger();
  const { getByTestId, unmount } = render(
    <TouchInput
      onPress={(lane, source, time) => {
        input.press(source, lane, time);
      }}
      onRelease={(source, time, cancel) => {
        input.release(source, time, cancel);
      }}
    />,
  );
  const target = getByTestId("touch-input");
  target.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect;
  target.setPointerCapture = () => {
    throw new Error("already cancelled");
  };
  const edge = (node: Element | Window, type: string, id: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, pointerType: "touch", clientX: 50 });
    fireEvent(node, event);
  };
  edge(target, "pointerdown", 1);
  edge(window, "pointerup", 1);
  expect(input.activeLanes.size).toBe(0);
  edge(target, "pointerdown", 2);
  unmount();
  expect(input.sources.size).toBe(0);
  expect(input.bars.at(-1)?.cancelled).toBe(true);
});

it("overlay mounting/ON/OFF does not change judgement or score for the same input sequence", async () => {
  const scores: number[] = [];
  for (const visible of [false, true]) {
    songTime = 1;
    const { result, unmount } = await running();
    const overlay = visible
      ? render(<InputOverlay inputs={result.current.inputs} settings={DEFAULT_SETTINGS} />)
      : null;
    act(() => {
      for (let lane = 0; lane < 4; lane++) {
        result.current.pressLane(lane, `pointer:${lane}`);
        result.current.releaseLane(lane, `pointer:${lane}`);
      }
    });
    scores.push(result.current.play.score);
    expect(result.current.play.counts.PERFECT).toBe(4);
    expect(result.current.inputs.bars).toHaveLength(4);
    overlay?.unmount();
    unmount();
  }
  expect(scores[0]).toBeGreaterThan(0);
  expect(scores[0]).toBe(scores[1]);
});

it.each(["down", "up"] as const)(
  "FNF metadata respects %s scroll and custom judgement position",
  (direction) => {
    const selected: Chart = {
      ...chart,
      fnf: { playerSide: "right", left: chart.notes, right: chart.notes },
    };
    const { getByTestId } = render(
      <FnfField
        chart={selected}
        mode={{ ...getMode("fnf"), scroll: direction, judgeLinePct: 75 }}
        notes={[{ id: 0, time: 2, lane: 0, kind: "tap", judged: false }]}
        songTime={1}
        scrollTime={2}
        activeLanes={new Set()}
        middleScroll={false}
      />,
    );
    const lane = getByTestId("fnf-right").firstElementChild!;
    expect((lane.firstElementChild as HTMLElement).style.top).toBe("75%");
    expect((lane.children[1] as HTMLElement).style.top).toBe(
      direction === "down" ? "37.5%" : "87.5%",
    );
  },
);
