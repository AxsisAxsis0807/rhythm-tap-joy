import type { RunConfiguration } from "./runConfiguration";

export const REPLAY_VERSION = "pulse-replay-v1";
export const MAX_REPLAY_EVENTS = 200_000;
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

interface GameplayEventTime {
  readonly sequence: number;
  /** Uncalibrated song time; input edges use AudioClock.nowAt(DOM timestamp). */
  readonly songTime: number;
  /** AudioClock.now() when the callback ran, for delayed-edge and resume validation. */
  readonly clockTime: number;
  /** Monotonic wall time since START; includes pauses, unlike song time. */
  readonly elapsedMs: number;
}
export type GameplayEvent = GameplayEventTime &
  (
    | {
        readonly type: "press" | "release" | "cancel";
        readonly source: number;
        readonly lane: number;
      }
    | { readonly type: "advance" | "clear" | "pause" | "resume" | "complete" }
  );
export type GameplayEventInput = GameplayEvent extends infer E
  ? E extends GameplayEvent
    ? Omit<E, "sequence">
    : never
  : never;
export type ReplayStatus = "complete" | "event-limit" | "byte-limit";
export interface ReplayEvidence {
  readonly version: typeof REPLAY_VERSION;
  readonly runId: string;
  readonly configuration: RunConfiguration;
  readonly status: ReplayStatus;
  readonly events: readonly GameplayEvent[];
}

/** Independent of the short-lived overlay history. Overflow never drops gameplay input. */
export class ReplayRecorder {
  private readonly events: GameplayEvent[] = [];
  private sequence = 0;
  private bytes: number;
  private status: ReplayStatus = "complete";
  private readonly encoder = new TextEncoder();
  constructor(
    readonly runId: string,
    readonly configuration: RunConfiguration,
    private readonly limits = { maxEvents: MAX_REPLAY_EVENTS, maxBytes: MAX_REPLAY_BYTES },
  ) {
    this.bytes = this.encoder.encode(
      JSON.stringify({
        version: REPLAY_VERSION,
        runId,
        configuration,
        status: "complete",
        events: [],
      }),
    ).byteLength;
    if (this.bytes > limits.maxBytes) this.status = "byte-limit";
  }
  get recording() {
    return this.status === "complete";
  }
  get replayStatus() {
    return this.status;
  }
  /** Always returns the event for the live core, even after evidence exceeded its bounds. */
  append(input: GameplayEventInput): GameplayEvent {
    const event: GameplayEvent = Object.freeze({ ...input, sequence: ++this.sequence });
    if (!this.recording) return event;
    if (this.events.length >= this.limits.maxEvents) {
      this.status = "event-limit";
      return event;
    }
    const bytes =
      this.encoder.encode(JSON.stringify(event)).byteLength + (this.events.length ? 1 : 0);
    if (this.bytes + bytes > this.limits.maxBytes) {
      this.status = "byte-limit";
      return event;
    }
    this.bytes += bytes;
    this.events.push(event);
    return event;
  }
  snapshot(): ReplayEvidence {
    return Object.freeze({
      version: REPLAY_VERSION,
      runId: this.runId,
      configuration: this.configuration,
      status: this.status,
      events: Object.freeze([...this.events]),
    });
  }
}
