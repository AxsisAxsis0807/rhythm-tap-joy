import { it, expect, vi, afterEach } from "vitest";
import {
  enqueueXpEvidence,
  flushXpEvidence,
  pendingXpEvidence,
  subscribeToXpEvidence,
} from "@/lib/xpEvidenceQueue";
import { createRunConfiguration } from "@/game/runConfiguration";
import type { ReplayEvidence } from "@/game/replay";
const evidence = (id: string): ReplayEvidence => ({
  version: "pulse-replay-v1",
  runId: id,
  status: "complete",
  configuration: createRunConfiguration({
    id: "test",
    title: "",
    artist: "",
    audioUrl: "",
    bpm: 60,
    offset: 0,
    laneCount: 4,
    difficultyName: "",
    notes: [],
  }),
  events: [],
});
afterEach(() => vi.unstubAllGlobals());
it("unavailable storage reports nondurable; same envelope retries once without touching Score storage", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const owner = crypto.randomUUID(),
    id = crypto.randomUUID(),
    expires = new Date(Date.now() + 3600000).toISOString();
  expect(await enqueueXpEvidence(owner, id, expires, evidence(id))).toEqual({ durable: false });
  await enqueueXpEvidence(owner, id, expires, evidence(id));
  expect(await pendingXpEvidence(owner)).toHaveLength(1);
  const send = vi.fn(async () => ({ status: "ineligible" as const, reason: "test" }));
  await Promise.all([
    flushXpEvidence(owner, () => owner, send),
    flushXpEvidence(owner, () => owner, send),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await pendingXpEvidence(owner)).toHaveLength(0);
});
it("account switch stops queued evidence; altered retry cannot replace original", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const owner = crypto.randomUUID(),
    id = crypto.randomUUID(),
    expires = new Date(Date.now() + 3600000).toISOString();
  await enqueueXpEvidence(owner, id, expires, evidence(id));
  const send = vi.fn(async () => ({ status: "pending" as const }));
  await flushXpEvidence(owner, () => "different-owner", send);
  expect(send).not.toHaveBeenCalled();
  await expect(
    enqueueXpEvidence(owner, id, expires, {
      ...evidence(id),
      configuration: { ...evidence(id).configuration, timingOffsetMs: 1 },
    }),
  ).rejects.toThrow(/異なる/);
});
it("offline failures stay retryable errors rather than fabricated zero XP", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const owner = crypto.randomUUID(),
    id = crypto.randomUUID();
  await enqueueXpEvidence(owner, id, new Date(Date.now() + 3600000).toISOString(), evidence(id));
  const states: string[] = [];
  const unsubscribe = subscribeToXpEvidence((e) => {
    if (e.ownerId === owner) states.push(e.outcome.status);
  });
  await flushXpEvidence(
    owner,
    () => owner,
    async () => {
      throw new Error("offline");
    },
  );
  unsubscribe();
  expect(states).toEqual(["checking", "error"]);
  expect(await pendingXpEvidence(owner)).toHaveLength(1);
});
