import type { CompletedPlay } from "@/game/types";
import { PlayResultSaveError, recordCompletedPlay } from "./playerRanking";

const STORAGE_KEY = "pulse-lane:play-result-queue:v1";

export type PendingPlayResult = {
  ownerId: string;
  result: CompletedPlay;
  attempts: number;
};

export type QueueEvent = {
  ownerId: string;
  playId: string;
  status: "queued" | "saving" | "saved" | "paused" | "failed";
  error?: string;
};

type QueueListener = (event: QueueEvent) => void;
const listeners = new Set<QueueListener>();
const flushes = new Map<string, Promise<void>>();

function emit(event: QueueEvent) {
  listeners.forEach((listener) => listener(event));
}

function readQueue(): PendingPlayResult[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingPlayResult =>
        typeof item === "object" &&
        item !== null &&
        typeof item.ownerId === "string" &&
        typeof item.result?.id === "string" &&
        typeof item.result?.songId === "string" &&
        typeof item.attempts === "number",
    );
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingPlayResult[]) {
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function subscribeToPlayResultQueue(listener: QueueListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function enqueuePlayResult(ownerId: string, result: CompletedPlay) {
  const queue = readQueue();
  if (!queue.some((item) => item.ownerId === ownerId && item.result.id === result.id)) {
    queue.push({ ownerId, result, attempts: 0 });
    writeQueue(queue);
  }
  emit({ ownerId, playId: result.id, status: "queued" });
}

export function pendingPlayCount(ownerId: string) {
  return readQueue().filter((item) => item.ownerId === ownerId).length;
}

function updateItem(ownerId: string, playId: string, update: (item: PendingPlayResult) => boolean) {
  const queue = readQueue();
  writeQueue(
    queue.filter((item) =>
      item.ownerId === ownerId && item.result.id === playId ? update(item) : true,
    ),
  );
}

export function flushPlayResultQueue(ownerId: string) {
  const running = flushes.get(ownerId);
  if (running) return running;
  const flush = (async () => {
    const items = readQueue().filter((item) => item.ownerId === ownerId);
    for (const item of items) {
      emit({ ownerId, playId: item.result.id, status: "saving" });
      try {
        await recordCompletedPlay(item.result, ownerId);
        updateItem(ownerId, item.result.id, () => false);
        emit({ ownerId, playId: item.result.id, status: "saved" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存できませんでした";
        const saveError = error instanceof PlayResultSaveError ? error : null;
        if (saveError && !saveError.retryable) {
          if (saveError.kind === "invalid") {
            updateItem(ownerId, item.result.id, () => false);
            emit({ ownerId, playId: item.result.id, status: "failed", error: message });
          } else {
            emit({ ownerId, playId: item.result.id, status: "paused", error: message });
          }
          break;
        }
        updateItem(ownerId, item.result.id, (queued) => {
          queued.attempts += 1;
          return true;
        });
        emit({ ownerId, playId: item.result.id, status: "paused", error: message });
        break;
      }
    }
  })().finally(() => flushes.delete(ownerId));
  flushes.set(ownerId, flush);
  return flush;
}

export function __resetPlayResultQueueForTests() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  flushes.clear();
}
