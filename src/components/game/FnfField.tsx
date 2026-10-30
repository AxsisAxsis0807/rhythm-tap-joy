import { notesByLane, visibleWindow } from "@/game/visibleNotes";
import { useMemo } from "react";
import type { Chart, ChartNote, RuntimeNote } from "@/game/types";
import type { GameMode } from "@/game/modes";
import { NoteSprite } from "./NoteSprite";

export function FnfField({
  chart,
  mode,
  notes,
  songTime,
  scrollTime,
  activeLanes,
  middleScroll,
  glow = true,
}: {
  chart: Chart;
  mode: GameMode;
  notes: RuntimeNote[];
  songTime: number;
  scrollTime: number;
  activeLanes: Set<number>;
  middleScroll: boolean;
  glow?: boolean;
}) {
  const fnf = chart.fnf;
  const opponent = useMemo(() => {
    const source: ChartNote[] = fnf ? fnf[fnf.playerSide === "left" ? "right" : "left"] : [];
    return source.map((note, id) => ({
      ...note,
      id,
      time: (note.beat * 60) / chart.bpm + chart.offset,
    }));
  }, [chart, fnf]);
  if (!fnf) return null;
  const judge = mode.judgeLinePct;
  const noteTop = (time: number) => {
    const progress = 1 - (time - songTime) / scrollTime;
    return mode.scroll === "down" ? progress * judge : 100 - progress * (100 - judge);
  };
  const playerVisible = visibleWindow(notes, songTime, scrollTime);
  const opponentVisible = visibleWindow(opponent, songTime, scrollTime);
  const playerLanes = notesByLane(playerVisible, 4);
  const opponentLanes = notesByLane(opponentVisible, 4);
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="fnf-field">
      {(["left", "right"] as const).map((side) => {
        const player = side === fnf.playerSide;
        // Selected side changes the SOURCE, never the player's horizontal center.
        const bankClass = player
          ? "left-1/2 w-[40%] max-w-[520px] -translate-x-1/2"
          : `${side === "left" ? "left-[3%]" : "right-[3%]"} w-[24%] ${middleScroll ? "opacity-40" : ""}`;
        const visible = player ? playerLanes : opponentLanes;
        return (
          <div
            key={side}
            data-testid={`fnf-${side}`}
            data-player={player}
            className={`absolute inset-y-0 ${bankClass}`}
          >
            {[0, 1, 2, 3].map((lane) => (
              <div
                key={lane}
                className="absolute inset-y-0 w-1/4"
                style={{ left: `${lane * 25}%` }}
              >
                <div
                  data-testid={player ? `receptor-${lane}` : `opponent-receptor-${lane}`}
                  className="absolute left-1/2 w-[80%] max-w-[76px] -translate-x-1/2 -translate-y-1/2"
                  style={{ top: `${judge}%` }}
                >
                  <NoteSprite
                    mode={mode}
                    glow={glow}
                    lane={lane}
                    fluid
                    receptor
                    pressed={
                      player
                        ? activeLanes.has(lane)
                        : (opponentLanes[lane] ?? []).some(
                            (n) => Math.abs(n.time - songTime) < 0.06,
                          )
                    }
                  />
                </div>
                {(visible[lane] ?? []).map((note) => {
                  if (note.lane !== lane || ("judged" in note && note.judged)) return null;
                  if (!player && songTime > note.time + 0.06) return null;
                  const top = noteTop(note.time);
                  return (
                    <div
                      key={note.id}
                      data-testid={player ? `player-note-${note.id}` : undefined}
                      className="absolute left-1/2 w-[80%] max-w-[76px] -translate-x-1/2 -translate-y-1/2"
                      style={{ top: `${top}%` }}
                    >
                      <NoteSprite mode={mode} lane={lane} fluid glow={glow} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
