import { useCallback, useEffect, useState } from "react";
import { RotateCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_KEY_LABELS } from "@/game/config";
import { useRhythmGame } from "@/game/useRhythmGame";
import type { Chart } from "@/game/types";
import { getMode, type GameMode } from "@/game/modes";
import { NoteSprite } from "./NoteSprite";
import { ModePicker } from "./ModePicker";
import {
  DEFAULT_SETTINGS,
  SettingsPanel,
  type GameSettings,
} from "./SettingsPanel";

export function GameScreen({
  chart,
  modeId,
  onModeChange,
  onExit,
}: {
  chart: Chart;
  modeId: string;
  onModeChange: (id: string) => void;
  onExit?: () => void;
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
    duration,
  } = game;

  const lanes = Array.from({ length: chart.laneCount }, (_, i) => i);
  const judge = mode.judgeLinePct;
  const [isLandscape, setIsLandscape] = useState(false);
  const [orientationMessage, setOrientationMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const media = window.matchMedia("(orientation: landscape)");
    const updateOrientation = () => {
      setIsLandscape(media.matches);
      if (media.matches) setOrientationMessage("");
    };
    updateOrientation();
    media.addEventListener("change", updateOrientation);
    return () => media.removeEventListener("change", updateOrientation);
  }, []);

  const requestLandscape = useCallback(async () => {
    try {
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      await screen.orientation.lock("landscape");
    } catch {
      setOrientationMessage("端末を横向きにしてください");
    }
  }, []);

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
    mode.scroll === "down" ? progress * judge : 100 - progress * (100 - judge);

  // Only notes inside the visible time window are rendered. Notes are
  // time-sorted, so binary-search the window instead of scanning all of
  // them every frame (dense charts have tens of thousands).
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.time < songTime - 0.25) lo = mid + 1;
    else hi = mid;
  }
  const visibleNotes: typeof notes = [];
  for (let i = lo; i < notes.length; i++) {
    const note = notes[i]!;
    if (note.time - songTime > scrollTime) break;
    visibleNotes.push(note);
  }

  const last = play.lastJudgement;
  const judgeAge = last ? songTime - last.at : Infinity;
  const showJudge = judgeAge >= 0 && judgeAge < 0.45;

  const c = play.counts;
  const totalJudged = c.PERFECT + c.GREAT + c.GOOD + c.MISS;
  const accuracy = totalJudged
    ? ((c.PERFECT + c.GREAT * 0.7 + c.GOOD * 0.4) / totalJudged) * 100
    : 100;
  const progress = duration ? Math.min(1, Math.max(0, songTime / duration)) : 0;

  const showOverlay =
    status === "ready" || status === "loading" || status === "idle" || status === "finished";

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background select-none">
      {/* Top HUD */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-3 px-3 py-1.5 text-[11px] tracking-widest text-foreground sm:text-sm">
        <span className="tabular-nums">
          SCORE {play.score.toLocaleString()}
        </span>
        <span className="text-muted-foreground">|</span>
        <span className="tabular-nums">MISS {c.MISS}</span>
        <span className="text-muted-foreground">|</span>
        <span className="tabular-nums">ACC {accuracy.toFixed(2)}%</span>
      </header>

      {/* Settings button (start / result screens) */}
      {showOverlay && (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="設定を開く"
          className="absolute right-3 top-2 z-30 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings aria-hidden="true" className="size-5" />
        </button>
      )}

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Playfield: a centred column that stays playable in landscape */}
      <div className="relative flex flex-1 justify-center overflow-hidden">
        <div
          className={`relative h-full w-full max-w-[520px] touch-none landscape:max-w-[min(60vh,520px)] ${
            mode.fieldClass ?? ""
          }`}
        >
          <div className="absolute inset-0 flex">
            {lanes.map((lane) => (
              <div
                key={lane}
                className="relative flex-1 border-r border-lane-border last:border-r-0 bg-lane"
              >

                {activeLanes.has(lane) && (
                  <div className="absolute inset-0 bg-lane-active" />
                )}

                {/* Judgement line + receptor */}
                <div
                  className="absolute inset-x-0 z-10 h-[3px] bg-judge-line shadow-glow"
                  style={{
                    top: `${judge}%`,
                    opacity: mode.receptors ? 0.35 : 1,
                  }}
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
                  const p = 1 - remaining / scrollTime;
                  const top = notePct(p);
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
                <span className="font-display text-4xl tabular-nums text-combo drop-shadow sm:text-5xl">
                  {play.combo}
                </span>
                <span className="text-[10px] tracking-[0.4em] text-muted-foreground">
                  COMBO
                </span>
              </>
            )}
            {showJudge && last && (
              <span
                className="mt-2 font-display text-xl tracking-[0.2em] sm:text-2xl"
                style={{ color: `var(--judge-${last.judgement.toLowerCase()})` }}
              >
                {last.judgement}
              </span>
            )}
          </div>
        </div>

        {/* Touch layer: the whole screen is split into 4 key areas */}
        <div className="absolute inset-0 z-20 flex touch-none">
          {lanes.map((lane) => (
            <div
              key={lane}
              onPointerDown={onPointerDown(lane)}
              onPointerUp={() => releaseLane(lane)}
              onPointerCancel={() => releaseLane(lane)}
              onContextMenu={(e) => e.preventDefault()}
              className={`flex-1 ${
                settings.showTouchBorders
                  ? "border-r border-lane-border last:border-r-0"
                  : ""
              }`}
              style={{ touchAction: "none" }}
            />
          ))}
        </div>
      </div>


      {/* Song progress bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 px-4 pb-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary transition-[width] duration-150"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="max-w-[45%] truncate font-display text-[11px] tracking-widest text-muted-foreground">
          {chart.title} · {chart.difficultyName}
        </span>
      </div>

      {(status === "ready" || status === "loading" || status === "idle") && (
        <Overlay>
          <h2 className="font-display text-2xl text-foreground">
            {chart.title}
          </h2>
          <ModePicker value={mode.id} onChange={onModeChange} />
          <p className="text-sm text-muted-foreground">
            4レーンをタップ、または D / F / J / K キーで演奏します。横画面でもプレイできます。
          </p>
          {!isLandscape && (
            <div className="flex flex-col items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void requestLandscape()}
                className="font-display tracking-widest"
              >
                <RotateCw aria-hidden="true" />
                横画面にする
              </Button>
              {orientationMessage && (
                <p className="text-xs text-muted-foreground" role="status">
                  {orientationMessage}
                </p>
              )}
            </div>
          )}
          <button
            disabled={status !== "ready"}
            onClick={() => void start()}
            className="rounded-full bg-primary px-8 py-3 font-display tracking-widest text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {status === "ready" ? "START" : "LOADING…"}
          </button>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="text-xs tracking-[0.3em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              BACK
            </button>
          )}
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
                <dd className="tabular-nums text-foreground">
                  {play.counts[k]}
                </dd>
              </div>
            ))}
            <div className="col-span-2 flex justify-between gap-6 border-t border-border pt-1">
              <dt className="text-muted-foreground">MAX COMBO</dt>
              <dd className="tabular-nums text-foreground">{play.maxCombo}</dd>
            </div>
            <div className="col-span-2 flex justify-between gap-6">
              <dt className="text-muted-foreground">ACCURACY</dt>
              <dd className="tabular-nums text-foreground">
                {accuracy.toFixed(2)}%
              </dd>
            </div>
          </dl>
          <ModePicker value={mode.id} onChange={onModeChange} />
          <button
            onClick={() => void start()}
            className="rounded-full bg-primary px-8 py-3 font-display tracking-widest text-primary-foreground"
          >
            RETRY
          </button>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="text-xs tracking-[0.3em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              BACK
            </button>
          )}
        </Overlay>
      )}
    </div>
  );
}

export type { GameMode };

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-overlay px-8 py-6 text-center backdrop-blur-sm">
      {children}
    </div>
  );
}
