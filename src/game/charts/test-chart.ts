import type { Chart, ChartNote } from "../types";

/**
 * Test chart, authored in beats so it stays readable and BPM-independent.
 * Data only — no engine imports — so it can later be moved to JSON or a
 * chart-editor output without touching gameplay code.
 */
const notes: ChartNote[] = [];
const tap = (beat: number, lane: number) =>
  notes.push({ beat, lane, kind: "tap" });

// Bars 1-4: simple quarter notes alternating lanes
for (let b = 0; b < 16; b++) tap(8 + b, b % 4);

// Bars 5-6: eighth-note stairs up and down
for (let i = 0; i < 16; i++) {
  const lane = i % 8 < 4 ? i % 4 : 3 - (i % 4);
  tap(24 + i * 0.5, lane);
}

// Bars 7-8: trill on outer lanes with a chord accent
for (let i = 0; i < 14; i++) tap(32 + i * 0.5, i % 2 === 0 ? 0 : 3);
tap(39, 1);
tap(39, 2);

// Bars 9-12: quarter kicks with off-beat doubles
for (let b = 0; b < 16; b++) {
  tap(40 + b, b % 2 === 0 ? 1 : 2);
  if (b % 4 === 3) {
    tap(40.5 + b, 0);
    tap(40.5 + b, 3);
  }
}

// Bars 13-14: sixteenth burst (spam-style) then a breather
for (let i = 0; i < 16; i++) tap(56 + i * 0.25, i % 4);
tap(62, 0);
tap(62, 3);
tap(63, 1);
tap(63, 2);

// Bars 15-16: closing pattern
for (let i = 0; i < 8; i++) tap(64 + i * 0.5, [0, 2, 1, 3, 2, 0, 3, 1][i]);
tap(70, 0);
tap(70, 1);
tap(70, 2);
tap(70, 3);

export const TEST_CHART: Chart = {
  id: "test-120",
  title: "Pulse Test",
  artist: "System Metronome",
  audioUrl: "/audio/test-track.mp3",
  bpm: 120,
  offset: 0,
  laneCount: 4,
  difficultyName: "BASIC",
  notes: notes.sort((a, b) => a.beat - b.beat),
};
