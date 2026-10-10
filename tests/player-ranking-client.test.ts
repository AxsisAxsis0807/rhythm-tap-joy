import { beforeEach, expect, it, vi } from "vitest";
import { recordCompletedPlay } from "@/lib/playerRanking";
import type { CompletedPlay } from "@/game/types";
const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  header: vi.fn(),
  signal: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: api.getSession }, rpc: api.rpc },
}));
const result: CompletedPlay = {
  id: "00000000-0000-4000-8000-000000000001",
  songId: "fnf-right",
  play: {
    score: 1002,
    combo: 1,
    maxCombo: 1,
    counts: { PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 0 },
    timingErrorsMs: [],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  api.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-a" }, access_token: "test-user-a" } },
    error: null,
  });
  api.rpc.mockImplementation(() => {
    // Model an account switch between getSession and the RPC transport.
    api.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-b" }, access_token: "test-user-b" } },
      error: null,
    });
    return {
      setHeader: api.header.mockReturnValue({
        abortSignal: api.signal.mockResolvedValue({ error: null }),
      }),
    };
  });
});
it("pins the request token to the original owner even if the active account changes", async () => {
  await recordCompletedPlay(result, "user-a");
  expect(api.header).toHaveBeenCalledWith("Authorization", "Bearer test-user-a");
  expect(api.signal.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  expect(api.rpc.mock.calls[0]?.[1]).toMatchObject({
    p_id: result.id,
    p_score: 1002,
    p_perfect_count: 1,
  });
});
it("never sends another account's pending result or a guest result", async () => {
  await expect(recordCompletedPlay(result, "user-b")).rejects.toMatchObject({
    kind: "auth",
    retryable: false,
  });
  api.getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(recordCompletedPlay(result, "user-a")).rejects.toMatchObject({ kind: "auth" });
  expect(api.rpc).not.toHaveBeenCalled();
});
it("classifies input errors and missing RPCs without automatic infinite retries", async () => {
  api.rpc.mockReturnValue({
    setHeader: () => ({ abortSignal: async () => ({ error: { code: "23502", message: "null" } }) }),
  });
  await expect(recordCompletedPlay(result, "user-a")).rejects.toMatchObject({
    kind: "invalid",
    retryable: false,
  });
  api.rpc.mockReturnValue({
    setHeader: () => ({
      abortSignal: async () => ({ error: { code: "PGRST202", message: "migration missing" } }),
    }),
  });
  await expect(recordCompletedPlay(result, "user-a")).rejects.toMatchObject({ retryable: false });
});
it("rejects practice runs before issuing the score RPC", async () => {
  await expect(
    recordCompletedPlay({ ...result, competitive: false }, "user-a"),
  ).rejects.toMatchObject({ kind: "invalid" });
  expect(api.rpc).not.toHaveBeenCalled();
});

it("rejects damaged persisted play data instead of retrying a local TypeError forever", async () => {
  await expect(
    recordCompletedPlay({ ...result, play: undefined } as unknown as CompletedPlay, "user-a"),
  ).rejects.toMatchObject({ kind: "invalid", retryable: false });
  expect(api.rpc).not.toHaveBeenCalled();
});
