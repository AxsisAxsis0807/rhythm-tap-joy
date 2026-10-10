import { beforeEach, expect, it, vi } from "vitest";
import { createPlayState } from "@/game/engine";
import type { CompletedPlay } from "@/game/types";
const mock = vi.hoisted(() => ({ submit: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/xp.functions", () => ({ submitXpReplay: mock.submit }));
vi.mock("@/lib/xpClient", () => ({ ownerToken: mock.token }));
const confirmed = {
  status: "awarded",
  earnedXp: "190",
  previousLevel: "1",
  growth: {
    level: "1",
    nextLevel: "2",
    totalXp: "190",
    xpInLevel: "190",
    xpToNextLevel: "500",
    levelPublic: true,
  },
  breakdown: [
    { label: "プレイ", xp: "90" },
    { label: "初クリア", xp: "50" },
    { label: "デイリーボーナス", xp: "50" },
  ],
} as const;
let queue: typeof import("@/lib/xpQueue");
function play(): CompletedPlay {
  return {
    id: crypto.randomUUID(),
    songId: "verified",
    play: createPlayState(),
    verification: { sessionId: crypto.randomUUID(), replay: { version: 1, events: [] } },
  };
}
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  vi.clearAllMocks();
  mock.token.mockResolvedValue("owner-token");
  mock.submit.mockResolvedValue({ ok: true, outcome: confirmed });
  queue = await import("@/lib/xpQueue");
});
it("persists failed replay across navigation/reload, resends original session/UUID and removes successful pending data", async () => {
  const result = play(),
    events: unknown[] = [];
  queue.subscribeXp((e) => events.push(e.outcome));
  queue.enqueueXp("a", result);
  mock.submit.mockRejectedValueOnce(new Error("timeout"));
  await queue.flushXp("a");
  expect(queue.pendingXpCount("a")).toBe(1);
  expect(events).toContainEqual(expect.objectContaining({ status: "error", retrying: true }));
  vi.resetModules();
  queue = await import("@/lib/xpQueue");
  await queue.flushXp("a", true);
  expect(queue.pendingXpCount("a")).toBe(0);
  const args = mock.submit.mock.calls.map(([arg]) => arg.data);
  expect(args[0]).toEqual(args[1]);
  expect(args[1]).toMatchObject({
    ownerId: "a",
    playId: result.id,
    sessionId: result.verification!.sessionId,
  });
  expect(localStorage.length).toBe(0);
});
it("StrictMode-like repeated enqueue and concurrent flushes do not issue duplicate requests; same receipt does not repeat awards", async () => {
  const result = play();
  queue.enqueueXp("a", result);
  queue.enqueueXp("a", result);
  await Promise.all([queue.flushXp("a"), queue.flushXp("a")]);
  queue.enqueueXp("a", result);
  await queue.flushXp("a");
  expect(mock.submit).toHaveBeenCalledTimes(1);
  expect(queue.xpReceipt("a", result.id)).toEqual(confirmed);
});
it("drains RETRY added during a request and keeps owners isolated", async () => {
  let resolve!: (v: unknown) => void;
  mock.submit.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  queue.enqueueXp("a", play());
  queue.enqueueXp("b", play());
  const pending = queue.flushXp("a");
  await vi.waitFor(() => expect(mock.submit).toHaveBeenCalledTimes(1));
  queue.enqueueXp("a", play());
  resolve({ ok: true, outcome: confirmed });
  await pending;
  expect(mock.submit).toHaveBeenCalledTimes(2);
  expect(queue.pendingXpCount("b")).toBe(1);
  expect(mock.submit.mock.calls.every(([args]) => args.data.ownerId === "a")).toBe(true);
});
it("wrong account pauses without sending; invalid verification is terminal and never retried forever", async () => {
  queue.enqueueXp("a", play());
  mock.token.mockRejectedValueOnce(new Error("auth_owner"));
  await queue.flushXp("a");
  expect(mock.submit).not.toHaveBeenCalled();
  expect(queue.nextXpRetry("a")).toBeNull();
  mock.submit.mockResolvedValue({ ok: false, code: "verification_failed", retryable: false });
  await queue.flushXp("a", true);
  expect(queue.pendingXpCount("a")).toBe(0);
  await queue.flushXp("a", true);
  expect(mock.submit).toHaveBeenCalledTimes(1);
});
it("0XP exclusions are separate from network failure; untrusted cached earnedXP never renders as confirmed", async () => {
  const result = play();
  result.verification!.reason = "unreviewed";
  queue.enqueueXp("a", result);
  expect(queue.xpReceipt("a", result.id)).toEqual({
    status: "ineligible",
    reason: "この譜面RevisionはXP対象として未審査です。",
  });
  expect(mock.submit).not.toHaveBeenCalled();
  const id = crypto.randomUUID();
  localStorage.setItem(`pulse-lane:xp-receipt:v1:a:${id}`, JSON.stringify(confirmed));
  expect(queue.xpReceipt("a", id)).toBeNull();
});
it("storage quota failure keeps current-tab retries without stopping game logic", async () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const events: unknown[] = [];
  queue.subscribeXp((e) => events.push(e.outcome));
  const result = play();
  expect(() => queue.enqueueXp("a", result)).not.toThrow();
  expect(events).toContainEqual(expect.objectContaining({ status: "error", retrying: true }));
  await queue.flushXp("a");
  expect(queue.pendingXpCount("a")).toBe(0);
  spy.mockRestore();
});
it("auto retries pause after 10 failures while preserving manual recovery", async () => {
  mock.submit.mockRejectedValue(new Error("offline"));
  queue.enqueueXp("a", play());
  for (let i = 0; i < 10; i++) await queue.flushXp("a", true);
  expect(queue.nextXpRetry("a")).toBeNull();
  expect(queue.pendingXpCount("a")).toBe(1);
  await queue.flushXp("a");
  expect(mock.submit).toHaveBeenCalledTimes(10);
  mock.submit.mockResolvedValue({ ok: true, outcome: confirmed });
  await queue.flushXp("a", true);
  expect(queue.pendingXpCount("a")).toBe(0);
});
