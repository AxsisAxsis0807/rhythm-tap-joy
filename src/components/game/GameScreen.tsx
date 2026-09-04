import { useCallback, useRef } from "react";
import { DEFAULT_KEY_LABELS } from "@/game/config";
import { useRhythmGame } from "@/game/useRhythmGame";
import type { Chart } from "@/game/types";

const JUDGE_LINE_PCT = 86; // vertical position of the judgement line

export function GameScreen({ chart }: { chart: Chart }) {
  const game = useRhythmGame(chart);
  const laneRef = useRef<HTMLDivElement | null>(null);
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

  /** Pointer events give us multi-touch (simultaneous lanes) for free. */
  const onPointerDown = useCallback(
    (lane: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      pressLane(lane);
    },
    [pressLane],
  );

  const last = play.lastJudgement;
  const judgeAge = last ? songTime - last.at : Infinity;
  const showJudge = judgeAge >= 0 && judgeAge < 0.45;

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background select-none">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
        <div>
          <p className="font-display text-xs tracking-[0.3em] text-muted-foreground">
            {chart.difficultyName}
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
      <div ref={laneRef} className="relative flex-1 touch-none">
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
              <div
                className="absolute inset-x-0 z-10 h-[3px] bg-judge-line shadow-glow"
                style={{ top: `${JUDGE_LINE_PCT}%` }}
              />
              <div
                className="absolute inset-x-0 bottom-0 flex items-center justify-center text-xs tracking-widest text-muted-foreground"
                style={{ height: `${100 - JUDGE_LINE_PCT}%` }}
              >
                {DEFAULT_KEY_LABELS[lane] ?? lane + 1}
              </div>

              {notes.map((note) => {
                if (note.lane !== lane || note.judged) return null;
                const remaining = note.time - songTime;
                if (remaining > scrollTime || remaining < -0.25) return null;
                const progress = 1 - remaining / scrollTime;
                return (
                  <div
                    key={note.id}
                    className="absolute inset-x-1 h-3 rounded-sm bg-note shadow-note"
                    style={{ top: `calc(${progress * JUDGE_LINE_PCT}% - 6px)` }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Combo + judgement */}
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-20 flex flex-col items-center gap-1">
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
          <p className="text-sm text-muted-foreground">
            画面下部の4レーンをタップ、または D / F / J / K キーで演奏します。
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

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-overlay px-8 text-center backdrop-blur-sm">
      {children}
    </div>
  );
}
