import { WAVEFORM_VERSION, MAX_AUDIO_MS, type WaveformPeaks } from "./waveform";
const LIMIT = 32 * 1024 * 1024,
  MAX_ENTRIES = 256;
const memory = new Map<string, WaveformPeaks>();
let usage = 0;
function remember(key: string, value: WaveformPeaks) {
  const prior = memory.get(key);
  if (prior) usage -= prior.minMax.byteLength;
  memory.delete(key);
  memory.set(key, value);
  usage += value.minMax.byteLength;
  while (usage > LIMIT || memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    usage -= memory.get(oldest)!.minMax.byteLength;
    memory.delete(oldest);
  }
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open("pulse-waveform-peaks", 2);
    request.onupgradeneeded = () => {
      // Version 1 mixed peaks with LRU metadata and required cloning all peaks just
      // to evict entries. These are derived cache records, so regenerate on upgrade.
      if (request.result.objectStoreNames.contains("peaks"))
        request.result.deleteObjectStore("peaks");
      request.result.createObjectStore("peaks", { keyPath: "key" });
      request.result.createObjectStore("lru", { keyPath: "key" });
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("IDB_BLOCKED"));
    };
  });
}
type Metadata = { key: string; accessedAt: number; bytes: number };
function valid(value: WaveformPeaks) {
  return (
    value?.version === WAVEFORM_VERSION &&
    value.minMax instanceof Int16Array &&
    value.minMax.length % 2 === 0 &&
    value.minMax.byteLength <= Math.ceil(MAX_AUDIO_MS / 10) * 4 &&
    value.minMax.length / 2 >= Math.ceil(value.durationMs / 10) &&
    value.minMax.length / 2 <= Math.ceil((value.durationMs + 1) / 10) &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs > 0 &&
    value.durationMs <= MAX_AUDIO_MS &&
    Number.isInteger(value.sampleRate) &&
    value.sampleRate >= 8000 &&
    value.sampleRate <= 192000
  );
}
async function touch(key: string) {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction("lru", "readwrite"),
        store = tx.objectStore("lru"),
        read = store.get(key);
      read.onsuccess = () => {
        const item = read.result as Metadata | undefined;
        if (item) store.put({ ...item, accessedAt: Date.now() });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* Persistence is optional. */
  } finally {
    db?.close();
  }
}
export async function readWaveformCache(key: string): Promise<WaveformPeaks | null> {
  const hit = memory.get(key);
  if (hit) {
    remember(key, hit);
    void touch(key);
    return hit;
  }
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const value = await new Promise<{ key: string; peaks: WaveformPeaks } | undefined>(
      (resolve, reject) => {
        const request = db!.transaction("peaks", "readonly").objectStore("peaks").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    if (value && valid(value.peaks)) {
      remember(key, value.peaks);
      void touch(key);
      return value.peaks;
    }
  } catch {
    /* Private mode and quota errors fall back to memory. */
  } finally {
    db?.close();
  }
  return null;
}
export async function writeWaveformCache(key: string, peaks: WaveformPeaks) {
  if (!valid(peaks)) return;
  remember(key, peaks);
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(["peaks", "lru"], "readwrite"),
        values = tx.objectStore("peaks"),
        lru = tx.objectStore("lru"),
        read = lru.getAll();
      read.onsuccess = () => {
        let total = peaks.minMax.byteLength,
          count = 1;
        for (const entry of (read.result as Metadata[])
          .filter((item) => item.key !== key)
          .sort((a, b) => b.accessedAt - a.accessedAt)) {
          if (total + entry.bytes > LIMIT || count >= MAX_ENTRIES) {
            values.delete(entry.key);
            lru.delete(entry.key);
          } else {
            total += entry.bytes;
            count++;
          }
        }
        values.put({ key, peaks });
        lru.put({ key, accessedAt: Date.now(), bytes: peaks.minMax.byteLength } satisfies Metadata);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* Raw audio/PCM are never persisted; a disk cache is optional. */
  } finally {
    db?.close();
  }
}
export function releasePrivateWaveforms(scope: string) {
  for (const [key, value] of memory)
    if (key.startsWith(`${scope}:`)) {
      memory.delete(key);
      usage -= value.minMax.byteLength;
    }
}
