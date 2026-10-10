import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountGrowthState, XpOutcome } from "./accountGrowth";
import { XP_CLIENT_ENABLED, loadAccountGrowth, saveAccountVisibility } from "./xpClient";
import { subscribeXp, flushXp, nextXpRetry, pendingXpCount } from "./xpQueue";
import { subscribeToPlayResultQueue } from "./playResultQueue";
import { rejectPendingXp } from "./xpQueue";
import type { GrowthResponse, AccountVisibility } from "./xpTypes";
/** Production provider: no fixture values, and stale owner responses are ignored. */
export function useAccountGrowth(owner: string | null) {
  const [state, setState] = useState<{
    owner: string;
    data?: GrowthResponse;
    error?: string;
    rewards: Record<string, XpOutcome>;
  } | null>(null);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    if (!owner || !XP_CLIENT_ENABLED) return;
    const request = ++requestRef.current;
    try {
      const data = await loadAccountGrowth(owner);
      if (ownerRef.current === owner && requestRef.current === request)
        setState((s) => ({ owner, data, rewards: s?.owner === owner ? s.rewards : {} }));
    } catch {
      if (ownerRef.current === owner && requestRef.current === request)
        setState((s) => ({
          owner,
          ...(s?.owner === owner && s.data ? { data: s.data } : {}),
          rewards: s?.owner === owner ? s.rewards : {},
          error: "成長情報の読み込みに失敗しました",
        }));
    }
  }, [owner]);
  const refresh = useCallback(
    (playId?: string) => {
      if (owner) {
        if (playId) void flushXp(owner, true);
        void load();
      }
    },
    [owner, load],
  );
  useEffect(() => {
    if (!owner || !XP_CLIENT_ENABLED) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (disposed) return;
      const next = nextXpRetry(owner);
      if (next !== null)
        timer = setTimeout(
          () => void flushXp(owner).then(schedule),
          Math.max(100, next - Date.now()),
        );
    };
    const unsubscribe = subscribeXp((e) => {
      if (e.owner !== owner || ownerRef.current !== owner) return;
      setState((s) => ({
        ...(s?.owner === owner ? s : { owner, rewards: {} }),
        rewards: { ...(s?.owner === owner ? s.rewards : {}), [e.playId]: e.outcome },
      }));
      if (e.outcome.status === "awarded") void load();
      schedule();
    });
    const scoreUnsubscribe = subscribeToPlayResultQueue((e) => {
      if (e.ownerId !== owner) return;
      if (e.status === "saved") void flushXp(owner, true).then(schedule);
      else if (e.status === "failed" && e.retryable === false) rejectPendingXp(owner, e.playId);
    });
    const online = () => void flushXp(owner, true).then(schedule);
    const storage = () => {
      void load();
      void flushXp(owner).then(schedule);
    };
    window.addEventListener("online", online);
    window.addEventListener("storage", storage);
    void load();
    void flushXp(owner, true).then(schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      scoreUnsubscribe();
      window.removeEventListener("online", online);
      window.removeEventListener("storage", storage);
    };
  }, [owner, load]);
  const updateVisibility = useCallback(
    async (value: AccountVisibility) => {
      if (!owner) throw new Error("Authentication required");
      const visibility = await saveAccountVisibility(owner, value);
      if (ownerRef.current !== owner) return;
      setState((s) =>
        s?.owner === owner && s.data
          ? {
              ...s,
              data: {
                ...s.data,
                visibility,
                growth: { ...s.data.growth, levelPublic: visibility.levelPublic },
              },
            }
          : s,
      );
    },
    [owner],
  );
  if (!owner || !XP_CLIENT_ENABLED) return null;
  const data = state?.owner === owner ? state.data : undefined;
  const value: AccountGrowthState = {
    enabled: data?.enabled ?? true,
    ownerId: owner,
    growth: data?.growth ?? null,
    rules: data?.rules ?? [],
    rewards: state?.owner === owner ? state.rewards : {},
    boostEnabled: false,
    refresh,
    pendingXp: pendingXpCount(owner),
    ...(state?.owner === owner && state.error ? { error: state.error } : {}),
    ...(data ? { visibility: data.visibility, updateVisibility } : {}),
    ...(data?.supporter ? { supporter: data.supporter } : {}),
  };
  return value;
}
