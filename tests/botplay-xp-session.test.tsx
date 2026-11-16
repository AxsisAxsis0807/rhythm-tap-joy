import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePlaySession } from "@/lib/usePlaySession";
import { createRunConfiguration } from "@/game/runConfiguration";
import { beginPlay, finishPlay } from "@/lib/xp.functions";
import { enqueueXpEvidence } from "@/lib/xpEvidenceQueue";
import type { ReplayEvidence } from "@/game/replay";
vi.mock("@/lib/xp.functions", () => ({
  beginPlay: vi.fn(),
  finishPlay: vi.fn(),
  getXpReceipt: vi.fn(),
}));
vi.mock("@/lib/ownerTransport", () => ({ ownerTransport: vi.fn(async () => fetch) }));
vi.mock("@/lib/xpEvidenceQueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/xpEvidenceQueue")>()),
  enqueueXpEvidence: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("never starts an XP session or submits BOT evidence; next manual run can prepare XP", async () => {
  const chart = {
    id: "song",
    revisionId: "revision",
    title: "",
    artist: "",
    audioUrl: "",
    bpm: 60,
    offset: 0,
    laneCount: 4,
    difficultyName: "",
    notes: [],
  };
  const config = createRunConfiguration(chart, { autoplay: true });
  const hook = renderHook(
    ({ evidence }: { evidence: ReplayEvidence | null }) => usePlaySession("owner", evidence),
    { initialProps: { evidence: null } },
  );
  await act(async () => expect(await hook.result.current.prepare(config)).toBeUndefined());
  hook.rerender({
    evidence: {
      version: "pulse-replay-v1",
      runId: "bot",
      status: "complete",
      configuration: config,
      events: [],
    },
  });
  expect(beginPlay).not.toHaveBeenCalled();
  expect(enqueueXpEvidence).not.toHaveBeenCalled();
  expect(finishPlay).not.toHaveBeenCalled();
  vi.mocked(beginPlay).mockResolvedValue({
    enabled: true,
    sessionId: "human",
    expiresAt: new Date().toISOString(),
    reason: null,
  });
  await act(async () =>
    expect(await hook.result.current.prepare(createRunConfiguration(chart))).toBe("human"),
  );
  expect(beginPlay).toHaveBeenCalledTimes(1);
});
