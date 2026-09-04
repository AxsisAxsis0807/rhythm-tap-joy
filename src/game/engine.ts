import type {
  Chart,
  Judgement,
  JudgementWindows,
  PlayState,
  RuntimeNote,
  ScoreRules,
} from "./types";

/** Convert authored beats into absolute song seconds. */
export function buildRuntimeNotes(chart: Chart): RuntimeNote[] {
  const secondsPerBeat = 60 / chart.bpm;
  return chart.notes
    .map((n, i) => ({
      id: i,
      time: chart.offset + n.beat * secondsPerBeat,
      lane: n.lane,
      kind: n.kind,
      judged: false,
    }))
    .sort((a, b) => a.time - b.time);
}

export function createPlayState(): PlayState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 },
  };
}

export function judgeDelta(
  delta: number,
  w: JudgementWindows,
): Judgement | null {
  const d = Math.abs(delta);
  if (d <= w.perfect) return "PERFECT";
  if (d <= w.great) return "GREAT";
  if (d <= w.good) return "GOOD";
  if (d <= w.miss) return "MISS";
  return null;
}

/**
 * Find the nearest un-judged note in a lane that an input at `time` can hit.
 * Returns null when the tap lands nowhere near a note (ignored, no penalty).
 */
export function findHittableNote(
  notes: RuntimeNote[],
  lane: number,
  time: number,
  w: JudgementWindows,
): RuntimeNote | null {
  let best: RuntimeNote | null = null;
  let bestDelta = Infinity;
  for (const note of notes) {
    if (note.judged || note.lane !== lane) continue;
    if (note.time - time > w.miss) break; // notes are time-sorted
    const d = Math.abs(note.time - time);
    if (d <= w.miss && d < bestDelta) {
      best = note;
      bestDelta = d;
    }
  }
  return best;
}

export function applyJudgement(
  state: PlayState,
  judgement: Judgement,
  deltaMs: number,
  rules: ScoreRules,
  at: number,
): void {
  state.counts[judgement] += 1;
  if (judgement === "MISS") {
    state.combo = 0;
  } else {
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    const bonus = Math.min(state.combo * rules.comboBonus, rules.maxComboBonus);
    state.score += rules.base[judgement] + bonus;
  }
  state.lastJudgement = { judgement, deltaMs, at };
}
