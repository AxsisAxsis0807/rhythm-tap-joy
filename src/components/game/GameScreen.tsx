import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRhythmGame } from "@/game/useRhythmGame";
import type { Chart } from "@/game/types";
import { getMode, type GameMode } from "@/game/modes";
import { NoteSprite } from "./NoteSprite";
import { FnfField } from "./FnfField";
import { useGameSettings } from "@/game/settings";
import { DEFAULT_SCROLL_TIME } from "@/game/config";
import { ModePicker } from "./ModePicker";
import { SettingsPanel } from "./SettingsPanel";
import { usePlayResult } from "@/lib/usePlayResult";

export function GameScreen({
  chart,
  userId = null,
  modeId,
  onModeChange,
  onExit,
}: {
  chart: Chart;
  userId?: string | null;
  modeId: string;
  onModeChange: (id: string) => void;
  onExit?: () => void;
}) {
  const { settings, setSettings, saveError } = useGameSettings();
  const mode = getMode(chart.fnf ? "fnf" : modeId);
  const game = useRhythmGame(chart, {
    scrollTime: DEFAULT_SCROLL_TIME / settings.scrollSpeed,
    timingOffsetMs: settings.timingOffsetMs,
    volume: settings.masterVolume * settings.musicVolume,
    hitSoundVolume: settings.hitSoundEnabled ? settings.masterVolume * settings.hitSoundVolume : 0,
    keyMap: settings.keyBindings.map((code) => [code]),
  });
  const {
    status,
    start,
    pause,
    resume,
    clearInputs,
    pressLane,
    releaseLane,
    scrollTime,
    songTime,
    notes,
    play,
    activeLanes,
    duration,
  } = game;

  const runOwner = useRef<string | null>(null);
  const starting = useRef(false);
  const [startError, setStartError] = useState("");
  const { state: saveState, retrySave } = usePlayResult(game.completedPlay, runOwner.current);
  const startPlay = async () => {
    if (starting.current) return;
    starting.current = true;
    const owner = userId;
    setStartError("");
    try {
      await start();
      runOwner.current = owner;
    } catch {
      setStartError("再生を開始できませんでした。もう一度お試しください");
    } finally {
      starting.current = false;
    }
  };

  const lanes = Array.from({ length: chart.laneCount }, (_, i) => i);
  const judge = settings.judgeLinePct;
  const scrollDirection =
    settings.scrollDirection === "mode" ? mode.scroll : settings.scrollDirection;
  const noteShape = settings.noteShape === "mode" ? mode.noteShape : settings.noteShape;
  const renderMode = { ...mode, noteShape, scroll: scrollDirection, judgeLinePct: judge };
  const [isLandscape, setIsLandscape] = useState(false);
  const [orientationMessage, setOrientationMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pointerLanes = useRef(new Map<number, number>());
  useEffect(() => {
    if (status !== "playing") pointerLanes.current.clear();
  }, [status]);

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
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      };
      if (!orientation.lock) throw new Error("Orientation lock unavailable");
      await orientation.lock("landscape");
    } catch {
      setOrientationMessage("端末を横向きにしてください");
    }
  }, []);

  /** Vertical position (% from top) for a note at travel progress 0..1. */
  const notePct = (progress: number) =>
    scrollDirection === "down" ? progress * judge : 100 - progress * (100 - judge);

  // Only notes inside the visible time window are rendered. Notes are
  // time-sorted, so binary-search the window instead of scanning all of
  // them every frame (dense charts have tens of thousands).
  const visualSongTime = songTime + settings.visualOffsetMs / 1000;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((notes[mid]?.time ?? Infinity) < visualSongTime - 0.25) lo = mid + 1;
    else hi = mid;
  }
  const visibleNotes: typeof notes = [];
  for (let i = lo; i < notes.length; i++) {
    const note = notes[i];
    if (!note) break;
    if (note.time - visualSongTime > scrollTime) break;
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
  const timingErrors = play.timingErrorsMs;
  const averageError = timingErrors.length
    ? timingErrors.reduce((sum, value) => sum + value, 0) / timingErrors.length
    : null;

  const showOverlay = status !== "playing";

  return (
    <div
      className={`relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background select-none ${settings.reducedMotion ? "[&_*]:!animate-none [&_*]:!transition-none" : ""} ${settings.screenShake && showJudge && last?.judgement === "MISS" ? "animate-game-shake" : ""}`}
      style={{ overscrollBehavior: "none" }}
    >
      {settings.backgroundEffects && !settings.lightweightMode && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,oklch(0.62_0.12_205/.12),transparent_55%)]"
        />
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 bg-black"
        style={{ opacity: settings.backgroundDim / 200 }}
      />
      {/* Top HUD */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-3 px-3 py-1.5 text-[11px] tracking-widest text-foreground sm:text-sm">
        <span className="tabular-nums">SCORE {play.score.toLocaleString()}</span>
        <span className="text-muted-foreground">|</span>
        <span className="tabular-nums">MISS {c.MISS}</span>
        <span className="text-muted-foreground">|</span>
        <span className="tabular-nums">ACC {accuracy.toFixed(2)}%</span>
      </header>

      {/* Settings button (start / result screens) */}
      {showOverlay && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="設定を開く"
          className="absolute right-3 top-2 z-40 text-muted-foreground"
        >
          <Settings aria-hidden="true" className="size-5" />
        </Button>
      )}
      {status === "playing" && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void pause()}
          aria-label="一時停止"
          className="absolute right-[max(.75rem,env(safe-area-inset-right))] top-[max(.5rem,env(safe-area-inset-top))] z-40 bg-black/30 text-white"
        >
          <Pause className="size-5" />
        </Button>
      )}

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
        fnf={Boolean(chart.fnf)}
        saveError={saveError}
      />

      {/* Playfield: a centred column that stays playable in landscape */}
      <div className="relative flex flex-1 justify-center overflow-hidden">
        {chart.fnf ? (
          <FnfField
            chart={chart}
            mode={renderMode}
            notes={notes}
            songTime={songTime}
            scrollTime={scrollTime}
            activeLanes={activeLanes}
            middleScroll={settings.middleScroll}
          />
        ) : (
          <div
            className={`relative h-full w-full max-w-[520px] touch-none landscape:max-w-[min(60vh,520px)] ${
              mode.fieldClass ?? ""
            }`}
            style={{
              maxWidth: `${(520 * settings.laneWidth) / 100}px`,
              opacity: settings.laneOpacity / 100,
            }}
          >
            <div className="absolute inset-0 flex">
              {lanes.map((lane) => (
                <div
                  key={lane}
                  className="relative flex-1 border-r border-lane-border last:border-r-0 bg-lane"
                >
                  {activeLanes.has(lane) && <div className="absolute inset-0 bg-lane-active" />}

                  {/* Judgement line + receptor */}
                  <div
                    className={`absolute inset-x-0 z-10 h-[3px] bg-judge-line ${settings.glowEffects && !settings.lightweightMode ? "shadow-glow" : ""}`}
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
                        mode={renderMode}
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
                      {settings.keyBindings[lane]?.replace(/^Key/, "") ?? lane + 1}
                    </div>
                  )}

                  {visibleNotes.map((note) => {
                    if (note.lane !== lane || note.judged) return null;
                    const remaining = note.time - visualSongTime;
                    if (remaining > scrollTime || remaining < -0.25) return null;
                    const p = 1 - remaining / scrollTime;
                    const top = notePct(p);
                    return noteShape === "bar" ? (
                      <div
                        key={note.id}
                        className="absolute inset-x-1"
                        style={{
                          top: `calc(${top}% - ${mode.noteSize / 2}px)`,
                          transform: `scale(${settings.noteScale / 100})`,
                        }}
                      >
                        <NoteSprite mode={renderMode} lane={lane} />
                      </div>
                    ) : (
                      <div
                        key={note.id}
                        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={{
                          top: `${top}%`,
                          transform: `translate(-50%, -50%) scale(${settings.noteScale / 100})`,
                        }}
                      >
                        <NoteSprite mode={renderMode} lane={lane} />
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
              {showJudge &&
                settings.hitEffects &&
                !settings.lightweightMode &&
                last?.judgement !== "MISS" && (
                  <i
                    aria-hidden="true"
                    className="absolute size-24 animate-ping rounded-full border border-cyan-200/30"
                  />
                )}
              {play.combo > 1 && (
                <>
                  <span className="font-display text-4xl tabular-nums text-combo drop-shadow sm:text-5xl">
                    {play.combo}
                  </span>
                  <span className="text-[10px] tracking-[0.4em] text-muted-foreground">COMBO</span>
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
              {showJudge && last && settings.showFastLate && last.judgement !== "MISS" && (
                <span className="text-[10px] tracking-[.2em] text-white/65">
                  {last.deltaMs < 0 ? "FAST" : "LATE"} {Math.abs(Math.round(last.deltaMs))}ms
                </span>
              )}
              {settings.showErrorMeter && (
                <div className="relative mt-1 h-1 w-28 rounded bg-white/10">
                  <i
                    className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-cyan-200 transition-[left]"
                    style={{
                      left: `${50 + Math.max(-45, Math.min(45, (last?.deltaMs ?? 0) / 3))}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        {chart.fnf && (
          <div className="pointer-events-none absolute inset-x-0 top-[40%] z-20 text-center">
            {play.combo > 1 && (
              <p className="font-display text-4xl tabular-nums text-combo">{play.combo}</p>
            )}
            {showJudge && last && (
              <p
                className="font-display text-xl"
                style={{ color: `var(--judge-${last.judgement.toLowerCase()})` }}
              >
                {last.judgement}
              </p>
            )}
          </div>
        )}

        {/* Touch layer: the whole screen is split into 4 key areas.
            One container handles every finger and picks the lane from the
            touch X position, so rapid / simultaneous taps are never dropped. */}
        <div
          className="absolute inset-x-0 bottom-0 z-20 flex touch-none"
          style={{ touchAction: "none", height: `${settings.touchAreaHeight}%` }}
          onPointerDown={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const lane = Math.min(
              chart.laneCount - 1,
              Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * chart.laneCount)),
            );
            e.currentTarget.setPointerCapture?.(e.pointerId);
            pointerLanes.current.set(e.pointerId, lane);
            pressLane(lane, `pointer:${e.pointerId}`);
          }}
          onPointerUp={(e) => {
            const lane = pointerLanes.current.get(e.pointerId);
            pointerLanes.current.delete(e.pointerId);
            if (lane !== undefined) releaseLane(lane, `pointer:${e.pointerId}`);
          }}
          onPointerCancel={(e) => {
            const lane = pointerLanes.current.get(e.pointerId);
            pointerLanes.current.delete(e.pointerId);
            if (lane !== undefined) releaseLane(lane, `pointer:${e.pointerId}`);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {lanes.map((lane) => (
            <div
              key={lane}
              className={`pointer-events-none flex-1 ${
                settings.showTouchBorders ? "border-r border-lane-border last:border-r-0" : ""
              }`}
            />
          ))}
        </div>
      </div>

      {/* Song progress bar */}
      {settings.showProgress && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 px-4 pb-[max(.5rem,env(safe-area-inset-bottom))]">
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
      )}
      {settings.showFps && <FpsCounter />}

      {status === "paused" && (
        <Overlay>
          <h2 className="font-display text-2xl tracking-[.25em]">PAUSED</h2>
          <p className="text-sm text-white/55">
            入力状態を解除し、音声と譜面を同じ位置で停止しました。
          </p>
          <button
            type="button"
            onClick={() => void resume()}
            className="flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-display text-primary-foreground"
          >
            <Play className="size-4" />
            カウントして再開
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="text-sm text-cyan-100"
          >
            設定を開く
          </button>
          {onExit && (
            <button
              type="button"
              onClick={() => {
                clearInputs();
                onExit();
              }}
              className="text-xs text-white/45"
            >
              選曲へ戻る
            </button>
          )}
        </Overlay>
      )}

      {(status === "ready" || status === "loading" || status === "idle") && (
        <Overlay>
          <h2 className="font-display text-2xl text-foreground">{chart.title}</h2>
          {!chart.fnf && <ModePicker value={mode.id} onChange={onModeChange} />}
          <p className="text-sm text-muted-foreground">
            4レーンをタップ、または{" "}
            {settings.keyBindings.map((k) => k.replace(/^Key/, "")).join(" / ")}{" "}
            キーで演奏します。3モードは表示と流れる方向が異なり、判定・スコア規則は共通です。
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
            onClick={() => void startPlay()}
            className="rounded-full bg-primary px-8 py-3 font-display tracking-widest text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {status === "ready" ? "START" : "LOADING…"}
          </button>
          {startError && (
            <p role="alert" className="text-xs text-rose-200">
              {startError}
            </p>
          )}
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
          <h2 className="font-display text-xl tracking-[0.3em] text-muted-foreground">RESULT</h2>
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
            <div className="col-span-2 flex justify-between gap-6">
              <dt className="text-muted-foreground">ACCURACY</dt>
              <dd className="tabular-nums text-foreground">{accuracy.toFixed(2)}%</dd>
            </div>
          </dl>
          {timingErrors.length > 0 && averageError !== null && (
            <div className="w-full max-w-sm rounded-xl border border-white/10 bg-black/15 p-3 text-left">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-white/50">
                  タイミング傾向（実測 {timingErrors.length}打）
                </span>
                <span className="tabular-nums text-cyan-100">
                  平均 {averageError < 0 ? "FAST" : "LATE"} {Math.abs(averageError).toFixed(1)}ms
                </span>
              </div>
              <div className="relative h-12 overflow-hidden rounded bg-white/5">
                <i className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
                {timingErrors.slice(-80).map((error, index) => (
                  <i
                    key={index}
                    className="absolute size-1.5 rounded-full bg-cyan-200/70"
                    style={{
                      left: `${50 + Math.max(-48, Math.min(48, error / 3))}%`,
                      top: `${8 + (index % 4) * 10}px`,
                    }}
                  />
                ))}
              </div>
              <p className="mt-1 text-center text-[10px] text-white/30">FAST ← 0ms → LATE</p>
            </div>
          )}
          <div className="text-xs text-muted-foreground" aria-live="polite">
            {!runOwner.current && "ログインすると累計スコアを保存できます"}
            {saveState?.status === "saving" && "スコアを保存中…"}
            {saveState?.status === "queued" && "スコアを保存待ちに追加しました"}
            {saveState?.status === "saved" && "累計スコアに加算しました"}
            {saveState?.status === "error" && (
              <>
                <p role="alert">スコアを保存できませんでした: {saveState.error}</p>
                <button type="button" className="mt-2 underline" onClick={() => void retrySave()}>
                  保存を再試行
                </button>
              </>
            )}
          </div>
          {startError && (
            <p role="alert" className="text-xs text-rose-200">
              {startError}
            </p>
          )}
          {!chart.fnf && <ModePicker value={mode.id} onChange={onModeChange} />}
          <button
            onClick={() => void startPlay()}
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
    <div className="absolute inset-0 z-30 overflow-y-auto bg-overlay px-4 py-4 text-center backdrop-blur-sm sm:px-8 sm:py-6">
      <div className="flex min-h-full flex-col items-center justify-center gap-3 sm:gap-4">
        {children}
      </div>
    </div>
  );
}

function FpsCounter() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frame = 0,
      count = 0,
      start = performance.now();
    const tick = (now: number) => {
      count += 1;
      if (now - start >= 500) {
        setFps(Math.round((count * 1000) / (now - start)));
        count = 0;
        start = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <output className="pointer-events-none absolute left-2 top-2 z-30 rounded bg-black/50 px-2 py-1 font-mono text-[10px] text-cyan-100">
      {fps} FPS
    </output>
  );
}
