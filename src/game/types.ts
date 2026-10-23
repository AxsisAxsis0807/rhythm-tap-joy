import type { RunConfiguration } from "./runConfiguration";
import type { ReplayStatus } from "./replay";

export type { PlayStyleId, JudgementPolicyId } from "./judgementPolicy";
export type { VisualModeId } from "./modes";
export type { RunConfiguration } from "./runConfiguration";

/**
 * Core data types for the rhythm game.
 * Chart data is intentionally decoupled from engine/rendering so a chart
 * editor (or JSON files fetched at runtime) can be added later.
 */

/** Native holds retain their existing head and early-release scoring semantics. */
export type NoteKind = "tap" | "hold";

/** A single note as authored in a chart (musical time, in beats). */
export interface ChartNote {
  /** Beat position from the start of the chart (0 = first beat). */
  beat: number;
  /** Lane index, 0-based. Lane count comes from the chart. */
  lane: number;
  kind: NoteKind;
  /** Length in beats. Reserved for hold notes. */
  lengthBeats?: number;
}

/** A chart / beatmap: audio reference + timing + notes. */
export interface Chart {
  id: string;
  /** Null/absent for legacy charts without a canonical server revision. */
  revisionId?: string | null;
  chartParserVersion?: string;
  title: string;
  artist: string;
  /** Path or URL to the audio file. */
  audioUrl: string;
  bpm: number;
  /** Seconds added to every note time (audio-to-chart alignment). */
  offset: number;
  /** Number of lanes (4K today, extendable). */
  laneCount: number;
  difficultyName: string;
  notes: ChartNote[];
  /** Present only for charts authored in FNF format, independent of selected skin. */
  fnf?: {
    playerSide: "left" | "right";
    left: ChartNote[];
    right: ChartNote[];
  };
}

/** A note prepared for gameplay: absolute seconds + runtime state. */
export interface RuntimeNote {
  id: number;
  /** Absolute time in song seconds when the note must be hit. */
  time: number;
  lane: number;
  kind: NoteKind;
  /** Absolute release time for hold notes. */
  endTime?: number;
  holding?: boolean;
  judged: boolean;
  judgement?: Judgement;
}

export type Judgement = "PERFECT" | "GREAT" | "GOOD" | "MISS";

/** Timing windows in seconds (absolute time difference). */
export interface JudgementWindows {
  perfect: number;
  great: number;
  good: number;
  /** Past this the note is simply missed (never consumed by an input). */
  miss: number;
}

export interface ScoreRules {
  base: Record<Exclude<Judgement, "MISS">, number>;
  /** Extra points per combo step, capped by maxComboBonus. */
  comboBonus: number;
  maxComboBonus: number;
}

export interface PlayState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  lastJudgement?: { judgement: Judgement; deltaMs: number; at: number };
  timingErrorsMs: number[];
}

/** Immutable snapshot taken only on normal completion. */
export interface CompletedPlay {
  id: string;
  songId: string;
  play: PlayState;
  /** Practice/modifier runs must never enter competitive persistence. */
  competitive?: boolean;
  configuration?: RunConfiguration;
  /** Evidence is kept separately so Score retries never store a multi-MiB replay. */
  replayStatus?: ReplayStatus;
}
