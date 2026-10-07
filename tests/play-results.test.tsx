import React, { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRhythmGame } from "@/game/useRhythmGame";
import { usePendingPlayResults, usePlayResult } from "@/lib/usePlayResult";
import { recordCompletedPlay } from "@/lib/playerRanking";
import { __resetPlayResultQueueForTests } from "@/lib/playResultQueue";
import type { Chart } from "@/game/types";

const audio = vi.hoisted(() => ({ time: 0, duration: 5 }));
vi.mock("@/game/audio", () => ({
  AudioClock: class {
    duration = audio.duration;
    async load() {}
    async start() {
      audio.time = -1.5;
    }
    now() {
      return audio.time;
    }
    dispose() {}
  },
}));
vi.mock("@/lib/playerRanking", () => ({
  recordCompletedPlay: vi.fn(async () => {}),
  rankingKeys: { all: ["player-ranking"] },
  PlayResultSaveError: class extends Error {
    retryable = true;
    kind = "network";
  },
}));
let nextFrame: FrameRequestCallback | undefined;
const chart: Chart = {
  id: "built-in",
  title: "test",
  artist: "test",
  audioUrl: "/test",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "NORMAL",
  notes: [{ beat: 0, lane: 0, kind: "tap" }],
};
function setup(selected: Chart, userId: string | null = "user-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  );
  return renderHook(
    () => {
      const game = useRhythmGame(selected);
      usePendingPlayResults(userId);
      const saving = usePlayResult(game.completedPlay, userId);
      return { game, saving };
    },
    { wrapper },
  );
}
function tick(time: number) {
  audio.time = time;
  act(() => nextFrame?.(time * 1000));
}
beforeEach(() => {
  __resetPlayResultQueueForTests();
  vi.clearAllMocks();
  audio.time = 0;
  nextFrame = undefined;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    nextFrame = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    nextFrame = undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(["mania", "fnf"] as const)("%s completion", (mode) => {
  it("saves once at full completion; rerenders do not resend; RETRY creates a new play", async () => {
    const selected: Chart =
      mode === "fnf"
        ? {
            ...chart,
            fnf: {
              playerSide: "right",
              right: chart.notes,
              left: [{ beat: 0, lane: 2, kind: "tap" }],
            },
          }
        : chart;
    const { result, rerender } = setup(selected);
    await waitFor(() => expect(result.current.game.status).toBe("ready"));
    await act(() => result.current.game.start());
    audio.time = 0;
    act(() => result.current.game.pressLane(0));
    tick(3);
    expect(result.current.game.status).toBe("playing"); // last note done, audio still playing
    expect(recordCompletedPlay).not.toHaveBeenCalled();
    tick(6);
    await waitFor(() => expect(result.current.saving.state?.status).toBe("saved"));
    expect(result.current.game.status).toBe("finished");
    const first = result.current.game.completedPlay!;
    expect(first.play.score).toBe(1002);
    expect(first.play.counts).toEqual({ PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 0 });
    rerender();
    rerender();
    expect(recordCompletedPlay).toHaveBeenCalledTimes(1);
    await act(() => result.current.game.start());
    audio.time = 0;
    act(() => result.current.game.pressLane(0));
    tick(6);
    await waitFor(() => expect(recordCompletedPlay).toHaveBeenCalledTimes(2));
    expect(result.current.game.completedPlay!.id).not.toBe(first.id);
    expect(first.play.score).toBe(1002); // previous snapshot survives RETRY
  });
});
it("guest completes normally without saving", async () => {
  const { result } = setup(chart, null);
  await waitFor(() => expect(result.current.game.status).toBe("ready"));
  await act(() => result.current.game.start());
  tick(6);
  expect(result.current.game.status).toBe("finished");
  expect(recordCompletedPlay).not.toHaveBeenCalled();
});
it("abandoned play has no completed result", async () => {
  const { result, unmount } = setup(chart);
  await waitFor(() => expect(result.current.game.status).toBe("ready"));
  await act(() => result.current.game.start());
  tick(1);
  unmount();
  expect(recordCompletedPlay).not.toHaveBeenCalled();
});
it("failed save can be retried with the same idempotency key", async () => {
  vi.mocked(recordCompletedPlay).mockRejectedValueOnce(new Error("offline"));
  const { result } = setup(chart);
  await waitFor(() => expect(result.current.game.status).toBe("ready"));
  await act(() => result.current.game.start());
  tick(6);
  await waitFor(() => expect(result.current.saving.state?.status).toBe("error"));
  await act(() => result.current.saving.retrySave());
  expect(result.current.saving.state?.status).toBe("saved");
  expect(vi.mocked(recordCompletedPlay).mock.calls[0]?.[0].id).toBe(
    vi.mocked(recordCompletedPlay).mock.calls[1]?.[0].id,
  );
});
it("keeps a failed result across unmount and resends the original UUID", async () => {
  vi.mocked(recordCompletedPlay).mockRejectedValueOnce(new Error("offline"));
  const first = setup(chart);
  await waitFor(() => expect(first.result.current.game.status).toBe("ready"));
  await act(() => first.result.current.game.start());
  tick(6);
  await waitFor(() => expect(first.result.current.saving.state?.status).toBe("error"));
  const playId = first.result.current.game.completedPlay!.id;
  first.unmount();

  const second = setup(chart);
  await waitFor(() => expect(recordCompletedPlay).toHaveBeenCalledTimes(2));
  expect(vi.mocked(recordCompletedPlay).mock.calls[1]?.[0].id).toBe(playId);
  second.unmount();
});
it("empty chart completes after audio ends", async () => {
  const { result } = setup({ ...chart, notes: [] });
  await waitFor(() => expect(result.current.game.status).toBe("ready"));
  await act(() => result.current.game.start());
  tick(6);
  await waitFor(() => expect(result.current.saving.state?.status).toBe("saved"));
  expect(result.current.game.completedPlay!.play.score).toBe(0);
});
