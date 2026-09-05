/**
 * Play modes (visual + input skins).
 *
 * A mode never touches judgement/score logic — it only describes how the
 * playfield is drawn and which direction notes travel. New modes (FNF,
 * osu!mania, custom skins) are added by appending to GAME_MODES; the engine,
 * charts and input layer stay untouched.
 */

export type NoteShape = "bar" | "circle" | "arrow";
export type ScrollDirection = "down" | "up";

export interface GameMode {
  id: string;
  /** Name shown in the mode picker. */
  name: string;
  /** One-line description shown under the name. */
  description: string;
  noteShape: NoteShape;
  scroll: ScrollDirection;
  /** Judgement-line position as a % of playfield height (from the top). */
  judgeLinePct: number;
  /** Whether a receptor ring/arrow is drawn on the judgement line. */
  receptors: boolean;
  /** Note size in px (height for bars, diameter for circles/arrows). */
  noteSize: number;
  /** Per-lane CSS color token names, cycled if shorter than laneCount. */
  laneColors: string[];
  /** Extra classes applied to the playfield wrapper (background flavour). */
  fieldClass?: string;
  /** Where the judgement/combo popup sits, as a % from the top. */
  popupPct: number;
  /** Show the D/F/J/K key hint under the lanes. */
  showKeyLabels: boolean;
}

export const GAME_MODES: GameMode[] = [
  {
    id: "classic",
    name: "CLASSIC",
    description: "標準の4レーン。下に流れるバー型ノーツ。",
    noteShape: "bar",
    scroll: "down",
    judgeLinePct: 86,
    receptors: false,
    noteSize: 14,
    laneColors: ["var(--note)"],
    popupPct: 38,
    showKeyLabels: true,
  },
  {
    id: "mania",
    name: "PSU!MANIA",
    description: "osu!mania風。丸ノーツとレシーバー、白と青のレーン。",
    noteShape: "circle",
    scroll: "down",
    judgeLinePct: 84,
    receptors: true,
    noteSize: 46,
    laneColors: [
      "var(--mania-lane-a)",
      "var(--mania-lane-b)",
      "var(--mania-lane-b)",
      "var(--mania-lane-a)",
    ],
    fieldClass: "bg-mania-field",
    popupPct: 44,
    showKeyLabels: false,
  },
  {
    id: "fnf",
    name: "FNF",
    description: "Friday Night Funkin'風。上に流れる矢印ノーツ。",
    noteShape: "arrow",
    scroll: "up",
    judgeLinePct: 14,
    receptors: true,
    noteSize: 52,
    laneColors: [
      "var(--fnf-lane-1)",
      "var(--fnf-lane-2)",
      "var(--fnf-lane-3)",
      "var(--fnf-lane-4)",
    ],
    fieldClass: "bg-fnf-field",
    popupPct: 50,
    showKeyLabels: false,
  },
];

export const DEFAULT_MODE_ID = "classic";

export function getMode(id: string): GameMode {
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0]!;
}

/** Color token for a lane in a mode. */
export function laneColor(mode: GameMode, lane: number): string {
  return mode.laneColors[lane % mode.laneColors.length]!;
}

/** Arrow glyph per lane (FNF-style: left, down, up, right). */
export const ARROW_GLYPHS = ["◀", "▼", "▲", "▶"];
