/**
 * Core data types for the rhythm game.
 * Chart data is intentionally decoupled from engine/rendering so a chart
 * editor (or JSON files fetched at runtime) can be added later.
 */

/** Note kinds. Only "tap" is implemented; kept as a union for future growth. */
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
}

/** A note prepared for gameplay: absolute seconds + runtime state. */
export interface RuntimeNote {
  id: number;
  /** Absolute time in song seconds when the note must be hit. */
  time: number;
  lane: number;
  kind: NoteKind;
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
}
