/** Fresh render snapshots: never cache mutable runtime notes by array identity. */
export function visibleWindow<T extends { time: number }>(
  notes: T[],
  time: number,
  travel: number,
  upper: "difference" | "sum" = "sum",
): T[] {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((notes[mid]?.time ?? Infinity) < time - 0.25) lo = mid + 1;
    else hi = mid;
  }
  const visible: T[] = [];
  for (let i = lo; i < notes.length; i++) {
    const note = notes[i];
    if (!note) break;
    // Keep each renderer's original floating-point boundary expression.
    if (upper === "difference" ? note.time - time > travel : note.time > time + travel) break;
    visible.push(note);
  }
  return visible;
}

export function notesByLane<T extends { lane: number }>(notes: T[], laneCount: number): T[][] {
  const lanes: T[][] = Array.from({ length: laneCount }, () => []);
  for (const note of notes) lanes[note.lane]?.push(note);
  return lanes;
}
