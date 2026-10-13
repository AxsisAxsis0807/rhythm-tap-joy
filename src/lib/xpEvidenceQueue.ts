import { MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS, type ReplayEvidence } from "@/game/replay";
import type { XpOutcome } from "./accountGrowth";

const DATABASE = "pulse-lane:xp-evidence:v1";
const STORE = "evidence";
const memory = new Map<string, EvidenceEnvelope>();
const subscribers = new Set<(event: EvidenceQueueEvent) => void>();
const flushes = new Map<string, Promise<void>>();
let database: Promise<IDBDatabase> | undefined;

export interface EvidenceEnvelope {
  key: string;
  ownerId: string;
  sessionId: string;
  expiresAt: number;
  /** Preserve exactly the original envelope across retries and browser reloads. */
  evidenceJson: string;
  attempts: number;
  nextAttemptAt: number;
  durable: boolean;
}
export interface EvidenceQueueEvent {
  ownerId: string;
  sessionId: string;
  durable: boolean;
  outcome: XpOutcome;
}

export class EvidenceConflictError extends Error {}
export class EvidenceDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("ownerId", "ownerId");
    };
    request.onerror = () => reject(request.error ?? new Error("XP evidence storage failed"));
    request.onblocked = () => reject(new Error("XP evidence storage is blocked"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}

async function readOwner(ownerId: string): Promise<EvidenceEnvelope[]> {
  const rows = new Map<string, EvidenceEnvelope>();
  try {
    const db = await openDatabase();
    const stored = await new Promise<EvidenceEnvelope[]>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).index("ownerId").getAll(ownerId);
      request.onsuccess = () => resolve(request.result as EvidenceEnvelope[]);
      request.onerror = () => reject(request.error);
    });
    for (const row of stored) if (row.ownerId === ownerId) rows.set(row.key, row);
  } catch {
    // In-memory entries carry durable:false, surfaced to the result UI.
  }
  for (const row of memory.values()) if (row.ownerId === ownerId) rows.set(row.key, row);
  return [...rows.values()].sort((a, b) => a.expiresAt - b.expiresAt);
}

async function persist(envelope: EvidenceEnvelope): Promise<boolean> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get(envelope.key);
      request.onsuccess = () => {
        const previous = request.result as EvidenceEnvelope | undefined;
        if (previous && previous.evidenceJson !== envelope.evidenceJson) {
          transaction.abort();
          reject(new EvidenceConflictError("同じプレイに異なる入力記録は送信できません"));
        } else store.put({ ...envelope, durable: true });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("XP evidence transaction aborted"));
    });
    return true;
  } catch (error) {
    if (error instanceof EvidenceConflictError) throw error;
    return false;
  }
}

async function remove(envelope: EvidenceEnvelope) {
  memory.delete(envelope.key);
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(envelope.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // A persisted copy can safely redeliver only this same session/payload.
  }
}

function emit(envelope: EvidenceEnvelope, outcome: XpOutcome) {
  for (const subscriber of subscribers)
    subscriber({
      ownerId: envelope.ownerId,
      sessionId: envelope.sessionId,
      durable: envelope.durable,
      outcome,
    });
}

export function subscribeToXpEvidence(listener: (event: EvidenceQueueEvent) => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export async function enqueueXpEvidence(
  ownerId: string,
  sessionId: string,
  expiresAt: string,
  evidence: ReplayEvidence,
): Promise<{ durable: boolean }> {
  const expiration = Date.parse(expiresAt);
  if (!ownerId || evidence.runId !== sessionId || !Number.isFinite(expiration))
    throw new Error("XP sessionと入力記録が一致しません");
  const evidenceJson = JSON.stringify(evidence);
  if (
    evidence.status !== "complete" ||
    evidence.events.length > MAX_REPLAY_EVENTS ||
    new TextEncoder().encode(evidenceJson).byteLength > MAX_REPLAY_BYTES
  )
    throw new Error(
      "入力記録の上限を超えたため、このプレイのXPは対象外です。Scoreは保存できます。",
    );
  const key = `${ownerId}:${sessionId}`;
  const previous = (await readOwner(ownerId)).find((entry) => entry.key === key);
  if (previous && (previous.evidenceJson !== evidenceJson || previous.expiresAt !== expiration))
    throw new EvidenceConflictError("同じプレイに異なる入力記録は送信できません");
  const envelope: EvidenceEnvelope = previous ?? {
    key,
    ownerId,
    sessionId,
    expiresAt: expiration,
    evidenceJson,
    attempts: 0,
    nextAttemptAt: 0,
    durable: false,
  };
  envelope.durable = await persist(envelope);
  memory.set(key, envelope);
  emit(envelope, { status: "pending" });
  return { durable: envelope.durable };
}

/** currentOwner is checked after asynchronous storage work and before each request.
 * send must additionally pin the captured owner's bearer token at the transport. */
export function flushXpEvidence(
  ownerId: string,
  currentOwner: () => string | null,
  send: (envelope: EvidenceEnvelope) => Promise<XpOutcome>,
  force = false,
): Promise<void> {
  const existing = flushes.get(ownerId);
  if (existing) return existing;
  const flush = (async () => {
    for (const envelope of await readOwner(ownerId)) {
      if (currentOwner() !== ownerId) return;
      if (!force && envelope.nextAttemptAt > Date.now()) continue;
      emit(envelope, { status: "checking" });
      try {
        const outcome = await send(envelope);
        emit(envelope, outcome);
        if (outcome.status === "awarded" || outcome.status === "ineligible") {
          await remove(envelope);
          continue;
        }
      } catch (error) {
        const retryable = !(error instanceof EvidenceDeliveryError) || error.retryable;
        emit(envelope, {
          status: "error",
          message: error instanceof Error ? error.message : "XP確認に失敗しました",
          retrying: retryable,
        });
        if (!retryable) {
          envelope.nextAttemptAt = Number.MAX_SAFE_INTEGER;
          await persist(envelope);
          continue;
        }
      }
      envelope.attempts++;
      envelope.nextAttemptAt =
        Date.now() + Math.min(300_000, 2000 * 2 ** Math.min(envelope.attempts, 8));
      envelope.durable = await persist(envelope);
      memory.set(envelope.key, envelope);
    }
  })().finally(() => {
    flushes.delete(ownerId);
  });
  flushes.set(ownerId, flush);
  return flush;
}

export async function pendingXpEvidence(ownerId: string) {
  return (await readOwner(ownerId)).map(({ sessionId, durable, nextAttemptAt }) => ({
    sessionId,
    durable,
    nextAttemptAt,
  }));
}

export function publishXpOutcome(ownerId: string, sessionId: string, outcome: XpOutcome) {
  for (const subscriber of subscribers) subscriber({ ownerId, sessionId, outcome, durable: true });
}
