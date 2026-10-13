import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOwnProgress, getXpReceipt } from "./xp.functions";
import { subscribeToXpEvidence } from "./xpEvidenceQueue";
import { ownerTransport } from "./ownerTransport";
import { getOwnCardPreferences, saveOwnCardPreferences } from "./profilePreferences";
import type { AccountGrowthState, CardPreferencePatch, XpOutcome } from "./accountGrowth";

export function useAccountGrowth(
  ownerId: string | null,
  reducedMotion = false,
): AccountGrowthState | null {
  const cache = useQueryClient();
  const key = useMemo(() => ["account-growth", ownerId], [ownerId]);
  const progress = useQuery({
    queryKey: key,
    enabled: Boolean(ownerId),
    queryFn: async () => getOwnProgress({ fetch: await ownerTransport(ownerId!) }),
    staleTime: 30000,
    retry: 1,
  });
  const preferences = useQuery({
    queryKey: ["profile-card", ownerId],
    enabled: Boolean(ownerId && progress.data?.enabled),
    queryFn: () => getOwnCardPreferences(ownerId!),
    staleTime: 300000,
    retry: 1,
  });
  const [rewards, setRewards] = useState<{
    ownerId: string | null;
    values: Record<string, XpOutcome>;
  }>({ ownerId, values: {} });
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(
    (playId?: string) => {
      if (!ownerId) return;
      void cache.invalidateQueries({ queryKey: key });
      if (playId)
        void ownerTransport(ownerId)
          .then((fetch) => getXpReceipt({ data: { playId }, fetch }))
          .then((receipt) => {
            if (receipt)
              setRewards((current) => ({
                ownerId,
                values: {
                  ...(current.ownerId === ownerId ? current.values : {}),
                  [playId]: receipt.outcome,
                },
              }));
          })
          .catch((error) =>
            setRewards((current) => ({
              ownerId,
              values: {
                ...(current.ownerId === ownerId ? current.values : {}),
                [playId]: {
                  status: "error",
                  message: error instanceof Error ? error.message : "XP確認に失敗しました",
                  retrying: true,
                },
              },
            })),
          );
    },
    [ownerId, key, cache],
  );
  useEffect(
    () =>
      subscribeToXpEvidence((event) => {
        if (event.ownerId !== ownerId) return;
        setRewards((current) => ({
          ownerId,
          values: {
            ...(current.ownerId === ownerId ? current.values : {}),
            [event.sessionId]: event.outcome,
          },
        }));
        if (event.outcome.status === "awarded") void cache.invalidateQueries({ queryKey: key });
      }),
    [ownerId, key, cache],
  );
  const saveProfile = async (patch: CardPreferencePatch) => {
    if (!ownerId || !preferences.data) throw new Error("設定を再読み込みしてください");
    setSaving(true);
    try {
      await saveOwnCardPreferences(ownerId, preferences.data, patch);
      await preferences.refetch();
      await progress.refetch();
    } finally {
      setSaving(false);
    }
  };
  if (!ownerId) return null;
  return {
    ownerId,
    enabled: progress.data?.enabled ?? Boolean(progress.error),
    growth: progress.data?.growth ?? null,
    rules: progress.data?.rules ?? [],
    boostEnabled: false,
    reducedMotion,
    rewards: rewards.ownerId === ownerId ? rewards.values : {},
    refresh,
    ...(progress.error ? { error: progress.error.message } : {}),
    ...(preferences.data ? { profile: preferences.data } : {}),
    ...(preferences.error ? { profileError: preferences.error.message } : {}),
    savingProfile: saving,
    saveProfile,
  };
}
