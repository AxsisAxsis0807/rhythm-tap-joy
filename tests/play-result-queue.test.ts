import { beforeEach, expect, it, vi } from "vitest";
import type { CompletedPlay } from "@/game/types";
import {
  __resetPlayResultQueueForTests,
  enqueuePlayResult,
  flushPlayResultQueue,
  pendingPlayCount,
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
