import { useMemo } from "react";
import type { Chart, ChartNote, RuntimeNote } from "@/game/types";
import type { GameMode } from "@/game/modes";
import { NoteSprite } from "./NoteSprite";

function inWindow<T extends { time: number }>(notes: T[], time: number, travel: number) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const note = notes[mid];
    if (note && note.time < time - 0.25) lo = mid + 1;
    else hi = mid;
  }
  const visible: T[] = [];
  for (let i = lo; i < notes.length; i++) {
    const note = notes[i];
    if (!note || note.time > time + travel) break;
    visible.push(note);
  }
  return visible;
}

export function FnfField({ chart, mode, notes, songTime, scrollTime, activeLanes, middleScroll }: {
  chart: Chart;
  mode: GameMode;
  notes: RuntimeNote[];
  songTime: number;
  scrollTime: number;
  activeLanes: Set<number>;
  middleScroll: boolean;
}) {
  const fnf = chart.fnf;
  const opponent = useMemo(() => {
    const source: ChartNote[] = fnf ? fnf[fnf.playerSide === "left" ? "right" : "left"] : [];
    return source.map((note, id) => ({ ...note, id, time: note.beat * 60 / chart.bpm + chart.offset }));
  }, [chart, fnf]);
  if (!fnf) return null;
  const playerVisible = inWindow(notes, songTime, scrollTime);
  const opponentVisible = inWindow(opponent, songTime, scrollTime);
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="fnf-field">
      {(["left", "right"] as const).map((side) => {
        const player = side === fnf.playerSide;
        const bankClass = middleScroll
          ? player ? "left-[30%] w-[40%]" : "left-[3%] w-[24%] opacity-40"
          : side === "left" ? "left-[6%] w-[36%]" : "right-[6%] w-[36%]";
        const visible = player ? playerVisible : opponentVisible;
        return (
          <div key={side} data-testid={`fnf-${side}`} data-player={player} className={`absolute inset-y-0 ${bankClass}`}>
            {[0, 1, 2, 3].map((lane) => (
              <div key={lane} className="absolute inset-y-0 w-1/4" style={{ left: `${lane * 25}%` }}>
                <div className="absolute left-1/2 top-[86%] w-[80%] max-w-[76px] -translate-x-1/2 -translate-y-1/2">
                  <NoteSprite mode={mode} lane={lane} receptor pressed={player ? activeLanes.has(lane) : opponentVisible.some(n => n.lane === lane && Math.abs(n.time - songTime) < 0.06)} />
                </div>
                {visible.map(note => {
                  if (note.lane !== lane || ("judged" in note && note.judged)) return null;
                  if (!player && songTime > note.time + 0.06) return null;
                  const top = 86 + (note.time - songTime) / scrollTime * 86;
                  return (
                    <div key={note.id} className="absolute left-1/2 w-[80%] max-w-[76px] -translate-x-1/2 -translate-y-1/2" style={{ top: `${top}%` }}>
                      <NoteSprite mode={mode} lane={lane} />
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