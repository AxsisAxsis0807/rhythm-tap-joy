import type { CompletedPlay } from "@/game/types";
import { PlayResultSaveError, recordCompletedPlay } from "./playerRanking";

const LEGACY_KEY = "pulse-lane:play-result-queue:v1";
const PREFIX = "pulse-lane:play-result-queue:v2:";
export type PendingPlayResult = {
  ownerId: string;
  result: CompletedPlay;
  attempts: number;
  nextAttemptAt?: number;
  authPaused?: boolean;
};
export type QueueEvent = {
  ownerId: string;
  playId: string;
  status: "queued" | "saving" | "saved" | "paused" | "failed";
  error?: string;
  retryable?: boolean;
  durable?: boolean;
};
const listeners = new Set<(event: QueueEvent) => void>();
const flushes = new Map<string, Promise<void>>();
// A storage failure must not crash RESULT or lose the current tab's result.
const memory = new Map<string, PendingPlayResult>();
const settled = new Map<string, QueueEvent>();
const keyFor = (owner: string, id: string) => `${PREFIX}${encodeURIComponent(owner)}:${id}`;
function emit(event: QueueEvent) {
  listeners.forEach((listener) => listener(event));
}
function remember(event: QueueEvent) {
  const key = keyFor(event.ownerId, event.playId);
  settled.set(key, event);
  if (settled.size > 200) settled.delete(settled.keys().next().value!);
  emit(event);
}
function isItem(value: unknown): value is PendingPlayResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingPlayResult>;
  return (
    typeof item.ownerId === "string" &&
    typeof item.result?.id === "string" &&
    typeof item.result.songId === "string" &&
    Number.isSafeInteger(item.attempts) &&
    (item.attempts ?? -1) >= 0
  );
}
function persist(item: PendingPlayResult) {
  const key = keyFor(item.ownerId, item.result.id);
  memory.set(key, item);
  try {
    localStorage.setItem(key, JSON.stringify(item));
    return true;
  } catch {
    return false;
  }
}
function readQueue(): PendingPlayResult[] {
  const items = new Map<string, PendingPlayResult>();
  try {
    const legacy: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    if (Array.isArray(legacy)) {
      let migrated = true;
      for (const item of legacy.filter(isItem)) migrated = persist(item) && migrated;
      if (migrated) localStorage.removeItem(LEGACY_KEY);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const item: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
        if (isItem(item) && key === keyFor(item.ownerId, item.result.id)) items.set(key, item);
      } catch {
        /* One damaged item must not hide other pending plays. */
      }
    }
  } catch {
    /* Disabled/quota-limited storage uses the in-memory fallback. */
  }
  memory.forEach((item, key) => items.set(key, item));
  return [...items.entries()].filter(([key]) => !settled.has(key)).map(([, item]) => item);
}
function remove(item: PendingPlayResult) {
  const key = keyFor(item.ownerId, item.result.id);
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* UUID remains idempotent after reload. */
  }
}
export function subscribeToPlayResultQueue(listener: (event: QueueEvent) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function enqueuePlayResult(ownerId: string, result: CompletedPlay) {
  if (result.competitive === false) return;
  const previous = settled.get(keyFor(ownerId, result.id));
  if (previous) {
    emit(previous);
    return;
  }
  const existing = readQueue().find(
    (item) => item.ownerId === ownerId && item.result.id === result.id,
  );
  const durable = persist(existing ?? { ownerId, result, attempts: 0 });
  emit({ ownerId, playId: result.id, status: "queued", durable });
}
export function pendingPlayCount(ownerId: string) {
  return readQueue().filter((item) => item.ownerId === ownerId).length;
}
export function nextPlayResultRetry(ownerId: string): number | null {
  const items = readQueue().filter((item) => item.ownerId === ownerId && !item.authPaused);
  return items.length ? Math.min(...items.map((item) => item.nextAttemptAt ?? 0)) : null;
}
export function flushPlayResultQueue(ownerId: string, force = true) {
  const running = flushes.get(ownerId);
  if (running) return running;
  const flush = (async () => {
    const visited = new Set<string>();
    // Read again after every await so a fast RETRY cannot strand a new result.
    while (true) {
      const item = readQueue().find(
        (queued) =>
          queued.ownerId === ownerId &&
          !visited.has(queued.result.id) &&
          (force || (!queued.authPaused && (queued.nextAttemptAt ?? 0) <= Date.now())),
      );
      if (!item) break;
      visited.add(item.result.id);
      emit({ ownerId, playId: item.result.id, status: "saving" });
      try {
        await recordCompletedPlay(item.result, ownerId);
        remove(item);
        remember({ ownerId, playId: item.result.id, status: "saved" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存できませんでした";
        const saveError = error instanceof PlayResultSaveError ? error : null;
        if (saveError?.kind === "invalid") {
          remove(item);
          remember({
            ownerId,
            playId: item.result.id,
            status: "failed",
            error: message,
            retryable: false,
          });
          continue;
        }
        item.attempts += 1;
        item.authPaused = saveError !== null && !saveError.retryable;
        item.nextAttemptAt =
          Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(item.attempts - 1, 5));
        const durable = persist(item);
        emit({
          ownerId,
          playId: item.result.id,
          status: "paused",
          error: message,
          retryable: true,
          durable,
        });
        // Stop a transient outage from issuing one failed request per queued result.
        break;
      }
    }
  })().finally(() => flushes.delete(ownerId));
  flushes.set(ownerId, flush);
  return flush;
}
export function __resetPlayResultQueueForTests() {
  try {
    localStorage.removeItem(LEGACY_KEY);
    for (const key of Object.keys(localStorage))
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch {
    /* Tests can simulate storage failure. */
  }
  memory.clear();
  settled.clear();
  flushes.clear();
}
