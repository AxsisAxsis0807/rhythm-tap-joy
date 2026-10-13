import { useCallback, useEffect, useRef, useState } from "react";
import { beginPlay, finishPlay, getXpReceipt } from "./xp.functions";
import { ownerTransport } from "./ownerTransport";
import {
  enqueueXpEvidence,
  flushXpEvidence,
  pendingXpEvidence,
  subscribeToXpEvidence,
  publishXpOutcome,
  EvidenceDeliveryError,
} from "./xpEvidenceQueue";
import type { ReplayEvidence } from "@/game/replay";
import type { RunConfiguration } from "@/game/runConfiguration";
import { replaySchema } from "./xpContract";

export function usePlaySession(ownerId: string | null, evidence: ReplayEvidence | null) {
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const session = useRef<{ ownerId: string; id: string; expiresAt: string } | null>(null);
  const reason = useRef("承認されたRevisionの通常プレイのみXP対象です。");
  const [storageWarning, setStorageWarning] = useState(false);
  const flush = useXpEvidenceDelivery(ownerId, false);
  const prepare = useCallback(
    async (configuration: RunConfiguration) => {
      session.current = null;
      setStorageWarning(false);
      reason.current = "承認されたRevisionの通常プレイのみXP対象です。";
      if (!ownerId || !configuration.revisionId) return undefined;
      try {
        const transport = await ownerTransport(ownerId);
        const result = await beginPlay({
          data: {
            requestNonce: crypto.randomUUID(),
            revisionId: configuration.revisionId,
            configuration,
          },
          fetch: transport,
          signal: AbortSignal.timeout(4000),
        });
        if (currentOwner.current !== ownerId) throw new Error("アカウントが変更されました");
        if (result.enabled && result.sessionId && result.expiresAt) {
          session.current = { ownerId, id: result.sessionId, expiresAt: result.expiresAt };
          return result.sessionId;
        }
        reason.current = result.reason ?? "現在このプレイはXP対象外です。";
      } catch {
        reason.current = "XP受付に接続できなかったため、今回はXPなしで開始しました。";
      }
      return undefined;
    },
    [ownerId],
  );
  useEffect(() => {
    if (!evidence) return;
    const started = session.current;
    if (!started || started.id !== evidence.runId) {
      if (ownerId)
        publishXpOutcome(ownerId, evidence.runId, { status: "ineligible", reason: reason.current });
      return;
    }
    void enqueueXpEvidence(started.ownerId, started.id, started.expiresAt, evidence)
      .then(({ durable }) => {
        setStorageWarning(!durable);
        return flush();
      })
      .catch((error) =>
        publishXpOutcome(started.ownerId, started.id, {
          status: "error",
          message: error instanceof Error ? error.message : "入力記録を保存できませんでした",
          retrying: false,
        }),
      );
  }, [evidence, ownerId, flush]);
  return { prepare, storageWarning, flush };
}

export function useXpEvidenceDelivery(ownerId: string | null, background = true) {
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const flush = useCallback(
    async (force = false) => {
      if (!ownerId) return;
      await flushXpEvidence(
        ownerId,
        () => currentOwner.current,
        async (envelope) => {
          const transport = await ownerTransport(ownerId);
          if (currentOwner.current !== ownerId)
            throw new EvidenceDeliveryError("アカウントが変更されました", false);
          const old = await getXpReceipt({
            data: { playId: envelope.sessionId },
            fetch: transport,
          });
          if (old && old.outcome.status !== "pending" && old.outcome.status !== "checking")
            return old.outcome;
          if (!old && envelope.expiresAt <= Date.now())
            return {
              status: "ineligible",
              reason: "サーバーへの初回受付期限（24時間）を過ぎました。",
            };
          try {
            return (
              await finishPlay({
                data: {
                  sessionId: envelope.sessionId,
                  evidence: replaySchema.parse(JSON.parse(envelope.evidenceJson)),
                },
                fetch: transport,
              })
            ).outcome;
          } catch (error) {
            const message = error instanceof Error ? error.message : "XP確認に失敗しました";
            throw new EvidenceDeliveryError(message, !/23505|22023|42501/.test(message));
          }
        },
        force,
      );
    },
    [ownerId],
  );
  useEffect(() => {
    if (!ownerId || !background) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      clearTimeout(timer);
      if (disposed) return;
      await flush();
      const pending = await pendingXpEvidence(ownerId);
      clearTimeout(timer);
      if (disposed || !pending.length) return;
      const next = Math.min(...pending.map((x) => x.nextAttemptAt));
      timer = setTimeout(() => void run(), Math.min(300000, Math.max(2000, next - Date.now())));
    };
    const unsubscribe = subscribeToXpEvidence((event) => {
      if (event.ownerId === ownerId) {
        clearTimeout(timer);
        timer = setTimeout(() => void run(), 3000);
      }
    });
    const online = () => void run();
    window.addEventListener("online", online);
    void run();
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
      window.removeEventListener("online", online);
    };
  }, [ownerId, flush, background]);
  return flush;
}
