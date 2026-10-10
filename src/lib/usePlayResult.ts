import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CompletedPlay } from "@/game/types";
import { rankingKeys } from "./playerRanking";
import {
  enqueuePlayResult,
  flushPlayResultQueue,
  pendingPlayCount,
  nextPlayResultRetry,
  subscribeToPlayResultQueue,
  type QueueEvent,
} from "./playResultQueue";

type SaveState = {
  id: string;
  ownerId: string;
  status: "saving" | "saved" | "error" | "queued";
  error?: string;
  retryable?: boolean;
  durable?: boolean;
};

export function usePendingPlayResults(ownerId: string | null) {
  const queryClient = useQueryClient();
  const [pendingState, setPending] = useState(() => ({
    ownerId,
    count: ownerId ? pendingPlayCount(ownerId) : 0,
  }));

  const flush = useCallback(
    (force = true) => {
      if (!ownerId) return Promise.resolve();
      return flushPlayResultQueue(ownerId, force).then(() =>
        setPending({ ownerId, count: pendingPlayCount(ownerId) }),
      );
    },
    [ownerId],
  );

  useEffect(() => {
    setPending({ ownerId, count: ownerId ? pendingPlayCount(ownerId) : 0 });
    if (!ownerId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (disposed) return;
      clearTimeout(timer);
      const next = nextPlayResultRetry(ownerId);
      if (next !== null)
        timer = setTimeout(
          () => void flush(false).then(schedule),
          Math.max(100, next - Date.now()),
        );
    };
    const unsubscribe = subscribeToPlayResultQueue((event) => {
      if (event.ownerId !== ownerId) return;
      setPending({ ownerId, count: pendingPlayCount(ownerId) });
      schedule();
      if (event.status === "saved")
        void queryClient.invalidateQueries({ queryKey: rankingKeys.all });
    });
    const online = () => void flush(false).then(schedule);
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith("pulse-lane:play-result-queue:")) {
        setPending({ ownerId, count: pendingPlayCount(ownerId) });
        void queryClient.invalidateQueries({ queryKey: rankingKeys.all });
        schedule();
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("storage", storage);
    void flush().then(schedule);
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("online", online);
      window.removeEventListener("storage", storage);
      clearTimeout(timer);
    };
  }, [flush, ownerId, queryClient]);

  const pending =
    pendingState.ownerId === ownerId ? pendingState.count : ownerId ? pendingPlayCount(ownerId) : 0;
  return { pending, flush };
}

export function usePlayResult(result: CompletedPlay | null, ownerId: string | null) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SaveState | null>(null);

  useEffect(() => {
    if (!result || !ownerId || result.competitive === false) return;
    const update = (event: QueueEvent) => {
      if (event.ownerId !== ownerId || event.playId !== result.id) return;
      if (event.status === "saved") {
        setState({ id: result.id, ownerId, status: "saved" });
        void queryClient.invalidateQueries({ queryKey: rankingKeys.all });
      } else if (event.status === "saving") setState({ id: result.id, ownerId, status: "saving" });
      else if (event.status === "queued")
        setState({ id: result.id, ownerId, status: "queued", durable: event.durable ?? true });
      else
        setState({
          id: result.id,
          ownerId,
          status: "error",
          error: event.error ?? "保存できませんでした",
          retryable: event.retryable ?? true,
          durable: event.durable ?? true,
        });
    };
    const unsubscribe = subscribeToPlayResultQueue(update);
    enqueuePlayResult(ownerId, result);
    void flushPlayResultQueue(ownerId);
    return unsubscribe;
  }, [ownerId, queryClient, result]);

  const retrySave = useCallback(async () => {
    if (!result || !ownerId || state?.retryable === false) return;
    setState({ id: result.id, ownerId, status: "saving" });
    await flushPlayResultQueue(ownerId);
  }, [ownerId, result, state?.retryable]);

  return {
    state: result && ownerId && state?.id === result.id && state.ownerId === ownerId ? state : null,
    retrySave,
  };
}
