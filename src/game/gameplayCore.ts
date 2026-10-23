import {
  applyJudgement,
  buildRuntimeNotes,
  createPlayState,
  findHittableNote,
  judgeDelta,
} from "./engine";
import { TIMING_EPSILON } from "./judgementPolicy";
import type { GameplayEvent } from "./replay";
import type { RunConfiguration } from "./runConfiguration";
import type { Chart, Judgement, PlayState, RuntimeNote } from "./types";

export interface HeldInterval {
  readonly noteId: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly completed: boolean;
}

/** DOM-free, ordered gameplay transitions shared by the live run and evidence verification.
 * advance is explicit: moving auto-miss into press would change existing dense-chart scores.
 */
export class GameplayCore {
  readonly notes: RuntimeNote[];
  readonly play = createPlayState();
  readonly hitHeadIds = new Set<number>();
  readonly successfulHoldIds = new Set<number>();
  readonly heldIntervals: HeldInterval[] = [];
  readonly sources = new Map<number, number>();
  private readonly heldNotes = new Map<number, RuntimeNote>();
  private readonly holdStartedAt = new Map<number, number>();
  private missCursor = 0;
  private state: "playing" | "paused" | "complete" = "playing";

  constructor(
    chart: Chart,
    readonly configuration: RunConfiguration,
  ) {
    // Runtime notes are newly allocated: later metadata/selection changes cannot mutate this run.
    this.notes = buildRuntimeNotes(chart);
  }

  process(
    event: GameplayEvent,
  ): Judgement | "outside-window" | "inactive" | "duplicate" | undefined {
    if (this.state === "complete") return "inactive";
    const time = event.songTime;
    const calibratedTime = time + this.configuration.timingOffsetMs / 1000;
    switch (event.type) {
      case "press": {
        if (this.state !== "playing") return "inactive";
        if (this.sources.has(event.source)) return "duplicate";
        if (!Number.isInteger(event.lane) || event.lane < 0 || event.lane > 3) return "inactive";
        this.sources.set(event.source, event.lane);
        const note = findHittableNote(
          this.notes,
          event.lane,
          calibratedTime,
          this.configuration.windows,
          this.configuration.judgementPolicyId,
        );
        if (!note) return "outside-window";
        const delta = calibratedTime - note.time;
        const judgement = judgeDelta(delta, this.configuration.windows);
        if (!judgement) return "outside-window";
        note.judged = true;
        note.judgement = judgement;
        if (judgement !== "MISS") {
          this.hitHeadIds.add(note.id);
          if (note.kind === "hold") {
            note.holding = true;
            this.heldNotes.set(event.lane, note);
            this.holdStartedAt.set(note.id, calibratedTime);
          }
        }
        applyJudgement(
          this.play,
          judgement,
          delta * 1000,
          this.configuration.scoreRules,
          calibratedTime,
        );
        return judgement;
      }
      case "release":
      case "cancel": {
        const lane = this.sources.get(event.source);
        if (lane === undefined) return undefined;
        this.sources.delete(event.source);
        if ([...this.sources.values()].includes(lane)) return undefined;
        const held = this.heldNotes.get(lane);
        if (!held) return undefined;
        const failed =
          event.type === "cancel" ||
          (held.endTime !== undefined &&
            calibratedTime < held.endTime - this.configuration.windows.good - TIMING_EPSILON);
        this.endHold(held, calibratedTime, !failed);
        return undefined;
      }
      case "clear":
        this.clear(time);
        return undefined;
      case "pause":
        this.clear(time);
        this.state = "paused";
        return undefined;
      case "resume":
        this.state = "playing";
        return undefined;
      case "advance":
        if (this.state === "playing") this.advance(time);
        return undefined;
      case "complete":
        this.clear(time);
        this.state = "complete";
        return undefined;
    }
  }

  private endHold(note: RuntimeNote, time: number, completed: boolean) {
    if (!completed) {
      note.judgement = "MISS";
      applyJudgement(this.play, "MISS", 0, this.configuration.scoreRules, time);
    } else {
      this.successfulHoldIds.add(note.id);
    }
    this.heldIntervals.push(
      Object.freeze({
        noteId: note.id,
        startedAt: this.holdStartedAt.get(note.id) ?? note.time,
        endedAt: time,
        completed,
      }),
    );
    this.holdStartedAt.delete(note.id);
    note.holding = false;
    this.heldNotes.delete(note.lane);
  }

  private clear(time: number) {
    this.sources.clear();
    for (const note of this.heldNotes.values()) this.endHold(note, time, false);
  }

  private advance(time: number) {
    for (const note of this.heldNotes.values()) {
      if (note.endTime !== undefined && time >= note.endTime)
        this.endHold(note, note.endTime, true);
    }
    while (this.missCursor < this.notes.length) {
      const note = this.notes[this.missCursor]!;
      if (note.judged) {
        this.missCursor++;
        continue;
      }
      if (time - note.time <= this.configuration.windows.miss + TIMING_EPSILON) break;
      note.judged = true;
      note.judgement = "MISS";
      applyJudgement(this.play, "MISS", 0, this.configuration.scoreRules, time);
      this.missCursor++;
    }
  }

  snapshotPlay(): PlayState {
    return {
      ...this.play,
      counts: { ...this.play.counts },
      timingErrorsMs: [...this.play.timingErrorsMs],
      ...(this.play.lastJudgement ? { lastJudgement: { ...this.play.lastJudgement } } : {}),
    };
  }
}
