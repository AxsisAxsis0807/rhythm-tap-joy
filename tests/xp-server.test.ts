// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { chartRevision, sha256, type PlayReplay } from "@/game/replay";
import type { Chart } from "@/game/types";
const fake = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  revision: {} as Record<string, unknown>,
  rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "verified_play_sessions" ? fake.session : fake.revision,
            error: null,
          }),
        }),
      }),
    }),
    rpc: fake.rpc,
  },
}));
import { verifyAndAward } from "@/lib/xp.server";
const selected: Chart = {
  id: "reviewed",
  title: "",
  artist: "",
  audioUrl: "/audio",
  difficultyName: "",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  notes: [{ beat: 1, lane: 0, kind: "tap" }],
};
const replay: PlayReplay = {
  version: 1,
  events: [
    { kind: "press", source: "key:D", lane: 0, time: 1, elapsedMs: 2500 },
    { kind: "tick", time: 4, elapsedMs: 5500 },
  ],
};
beforeEach(async () => {
  vi.clearAllMocks();
  const chart = chartRevision(selected),
    revision = await sha256(chart);
  fake.session = {
    id: "session",
    play_id: "play",
    user_id: "owner",
    revision,
    timing_offset_ms: 0,
  };
  fake.revision = { chart, audio_duration: 2, verifier_version: 1 };
  fake.rpc.mockResolvedValue({ data: { status: "ineligible", reason: "daily_cap" }, error: null });
});
it("uses stored revision and recomputes result rather than browser claimed score/accuracy/XP", async () => {
  expect(await verifyAndAward("owner", { playId: "play", sessionId: "session", replay })).toEqual({
    ok: true,
    outcome: { status: "ineligible", reason: "daily_cap" },
  });
  expect(fake.rpc).toHaveBeenCalledWith("commit_verified_xp", {
    p_session: "session",
    p_digest: await sha256(replay),
    p_result: {
      score: "1002",
      accuracy: 100,
      maxCombo: "1",
      perfect: "1",
      great: "0",
      good: "0",
      miss: "0",
      elapsedMs: 5500,
    },
  });
  expect(JSON.stringify(fake.rpc.mock.calls[0])).not.toContain("earnedXp");
});
it("wrong owner or play UUID cannot cross the trusted service boundary", async () => {
  expect(
    await verifyAndAward("other", { playId: "play", sessionId: "session", replay }),
  ).toMatchObject({ ok: false, code: "auth", retryable: false });
  expect(
    await verifyAndAward("owner", { playId: "other", sessionId: "session", replay }),
  ).toMatchObject({ ok: false, code: "auth" });
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("tampered stored content, unknown verifier versions and fabricated/incomplete replays never award", async () => {
  fake.revision.chart = { ...chartRevision(selected), offset: 1 };
  expect(
    await verifyAndAward("owner", { playId: "play", sessionId: "session", replay }),
  ).toMatchObject({ ok: false, code: "verification_failed", retryable: false });
  fake.revision.chart = chartRevision(selected);
  fake.revision.verifier_version = 2;
  expect((await verifyAndAward("owner", { playId: "play", sessionId: "session", replay })).ok).toBe(
    false,
  );
  fake.revision.verifier_version = 1;
  expect(
    (
      await verifyAndAward("owner", {
        playId: "play",
        sessionId: "session",
        replay: { version: 1, events: [] },
      })
    ).ok,
  ).toBe(false);
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("temporary DB score-pending errors retry; saved-score mismatches are terminal", async () => {
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001" } });
  expect(
    await verifyAndAward("owner", { playId: "play", sessionId: "session", replay }),
  ).toMatchObject({ ok: false, retryable: true });
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
  expect(
    await verifyAndAward("owner", { playId: "play", sessionId: "session", replay }),
  ).toMatchObject({ ok: false, retryable: false });
});

it("permission/configuration rejection pauses instead of inventing a zero reward", async () => {
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect(
    await verifyAndAward("owner", { playId: "play", sessionId: "session", replay }),
  ).toMatchObject({ ok: false, code: "configuration", retryable: false });
});
