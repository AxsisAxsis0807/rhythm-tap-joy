export const DIRECTIONS = ["← LEFT", "↓ DOWN", "↑ UP", "→ RIGHT"];
/** Event timestamps use the performance timeline (older WebKit may use epoch ms). */
export function inputTime(stamp = performance.now(), now = performance.now()) {
  const normalized = stamp > 1e12 ? stamp - performance.timeOrigin : stamp;
  return Number.isFinite(normalized) && normalized > 0 && normalized <= now + 1
    ? Math.min(normalized, now)
    : now;
}
export type InputKind = "Touch" | "Keyboard";
export interface InputBar {
  id: number;
  source: string;
  lane: number;
  kind: InputKind;
  start: number;
  end?: number;
  cancelled?: boolean;
  outcome?: string;
}
/** Synchronous ordered edges: taps never depend on a render/frame snapshot. */
export class InputLedger {
  readonly sources = new Map<string, InputBar>();
  readonly activeLanes = new Set<number>();
  bars: InputBar[] = [];
  received = 0;
  accepted = 0;
  private sequence = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  private changed() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
  press(source: string, lane: number, stamp?: number) {
    this.received++;
    if (this.sources.has(source) || !Number.isInteger(lane) || lane < 0 || lane > 3) return null;
    const bar: InputBar = {
      id: ++this.sequence,
      source,
      lane,
      kind: source.startsWith("key:") ? "Keyboard" : "Touch",
      start: inputTime(stamp),
    };
    this.sources.set(source, bar);
    this.activeLanes.add(lane);
    this.bars.push(bar);
    this.accepted++;
    this.prune(bar.start);
    this.changed();
    return bar;
  }
  release(source: string, stamp?: number, cancelled = false) {
    const bar = this.sources.get(source);
    if (!bar) return null;
    bar.end = Math.max(bar.start, inputTime(stamp));
    bar.cancelled = cancelled;
    this.sources.delete(source);
    if (![...this.sources.values()].some((b) => b.lane === bar.lane))
      this.activeLanes.delete(bar.lane);
    this.prune(bar.end);
    this.changed();
    return bar;
  }
  clear(stamp?: number) {
    for (const source of [...this.sources.keys()]) this.release(source, stamp, true);
  }
  prune(now: number) {
    // Keep active records even during long holds, and at most 256 released bars / 10s.
    const released = this.bars
      .filter((b) => b.end !== undefined && now - b.end < 10000)
      .slice(-256);
    this.bars = [...released, ...this.sources.values()].sort((a, b) => a.id - b.id);
  }
}
export function laneAt(clientX: number, left: number, width: number) {
  return Math.min(3, Math.max(0, Math.floor(((clientX - left) / width) * 4)));
}
