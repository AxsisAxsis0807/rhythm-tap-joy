import { useCallback } from "react";
import { DEFAULT_KEY_LABELS } from "@/game/config";
import { useRhythmGame } from "@/game/useRhythmGame";
import type { Chart } from "@/game/types";
import { getMode, type GameMode } from "@/game/modes";
import { NoteSprite } from "./NoteSprite";
import { ModePicker } from "./ModePicker";

export function GameScreen({
  chart,
  modeId,
  onModeChange,
}: {
  chart: Chart;
  modeId: string;
  onModeChange: (id: string) => void;
}) {
  const mode = getMode(modeId);
  const game = useRhythmGame(chart);
  const {
    status,
    start,
    pressLane,
    releaseLane,
    scrollTime,
    songTime,
    notes,
    play,
    activeLanes,
  } = game;

  const lanes = Array.from({ length: chart.laneCount }, (_, i) => i);
  const judge = mode.judgeLinePct;

  /** Pointer events give us multi-touch (simultaneous lanes) for free. */
  const onPointerDown = useCallback(
    (lane: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      pressLane(lane);
    },
    [pressLane],
  );

  /** Vertical position (% from top) for a note at travel progress 0..1. */
  const notePct = (progress: number) =>
    mode.scroll === "down"
      ? progress * judge
      : 100 - progress * (100 - judge);

  const last = play.lastJudgement;
  const judgeAge = last ? songTime - last.at : Infinity;
  const showJudge = judgeAge >= 0 && judgeAge < 0.45;

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background select-none">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
        <div>
          <p className="font-display text-xs tracking-[0.3em] text-muted-foreground">
            {mode.name} · {chart.difficultyName}
          </p>
          <h1 className="font-display text-lg leading-tight text-foreground">
            {chart.title}
          </h1>
          <p className="text-xs text-muted-foreground">{chart.artist}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl tabular-nums text-foreground">
            {play.score.toLocaleString()}
          </p>
          <p className="text-xs tracking-widest text-muted-foreground">SCORE</p>
        </div>
      </header>

      {/* Playfield */}
      <div className={`relative flex-1 touch-none ${mode.fieldClass ?? ""}`}>
        <div className="absolute inset-0 flex">
          {lanes.map((lane) => (
            <div
              key={lane}
              onPointerDown={onPointerDown(lane)}
              onPointerUp={() => releaseLane(lane)}
              onPointerCancel={() => releaseLane(lane)}
              onContextMenu={(e) => e.preventDefault()}
              className="relative flex-1 border-r border-lane-border last:border-r-0 bg-lane"
              style={{ touchAction: "none" }}
            >
              {activeLanes.has(lane) && (
                <div className="absolute inset-0 bg-lane-active" />
              )}

              {/* Judgement line + receptor */}
              <div
                className="absolute inset-x-0 z-10 h-[3px] bg-judge-line shadow-glow"
                style={{ top: `${judge}%`, opacity: mode.receptors ? 0.35 : 1 }}
              />
              {mode.receptors && (
                <div
                  className="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ top: `${judge}%` }}
                >
                  <NoteSprite
                    mode={mode}
                    lane={lane}
                    receptor
                    pressed={activeLanes.has(lane)}
                  />
                </div>
              )}

              {mode.showKeyLabels && (
                <div
                  className="absolute inset-x-0 bottom-0 flex items-center justify-center text-xs tracking-widest text-muted-foreground"
                  style={{ height: `${100 - judge}%` }}
                >
                  {DEFAULT_KEY_LABELS[lane] ?? lane + 1}
                </div>
              )}

              {notes.map((note) => {
                if (note.lane !== lane || note.judged) return null;
                const remaining = note.time - songTime;
                if (remaining > scrollTime || remaining < -0.25) return null;
                const progress = 1 - remaining / scrollTime;
                const top = notePct(progress);
                return mode.noteShape === "bar" ? (
                  <div
                    key={note.id}
                    className="absolute inset-x-1"
                    style={{ top: `calc(${top}% - ${mode.noteSize / 2}px)` }}
                  >
                    <NoteSprite mode={mode} lane={lane} />
                  </div>
                ) : (
                  <div
                    key={note.id}
                    className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ top: `${top}%` }}
                  >
                    <NoteSprite mode={mode} lane={lane} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Combo + judgement */}
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-1"
          style={{ top: `${mode.popupPct}%` }}
        >
          {play.combo > 1 && (
            <>
              <span className="font-display text-5xl tabular-nums text-combo drop-shadow">
                {play.combo}
              </span>
              <span className="text-[10px] tracking-[0.4em] text-muted-foreground">
                COMBO
              </span>
            </>
          )}
          {showJudge && last && (
            <span
              className="mt-2 font-display text-2xl tracking-[0.2em]"
              style={{ color: `var(--judge-${last.judgement.toLowerCase()})` }}
            >
              {last.judgement}
            </span>
          )}
        </div>
      </div>

      {(status === "ready" || status === "loading" || status === "idle") && (
        <Overlay>
          <h2 className="font-display text-2xl text-foreground">{chart.title}</h2>
          <ModePicker value={mode.id} onChange={onModeChange} />
          <p className="text-sm text-muted-foreground">
            4レーンをタップ、または D / F / J / K キーで演奏します。
          </p>
          <button
            disabled={status !== "ready"}
            onClick={() => void start()}
            className="rounded-full bg-primary px-8 py-3 font-display tracking-widest text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {status === "ready" ? "START" : "LOADING…"}
          </button>
        </Overlay>
      )}

      {status === "finished" && (
        <Overlay>
          <h2 className="font-display text-xl tracking-[0.3em] text-muted-foreground">
            RESULT
          </h2>
          <p className="font-display text-4xl tabular-nums text-foreground">
            {play.score.toLocaleString()}
          </p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {(["PERFECT", "GREAT", "GOOD", "MISS"] as const).map((k) => (
              <div key={k} className="flex justify-between gap-6">
                <dt style={{ color: `var(--judge-${k.toLowerCase()})` }}>{k}</dt>
                <dd className="tabular-nums text-foreground">{play.counts[k]}</dd>
              </div>
            ))}
            <div className="col-span-2 flex justify-between gap-6 border-t border-border pt-1">
              <dt className="text-muted-foreground">MAX COMBO</dt>
              <dd className="tabular-nums text-foreground">{play.maxCombo}</dd>
            </div>
          </dl>
          <ModePicker value={mode.id} onChange={onModeChange} />
          <button
            onClick={() => void start()}
            className="rounded-full bg-primary px-8 py-3 font-display tracking-widest text-primary-foreground"
          >
            RETRY
          </button>
        </Overlay>
      )}
    </div>
  );
}

export type { GameMode };

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-overlay px-8 text-center backdrop-blur-sm">
      {children}
    </div>
  );
}
