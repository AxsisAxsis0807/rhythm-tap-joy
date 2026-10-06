import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CompletedPlay } from "@/game/types";
import { rankingKeys, recordCompletedPlay } from "./playerRanking";

type SaveState = { id: string; status: "saving" | "saved" | "error"; error?: string };

export function usePlayResult(result: CompletedPlay | null, ownerId: string | null) {
  const queryClient = useQueryClient();
  const attempts = useRef(new Map<string, Promise<void>>());
  const [state, setState] = useState<SaveState | null>(null);

  const save = useCallback(
    (completed: CompletedPlay, owner: string) => {
      const key = `${owner}:${completed.id}`;
      const existing = attempts.current.get(key);
      if (existing) return existing;
      const pending = recordCompletedPlay(completed, owner)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: rankingKeys.all });
        })
        .catch((error: unknown) => {
          attempts.current.delete(key);
          throw error;
        });
      attempts.current.set(key, pending);
      return pending;
    },
    [queryClient],
  );

  const attempt = useCallback(async () => {
    if (!result || !ownerId) return;
    setState({ id: result.id, status: "saving" });
    try {
      await save(result, ownerId);
      setState({ id: result.id, status: "saved" });
    } catch (error) {
      setState({
        id: result.id,
        status: "error",
        error: error instanceof Error ? error.message : "保存できませんでした",
      });
    }
  }, [result, ownerId, save]);

  useEffect(() => {
    if (!result || !ownerId) return;
    let active = true;
    setState({ id: result.id, status: "saving" });
    void save(result, ownerId).then(
      () => {
        if (active) setState({ id: result.id, status: "saved" });
      },
      (error: unknown) => {
        if (active)
          setState({
            id: result.id,
            status: "error",
            error: error instanceof Error ? error.message : "保存できませんでした",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [result, ownerId, save]);

  return { state: result && ownerId && state?.id === result.id ? state : null, retrySave: attempt };
}
