import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputLedger } from "./input";
import { AudioClock } from "./audio";
import { getAudioSession } from "./audioSession";
import { DEFAULT_KEY_MAP, DEFAULT_SCROLL_TIME, START_DELAY } from "./config";
import { GameplayCore } from "./gameplayCore";
import { ReplayRecorder } from "./replay";
import type { GameplayEventInput, ReplayEvidence } from "./replay";
import { createRunConfiguration } from "./runConfiguration";
import type { RunConfiguration, RunOptions } from "./runConfiguration";
import type { Chart, CompletedPlay } from "./types";

export type GameStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "finished";
export interface RhythmGameOptions extends RunOptions {
  keyMap?: string[][];
  scrollTime?: number;
  volume?: number;
  hitSoundVolume?: number;
}

export function useRhythmGame(chart: Chart, options: RhythmGameOptions = {}) {
  const keyMap = options.keyMap ?? DEFAULT_KEY_MAP;
  const scrollTime = options.scrollTime ?? DEFAULT_SCROLL_TIME;
  const [inputs] = useState(() => new InputLedger());
  const clockRef = useRef<AudioClock | null>(null);
  const coreRef = useRef<GameplayCore | null>(null);
  if (!coreRef.current) coreRef.current = new GameplayCore(chart, createRunConfiguration(chart));
  const replayRef = useRef<ReplayRecorder | null>(null);
  const leaseRef = useRef<ReturnType<ReturnType<typeof getAudioSession>["beginGameplay"]> | null>(
    null,
  );
  const sourceIdsRef = useRef(new Map<string, number>());
  const activeSourceIdsRef = useRef(new Map<string, number>());
  const sourceSequenceRef = useRef(0);
  const timeRef = useRef(0);
  const pausedAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const startingRef = useRef(false);
  const [runConfiguration, setRunConfiguration] = useState<RunConfiguration | null>(null);
  const [completedPlay, setCompletedPlay] = useState<CompletedPlay | null>(null);
  const [completedReplay, setCompletedReplay] = useState<ReplayEvidence | null>(null);
  const [status, setStatus] = useState<GameStatus>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [, setFrame] = useState(0);
  const statusRef = useRef(status);
  const changeStatus = useCallback((next: GameStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const keySignature = JSON.stringify(keyMap);
  const keyToLane = useMemo(() => {
    const map = new Map<string, number>();
    (JSON.parse(keySignature) as string[][]).forEach((codes, lane) =>
      codes.forEach((code) => map.set(code, lane)),
    );
    return map;
  }, [keySignature]);

  useEffect(() => {
    const activeSources = activeSourceIdsRef.current;
    const clock = new AudioClock(() => getAudioSession().getContext());
    clockRef.current = clock;
    setLoadError(null);
    changeStatus("loading");
    clock
      .load(chart.audioUrl)
      .then(() => {
        if (clockRef.current === clock) changeStatus("ready");
      })
      .catch((error: unknown) => {
        if (clockRef.current === clock) {
          setLoadError(error instanceof Error ? error.message : "音源を読み込めませんでした");
          changeStatus("idle");
        }
      });
    return () => {
      statusRef.current = "idle";
      inputs.clear();
      activeSources.clear();
      leaseRef.current?.release();
      leaseRef.current = null;
      clock.dispose();
      if (clockRef.current === clock) clockRef.current = null;
    };
  }, [chart.audioUrl, chart.id, loadAttempt, inputs, changeStatus]);

  useEffect(() => {
    clockRef.current?.setVolume?.(options.volume ?? 1);
  }, [options.volume, status]);

  const dispatch = useCallback((event: GameplayEventInput) => {
    const recorder = replayRef.current;
    if (!recorder) return undefined;
    const outcome = coreRef.current?.process(recorder.append(event));
    // The replay is now ineligible; retain only currently active sources for gameplay.
    if (!recorder.recording) sourceIdsRef.current.clear();
    return outcome;
  }, []);
  const eventTime = useCallback(
    (songTime: number, clockTime = clockRef.current?.now() ?? timeRef.current) => ({
      songTime,
      clockTime,
      elapsedMs: Math.max(0, performance.now() - startedAtRef.current),
    }),
    [],
  );

  const clearInputs = useCallback(() => {
    inputs.clear();
    activeSourceIdsRef.current.clear();
    if (statusRef.current === "playing" || statusRef.current === "paused") {
      dispatch({ type: "clear", ...eventTime(timeRef.current) });
    }
  }, [inputs, dispatch, eventTime]);

  const start = useCallback(
    async (runId?: string, preparedConfiguration?: RunConfiguration): Promise<boolean> => {
      const clock = clockRef.current;
      if (
        !clock ||
        startingRef.current ||
        statusRef.current === "loading" ||
        statusRef.current === "idle"
      )
        return false;
      // Snapshot before the first await: settings/metadata changes during audio unlock cannot rewrite START.
      const configuration = preparedConfiguration ?? createRunConfiguration(chart, options);
      const core = new GameplayCore(chart, configuration);
      const lease = getAudioSession().beginGameplay();
      leaseRef.current?.release();
      leaseRef.current = lease;
      startingRef.current = true;
      try {
        await lease.ready;
        if (!lease.isCurrent() || clockRef.current !== clock) return false;
        await clock.start(START_DELAY, 0, configuration.rate);
        if (!lease.isCurrent() || clockRef.current !== clock) return false;
        inputs.clear();
        sourceIdsRef.current.clear();
        activeSourceIdsRef.current.clear();
        sourceSequenceRef.current = 0;
        coreRef.current = core;
        replayRef.current = new ReplayRecorder(runId ?? crypto.randomUUID(), configuration);
        startedAtRef.current = performance.now();
        setRunConfiguration(configuration);
        setCompletedPlay(null);
        setCompletedReplay(null);
        setLoadError(null);
        timeRef.current = -START_DELAY;
        changeStatus("playing");
        return true;
      } catch (error) {
        lease.release();
        setLoadError(error instanceof Error ? error.message : "再生を開始できませんでした");
        throw error;
      } finally {
        startingRef.current = false;
        if (clockRef.current !== clock || !lease.isCurrent()) lease.release();
      }
    },
    [chart, options, inputs, changeStatus],
  );

  const pressSource = useCallback(
    (source: string, lane: number, stamp?: number) => {
      if (statusRef.current !== "playing") return;
      const bar = inputs.press(source, lane, stamp);
      if (!bar) return;
      const token = sourceIdsRef.current.get(source) ?? ++sourceSequenceRef.current;
      if (replayRef.current?.recording) sourceIdsRef.current.set(source, token);
      activeSourceIdsRef.current.set(source, token);
      const songTime = clockRef.current?.nowAt(bar.start) ?? timeRef.current;
      const outcome = dispatch({ type: "press", source: token, lane, ...eventTime(songTime) });
      if (outcome) bar.outcome = outcome;
      if (
        outcome &&
        ["PERFECT", "GREAT", "GOOD", "MISS"].includes(outcome) &&
        (options.hitSoundVolume ?? 0) > 0
      ) {
        clockRef.current?.playHit?.(options.hitSoundVolume ?? 0);
      }
    },
    [inputs, dispatch, eventTime, options.hitSoundVolume],
  );

  const releaseSource = useCallback(
    (source: string, stamp?: number, cancelled = false) => {
      const bar = inputs.release(source, stamp, cancelled);
      const token = activeSourceIdsRef.current.get(source);
      if (!bar || token === undefined) return;
      activeSourceIdsRef.current.delete(source);
      const songTime = clockRef.current?.nowAt(bar.end) ?? timeRef.current;
      dispatch({
        type: cancelled ? "cancel" : "release",
        source: token,
        lane: bar.lane,
        ...eventTime(songTime),
      });
    },
    [inputs, dispatch, eventTime],
  );

  useEffect(() => {
    if (status !== "playing") return;
    let raf = 0;
    const tick = () => {
      if (statusRef.current !== "playing") return;
      const clock = clockRef.current;
      if (clock) timeRef.current = clock.now();
      const time = timeRef.current;
      dispatch({ type: "advance", ...eventTime(time, time) });
      const core = coreRef.current!;
      const last = core.notes[core.notes.length - 1];
      if (time > Math.max(clock?.duration ?? 0, (last?.time ?? 0) + 2.5)) {
        dispatch({ type: "complete", ...eventTime(time, time) });
        inputs.clear();
        activeSourceIdsRef.current.clear();
        const recorder = replayRef.current;
        if (recorder) {
          setCompletedPlay({
            id: recorder.runId,
            songId: recorder.configuration.songId,
            play: core.snapshotPlay(),
            competitive: recorder.configuration.competitive,
            configuration: recorder.configuration,
            replayStatus: recorder.replayStatus,
          });
          setCompletedReplay(recorder.snapshot());
        }
        leaseRef.current?.release();
        leaseRef.current = null;
        changeStatus("finished");
        return;
      }
      setFrame((frame) => frame + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, dispatch, eventTime, inputs, changeStatus]);

  const latestInput = useRef({ pressSource, releaseSource });
  latestInput.current = { pressSource, releaseSource };
  useEffect(() => {
    if (status !== "playing") return;
    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || statusRef.current !== "playing") return;
      const lane = keyToLane.get(event.code);
      if (lane === undefined) return;
      event.preventDefault();
      latestInput.current.pressSource(`key:${event.code}`, lane, event.timeStamp);
    };
    const up = (event: KeyboardEvent) =>
      latestInput.current.releaseSource(`key:${event.code}`, event.timeStamp);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [keyToLane, status]);

  const pressLane = useCallback(
    (lane: number, source = `touch:lane:${lane}`, stamp?: number) =>
      pressSource(source, lane, stamp),
    [pressSource],
  );
  const releaseLane = useCallback(
    (lane: number, source = `touch:lane:${lane}`, stamp?: number, cancelled = false) => {
      void lane;
      releaseSource(source, stamp, cancelled);
    },
    [releaseSource],
  );

  const pause = useCallback(async () => {
    if (statusRef.current !== "playing") return;
    clearInputs();
    changeStatus("paused");
    const clock = clockRef.current;
    pausedAtRef.current = clock?.pause ? await clock.pause() : timeRef.current;
    timeRef.current = pausedAtRef.current;
    dispatch({ type: "pause", ...eventTime(pausedAtRef.current, pausedAtRef.current) });
  }, [clearInputs, changeStatus, dispatch, eventTime]);
  const resume = useCallback(async () => {
    if (statusRef.current !== "paused" || !clockRef.current || startingRef.current) return;
    const clock = clockRef.current;
    startingRef.current = true;
    try {
      if (clock.resume) await clock.resume(pausedAtRef.current, 0.75);
      if (clockRef.current === clock && statusRef.current === "paused") {
        dispatch({ type: "resume", ...eventTime(pausedAtRef.current, clock.now()) });
        changeStatus("playing");
      }
    } finally {
      startingRef.current = false;
    }
  }, [changeStatus, dispatch, eventTime]);

  useEffect(() => {
    const deactivate = () => {
      if (statusRef.current === "playing") void pause();
      else clearInputs();
    };
    const visibility = () => {
      if (document.hidden) deactivate();
    };
    window.addEventListener("blur", deactivate);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", deactivate);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clearInputs, pause]);

  return {
    status,
    inputs,
    completedPlay,
    completedReplay,
    runConfiguration,
    loadError,
    retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
    start,
    pause,
    resume,
    clearInputs,
    pressLane,
    releaseLane,
    scrollTime,
    windows: coreRef.current.configuration.windows,
    songTime: timeRef.current,
    notes: coreRef.current.notes,
    play: coreRef.current.play,
    activeLanes: inputs.activeLanes,
    duration: clockRef.current?.duration ?? 0,
  };
}
