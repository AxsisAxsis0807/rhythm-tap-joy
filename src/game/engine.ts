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
  // Binary-search the first note inside the window so dense charts
  // (tens of thousands of notes) stay O(log n + hits) per input.
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.time < time - w.miss) lo = mid + 1;
    else hi = mid;
  }
  let best: RuntimeNote | null = null;
  let bestDelta = Infinity;
  for (let i = lo; i < notes.length; i++) {
    const note = notes[i]!;
    if (note.time - time > w.miss) break; // notes are time-sorted
    if (note.judged || note.lane !== lane) continue;
    const d = Math.abs(note.time - time);
    if (d < bestDelta) {
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
