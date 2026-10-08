import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CompletedPlay } from "@/game/types";
import { rankingKeys } from "./playerRanking";
import {
  enqueuePlayResult,
  flushPlayResultQueue,
  pendingPlayCount,
  subscribeToPlayResultQueue,
  type QueueEvent,
} from "./playResultQueue";

type SaveState = { id: string; status: "saving" | "saved" | "error" | "queued"; error?: string };

export function usePendingPlayResults(ownerId: string | null) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(() => (ownerId ? pendingPlayCount(ownerId) : 0));

  const flush = useCallback(() => {
    if (!ownerId) return Promise.resolve();
    return flushPlayResultQueue(ownerId).then(() => setPending(pendingPlayCount(ownerId)));
  }, [ownerId]);

  useEffect(() => {
    setPending(ownerId ? pendingPlayCount(ownerId) : 0);
    if (!ownerId) return;
    const unsubscribe = subscribeToPlayResultQueue((event) => {
      if (event.ownerId !== ownerId) return;
      setPending(pendingPlayCount(ownerId));
      if (event.status === "saved")
        void queryClient.invalidateQueries({ queryKey: rankingKeys.all });
    });
    const online = () => void flush();
    window.addEventListener("online", online);
    void flush();
    return () => {
      unsubscribe();
      window.removeEventListener("online", online);
    };
  }, [flush, ownerId, queryClient]);

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
        setState({ id: result.id, status: "saved" });
        void queryClient.invalidateQueries({ queryKey: rankingKeys.all });
      } else if (event.status === "saving") setState({ id: result.id, status: "saving" });
      else if (event.status === "queued") setState({ id: result.id, status: "queued" });
      else
        setState({ id: result.id, status: "error", error: event.error ?? "保存できませんでした" });
    };
    const unsubscribe = subscribeToPlayResultQueue(update);
    enqueuePlayResult(ownerId, result);
    void flushPlayResultQueue(ownerId);
    return unsubscribe;
  }, [ownerId, queryClient, result]);

  const retrySave = useCallback(async () => {
    if (!result || !ownerId) return;
    setState({ id: result.id, status: "saving" });
    await flushPlayResultQueue(ownerId);
  }, [ownerId, result]);

  return { state: result && ownerId && state?.id === result.id ? state : null, retrySave };
}
