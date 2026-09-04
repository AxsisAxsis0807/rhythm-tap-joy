import type { JudgementWindows, ScoreRules } from "./types";

/** Timing windows in seconds. Tweak here to retune difficulty. */
export const DEFAULT_WINDOWS: JudgementWindows = {
  perfect: 0.045,
  great: 0.09,
  good: 0.14,
  miss: 0.2,
};

export const DEFAULT_SCORE_RULES: ScoreRules = {
  base: { PERFECT: 1000, GREAT: 700, GOOD: 300 },
  comboBonus: 2,
  maxComboBonus: 200,
};

/**
 * Keyboard mapping: lane index -> accepted key codes.
 * Replaceable at runtime (future key-config screen) since the input layer only
 * reads this table.
 */
export const DEFAULT_KEY_MAP: string[][] = [
  ["KeyD"],
  ["KeyF"],
  ["KeyJ"],
  ["KeyK"],
];

export const DEFAULT_KEY_LABELS = ["D", "F", "J", "K"];

/** Seconds a note is visible before it reaches the judgement line. */
export const DEFAULT_SCROLL_TIME = 1.1;

/** Seconds of silence before the audio starts, to let the player settle. */
export const START_DELAY = 1.5;
