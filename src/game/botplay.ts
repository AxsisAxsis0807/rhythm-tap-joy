import type { GameplayCore } from "./gameplayCore";
import type { GameplayEventInput } from "./replay";

type Edge = { at: number; type: "press" | "release"; lane: number; source: number };

/** Ordered chart-time edges, consumed once. No DOM events or relaxed judgements. */
export class Botplay {
  private cursor = 0;
  private readonly edges: Edge[];
  private readonly litUntil = new Map<number, number>();
  readonly endTime: number;

  constructor(private readonly core: GameplayCore) {
    if (!core.configuration.autoplay) throw new Error("BOTPLAY requires autoplay");
    this.edges = core.notes
      .flatMap((note) => {
        const source = note.id + 1;
        return [
          { at: note.time, type: "press" as const, lane: note.lane, source },
          { at: note.endTime ?? note.time, type: "release" as const, lane: note.lane, source },
        ];
      })
      .sort((a, b) => a.at - b.at);
    this.endTime = this.edges.at(-1)?.at ?? 0;
  }

  advance(songTime: number, emit: (event: GameplayEventInput) => unknown) {
    const offset = this.core.configuration.timingOffsetMs / 1000;
    const horizon = songTime + offset;
    const timing = (time: number) => ({ songTime: time, clockTime: songTime, elapsedMs: 0 });
    while (this.cursor < this.edges.length && this.edges[this.cursor]!.at <= horizon) {
      const edge = this.edges[this.cursor++]!;
      // advance uses chart time, unlike input edges which the core calibrates.
      // Finish tails before releasing sources, and catch up before auto-MISS.
      emit({ type: "advance", ...timing(edge.at) });
      emit({ type: edge.type, lane: edge.lane, source: edge.source, ...timing(edge.at - offset) });
      if (edge.type === "press") {
        this.litUntil.set(
          edge.lane,
          Math.max(this.litUntil.get(edge.lane) ?? -Infinity, edge.at + 0.07),
        );
      }
    }
    emit({ type: "advance", ...timing(horizon) });
  }

  activeLanes(songTime: number) {
    const horizon = songTime + this.core.configuration.timingOffsetMs / 1000;
    const active = new Set<number>();
    for (const [lane, until] of this.litUntil) if (horizon < until) active.add(lane);
    for (const lane of this.core.sources.values()) active.add(lane);
    return active;
  }
}
