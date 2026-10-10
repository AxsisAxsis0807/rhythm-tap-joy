import { beforeEach, expect, it, vi } from "vitest";
import type { CompletedPlay } from "@/game/types";
import {
  __resetPlayResultQueueForTests,
  enqueuePlayResult,
  flushPlayResultQueue,
  pendingPlayCount,
  nextPlayResultRetry,
} from "@/lib/playResultQueue";
import { PlayResultSaveError, recordCompletedPlay } from "@/lib/playerRanking";

vi.mock("@/lib/playerRanking", () => ({
  recordCompletedPlay: vi.fn(async () => {}),
  PlayResultSaveError: class extends Error {
    constructor(
      message: string,
      readonly retryable: boolean,
      readonly kind: "auth" | "invalid" | "network" | "unknown",
    ) {
      super(message);
    }
  },
}));

const result: CompletedPlay = {
  id: "00000000-0000-4000-8000-000000000001",
  songId: "built-in",
  play: {
    score: 1002,
    combo: 1,
    maxCombo: 1,
    counts: { PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 0 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetPlayResultQueueForTests();
});

it("keeps queues isolated by owner and never sends a result as another account", async () => {
  enqueuePlayResult("user-a", result);
  await flushPlayResultQueue("user-b");
  expect(recordCompletedPlay).not.toHaveBeenCalled();
  expect(pendingPlayCount("user-a")).toBe(1);
  await flushPlayResultQueue("user-a");
  expect(recordCompletedPlay).toHaveBeenCalledWith(result, "user-a");
  expect(pendingPlayCount("user-a")).toBe(0);
});

it("drops permanently invalid input instead of retrying it forever", async () => {
  vi.mocked(recordCompletedPlay).mockRejectedValueOnce(
    new PlayResultSaveError("invalid", false, "invalid"),
  );
  enqueuePlayResult("user-a", result);
  await flushPlayResultQueue("user-a");
  await flushPlayResultQueue("user-a");
  expect(recordCompletedPlay).toHaveBeenCalledTimes(1);
  expect(pendingPlayCount("user-a")).toBe(0);
});

it("pauses an authentication mismatch without deleting the original result", async () => {
  vi.mocked(recordCompletedPlay).mockRejectedValueOnce(
    new PlayResultSaveError("wrong account", false, "auth"),
  );
  enqueuePlayResult("user-a", result);
  await flushPlayResultQueue("user-a");
  expect(pendingPlayCount("user-a")).toBe(1);
});

it("drains a second result enqueued while the first request is in flight", async () => {
  let finish!: () => void;
  vi.mocked(recordCompletedPlay).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  enqueuePlayResult("user-a", result);
  const flush = flushPlayResultQueue("user-a");
  const second = { ...result, id: "00000000-0000-4000-8000-000000000002" };
  enqueuePlayResult("user-a", second);
  expect(flushPlayResultQueue("user-a")).toBe(flush);
  finish();
  await flush;
  expect(recordCompletedPlay).toHaveBeenCalledTimes(2);
  expect(pendingPlayCount("user-a")).toBe(0);
  enqueuePlayResult("user-a", { ...result });
  await flushPlayResultQueue("user-a");
  expect(recordCompletedPlay).toHaveBeenCalledTimes(2);
});

it("continues past a rejected result and saves the next valid play", async () => {
  vi.mocked(recordCompletedPlay).mockRejectedValueOnce(
    new PlayResultSaveError("bad input", false, "invalid"),
  );
  enqueuePlayResult("user-a", result);
  enqueuePlayResult("user-a", { ...result, id: "00000000-0000-4000-8000-000000000002" });
  await flushPlayResultQueue("user-a");
  expect(recordCompletedPlay).toHaveBeenCalledTimes(2);
  expect(pendingPlayCount("user-a")).toBe(0);
});

it("does not retry an auth rejection on automatic timer/online flushes", async () => {
  vi.mocked(recordCompletedPlay).mockRejectedValueOnce(
    new PlayResultSaveError("auth", false, "auth"),
  );
  enqueuePlayResult("user-a", result);
  await flushPlayResultQueue("user-a");
  await flushPlayResultQueue("user-a", false);
  await flushPlayResultQueue("user-a", false);
  expect(recordCompletedPlay).toHaveBeenCalledTimes(1);
  await flushPlayResultQueue("user-a"); // New sign-in/manual retry can resume.
  expect(recordCompletedPlay).toHaveBeenCalledTimes(2);
});

it("survives blocked localStorage without interrupting gameplay", async () => {
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  try {
    expect(() => enqueuePlayResult("user-a", result)).not.toThrow();
    expect(pendingPlayCount("user-a")).toBe(1);
    await flushPlayResultQueue("user-a");
    expect(recordCompletedPlay).toHaveBeenCalledWith(result, "user-a");
  } finally {
    set.mockRestore();
  }
});

it("migrates v1 pending plays and ignores an individually damaged v2 entry", async () => {
  localStorage.setItem(
    "pulse-lane:play-result-queue:v1",
    JSON.stringify([{ ownerId: "user-a", result, attempts: 1 }]),
  );
  localStorage.setItem("pulse-lane:play-result-queue:v2:damaged", "{");
  expect(pendingPlayCount("user-a")).toBe(1);
  expect(localStorage.getItem("pulse-lane:play-result-queue:v1")).toBeNull();
  await flushPlayResultQueue("user-a");
  expect(recordCompletedPlay).toHaveBeenCalledWith(result, "user-a");
});

it("restores the original UUID from storage in a fresh module after reload", async () => {
  vi.mocked(recordCompletedPlay).mockRejectedValueOnce(new Error("timeout after commit"));
  enqueuePlayResult("user-a", result);
  await flushPlayResultQueue("user-a");
  vi.resetModules();
  const reloaded = await import("@/lib/playResultQueue");
  expect(reloaded.pendingPlayCount("user-a")).toBe(1);
  await reloaded.flushPlayResultQueue("user-a");
  expect(vi.mocked(recordCompletedPlay).mock.calls.at(-1)).toEqual([result, "user-a"]);
  expect(reloaded.pendingPlayCount("user-a")).toBe(0);
});

it("backs off transient errors and retries the same UUID after the due time", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
  try {
    vi.mocked(recordCompletedPlay).mockRejectedValueOnce(new Error("offline"));
    enqueuePlayResult("user-a", result);
    await flushPlayResultQueue("user-a");
    expect(nextPlayResultRetry("user-a")).toBe(12_000);
    await flushPlayResultQueue("user-a", false);
    expect(recordCompletedPlay).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(12_001);
    await flushPlayResultQueue("user-a", false);
    expect(recordCompletedPlay).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordCompletedPlay).mock.calls[1]?.[0].id).toBe(result.id);
    expect(nextPlayResultRetry("user-a")).toBeNull();
  } finally {
    clock.mockRestore();
  }
});
