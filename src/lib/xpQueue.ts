import type { CompletedPlay } from "@/game/types";
import { submitXpReplay } from "./xp.functions";
import { ownerToken } from "./xpClient";
import { displayOutcome, type ConfirmedXpOutcome } from "./xpTypes";
import type { XpOutcome } from "./accountGrowth";
const PREFIX = "pulse-lane:xp-queue:v1:",
  RECEIPT = "pulse-lane:xp-receipt:v1:";
type Pending = {
  owner: string;
  result: CompletedPlay;
  attempts: number;
  next: number;
  paused: boolean;
};
type Event = { owner: string; playId: string; outcome: XpOutcome };
const memory = new Map<string, Pending>(),
  receipts = new Map<string, ConfirmedXpOutcome>(),
  flights = new Map<string, Promise<void>>(),
  listeners = new Set<(e: Event) => void>();
const key = (owner: string, id: string) => `${PREFIX}${owner}:${id}`;
function put(item: Pending) {
  const k = key(item.owner, item.result.id);
  memory.set(k, item);
  try {
    localStorage.setItem(k, JSON.stringify(item));
    return true;
  } catch {
    return false;
  }
}
function remove(item: Pending) {
  const k = key(item.owner, item.result.id);
  memory.delete(k);
  try {
    localStorage.removeItem(k);
  } catch {
    /* Server UUID remains idempotent. */
  }
}
function items(owner: string) {
  const all = new Map<string, Pending>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(`${PREFIX}${owner}:`)) continue;
      try {
        const p = JSON.parse(localStorage.getItem(k) ?? "null") as Pending;
        if (
          p?.owner === owner &&
          k === key(owner, p.result.id) &&
          Number.isSafeInteger(p.attempts) &&
          p.attempts >= 0 &&
          typeof p.paused === "boolean" &&
          Number.isFinite(p.next)
        )
          all.set(k, p);
      } catch {
        /* Isolate damaged entries. */
      }
    }
  } catch {
    /* Storage unavailable. */
  }
  memory.forEach((p, k) => {
    if (p.owner === owner) all.set(k, p);
  });
  return [...all.values()];
}
function emit(owner: string, playId: string, outcome: XpOutcome) {
  listeners.forEach((fn) => fn({ owner, playId, outcome }));
}
function settle(item: Pending, outcome: ConfirmedXpOutcome) {
  remove(item);
  const k = `${RECEIPT}${item.owner}:${item.result.id}`;
  receipts.set(k, outcome);
  // Never restore a claimed confirmed award from editable browser storage.
  // Durable truth is the server ledger; only pending replays live in storage.
  if (receipts.size > 200) receipts.delete(receipts.keys().next().value!);
  emit(item.owner, item.result.id, displayOutcome(outcome));
}
export function xpReceipt(owner: string, id: string): XpOutcome | null {
  const value = receipts.get(`${RECEIPT}${owner}:${id}`);
  return value ? displayOutcome(value) : null;
}
export function subscribeXp(listener: (e: Event) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function enqueueXp(owner: string, result: CompletedPlay) {
  const receipt = xpReceipt(owner, result.id);
  if (receipt) {
    emit(owner, result.id, receipt);
    return;
  }
  if (!result.verification) return;
  const item = items(owner).find((p) => p.result.id === result.id) ?? {
    owner,
    result,
    attempts: 0,
    next: 0,
    paused: false,
  };
  const reason = result.competitive === false ? "practice" : result.verification.reason;
  if (reason) {
    settle(item, { status: "ineligible", reason });
    return;
  }
  if (!result.verification.sessionId) {
    settle(item, { status: "ineligible", reason: "session_unavailable" });
    return;
  }
  const durable = put(item);
  emit(
    owner,
    result.id,
    durable
      ? { status: "pending" }
      : {
          status: "error",
          message:
            "保存領域を利用できません。このタブで再送します。再読み込み前に確認してください。",
          retrying: true,
        },
  );
}
export function pendingXpCount(owner: string) {
  return items(owner).length;
}
export function nextXpRetry(owner: string) {
  const pending = items(owner).filter((i) => !i.paused);
  return pending.length ? Math.min(...pending.map((i) => i.next)) : null;
}
export function rejectPendingXp(owner: string, id: string) {
  const item = items(owner).find((i) => i.result.id === id);
  if (item) settle(item, { status: "ineligible", reason: "verification_failed" });
}
export function flushXp(owner: string, force = false) {
  if (flights.has(owner)) return flights.get(owner)!;
  const flight = (async () => {
    const visited = new Set<string>();
    for (;;) {
      const item = items(owner).find(
        (p) => !visited.has(p.result.id) && (force || (!p.paused && p.next <= Date.now())),
      );
      if (!item) break;
      visited.add(item.result.id);
      try {
        // Both middleware identity and payload owner are checked on the server. An
        // auth switch during await cannot register a former run to the new account.
        const token = await ownerToken(owner);
        emit(owner, item.result.id, { status: "checking" });
        const response = await submitXpReplay({
          data: {
            ownerId: owner,
            playId: item.result.id,
            sessionId: item.result.verification!.sessionId!,
            replay: item.result.verification!.replay,
          },
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
          settle(item, response.outcome);
          continue;
        }
        if (!response.retryable && !["auth", "configuration"].includes(response.code)) {
          settle(item, { status: "ineligible", reason: response.code });
          continue;
        }
        throw new Error(response.code);
      } catch (error) {
        item.attempts++;
        const message = error instanceof Error ? error.message : "network";
        item.paused =
          /configuration|auth|unauthorized|401|403|PGRST202/i.test(message) || item.attempts >= 10;
        item.next = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(item.attempts - 1, 5));
        const durable = put(item);
        emit(owner, item.result.id, {
          status: "error",
          message: item.paused
            ? "ログイン・接続設定を確認して再試行してください。"
            : durable
              ? "通信またはスコア保存の確認を待っています。"
              : "保存領域を利用できないため、このタブを閉じずに再試行してください。",
          retrying: !item.paused,
        });
        break;
      }
    }
  })().finally(() => flights.delete(owner));
  flights.set(owner, flight);
  return flight;
}
