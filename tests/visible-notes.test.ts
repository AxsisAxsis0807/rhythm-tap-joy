import { expect, it } from "vitest";
import { visibleWindow, notesByLane } from "@/game/visibleNotes";

it("matches the original time-window/lane filters at boundaries, seeks and mutable judgements", () => {
  const notes = Array.from({ length: 12000 }, (_, id) => ({
    id,
    lane: id % 4,
    time: id / 24,
    judged: id % 3 === 0,
  }));
  for (const time of [0, 0.25, 1 / 24, 5, 5.001, 100.1, 499, 10, -1]) {
    for (const travel of [0.325, 1.3, 2.6]) {
      for (const upper of ["difference", "sum"] as const) {
        const selected = notes.filter(
          (n) =>
            n.time >= time - 0.25 &&
            !(upper === "difference" ? n.time - time > travel : n.time > time + travel),
        );
        const lanes = notesByLane(visibleWindow(notes, time, travel, upper), 4);
        for (let lane = 0; lane < 4; lane++)
          expect(lanes[lane]).toEqual(selected.filter((n) => n.lane === lane));
        notes.forEach((n) => {
          n.judged = !n.judged;
        });
        for (let lane = 0; lane < 4; lane++)
          expect(lanes[lane]!.filter((n) => !n.judged)).toEqual(
            selected.filter((n) => n.lane === lane && !n.judged),
          );
      }
    }
  }
});
it("retains exact legacy floating-point upper boundaries", () => {
  // Difference and sum comparisons can round differently: preserve each caller's expression.
  for (const time of [0.1, 0.2, 0.3, 1 / 3, 19.99])
    for (const travel of [0.1, 0.2, 0.325, 1.3]) {
      const end = time + travel;
      const notes = [-Number.EPSILON * 16, 0, Number.EPSILON * 16].map((d, id) => ({
        id,
        time: end + d,
      }));
      for (const upper of ["difference", "sum"] as const)
        expect(visibleWindow(notes, time, travel, upper)).toEqual(
          notes.filter(
            (n) => !(upper === "difference" ? n.time - time > travel : n.time > time + travel),
          ),
        );
    }
});
