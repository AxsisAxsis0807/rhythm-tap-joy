import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioClock } from "./audio";
import {
  DEFAULT_KEY_MAP,
  DEFAULT_SCORE_RULES,
  DEFAULT_SCROLL_TIME,
  DEFAULT_WINDOWS,
  START_DELAY,
} from "./config";
import {
  applyJudgement,
  buildRuntimeNotes,
  createPlayState,
  findHittableNote,
  judgeDelta,
} from "./engine";
import type {
  Chart,
  CompletedPlay,
  JudgementWindows,
  PlayState,
  RuntimeNote,
  ScoreRules,
} from "./types";

export type GameStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "finished";

export interface RhythmGameOptions {
  windows?: JudgementWindows;
  scoreRules?: ScoreRules;
  keyMap?: string[][];
  scrollTime?: number;
  timingOffsetMs?: number;
  volume?: number;
  hitSoundVolume?: number;
  competitive?: boolean;
}

export function useRhythmGame(chart: Chart, options: RhythmGameOptions = {}) {
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const scoreRules = options.scoreRules ?? DEFAULT_SCORE_RULES;
  const keyMap = options.keyMap ?? DEFAULT_KEY_MAP;
  const scrollTime = options.scrollTime ?? DEFAULT_SCROLL_TIME;
  const timingOffset = (options.timingOffsetMs ?? 0) / 1000;

  const clockRef = useRef<AudioClock | null>(null);
  const notesRef = useRef<RuntimeNote[]>(buildRuntimeNotes(chart));
  const playRef = useRef<PlayState>(createPlayState());
  const timeRef = useRef(0);
  const activeLanesRef = useRef<Set<number>>(new Set());
  const inputSourcesRef = useRef<Map<string, number>>(new Map());
  const heldNotesRef = useRef<Map<number, RuntimeNote>>(new Map());
  const pausedAtRef = useRef(0);
  /** Index of the first possibly-unjudged note; keeps auto-miss O(1) per tick. */
  const missCursorRef = useRef(0);

  const runIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const [completedPlay, setCompletedPlay] = useState<CompletedPlay | null>(null);
  const [status, setStatus] = useState<GameStatus>("idle");
  const [, setFrame] = useState(0);

  /** lane index by key code, rebuilt when the mapping changes. */
  const keyToLane = useMemo(() => {
    const map = new Map<string, number>();
    keyMap.forEach((codes, lane) => codes.forEach((c) => map.set(c, lane)));
    return map;
  }, [keyMap]);

  useEffect(() => {
    const clock = new AudioClock();
    clockRef.current = clock;
    setStatus("loading");
    clock
      .load(chart.audioUrl)
      .then(() => setStatus("ready"))
      .catch(() => setStatus("idle"));
    return () => {
      clock.dispose();
      clockRef.current = null;
    };
  }, [chart.audioUrl]);

  useEffect(() => {
    (
      clockRef.current as (AudioClock & { setVolume?: (value: number) => void }) | null
    )?.setVolume?.(options.volume ?? 1);
  }, [options.volume]);

  const clearInputs = useCallback(() => {
    inputSourcesRef.current.clear();
    activeLanesRef.current.clear();
  }, []);

  const start = useCallback(async () => {
    const clock = clockRef.current;
    if (!clock || startingRef.current) return;
    startingRef.current = true;
    try {
      await clock.start(START_DELAY);
      notesRef.current = buildRuntimeNotes(chart);
      playRef.current = createPlayState();
      heldNotesRef.current.clear();
      clearInputs();
      missCursorRef.current = 0;
      runIdRef.current = crypto.randomUUID();
      setCompletedPlay(null);
      timeRef.current = -START_DELAY;
      setStatus("playing");
    } finally {
      startingRef.current = false;
    }
  }, [chart, clearInputs]);

  /** Single entry point for every input source (touch, keyboard, future pads). */
  const hitLane = useCallback(
    (lane: number) => {
      if (status !== "playing") return;
      // Read the clock at the exact moment of input instead of the last frame.
      const time = (clockRef.current?.now() ?? timeRef.current) + timingOffset;
      const note = findHittableNote(notesRef.current, lane, time, windows);
      if (!note) return;
      const delta = time - note.time;
      const judgement = judgeDelta(delta, windows);
      if (!judgement) return;
      note.judged = true;
      note.judgement = judgement;
      if (note.kind === "hold") {
        note.holding = true;
        heldNotesRef.current.set(lane, note);
      }
      applyJudgement(playRef.current, judgement, delta * 1000, scoreRules, time);
      if ((options.hitSoundVolume ?? 0) > 0) {
        (
          clockRef.current as (AudioClock & { playHit?: (value: number) => void }) | null
        )?.playHit?.(options.hitSoundVolume ?? 0);
      }
    },
    [status, windows, scoreRules, timingOffset, options.hitSoundVolume],
  );

  const pressSource = useCallback(
    (source: string, lane: number) => {
      if (inputSourcesRef.current.has(source)) return;
      const alreadyPressed = Array.from(inputSourcesRef.current.values()).includes(lane);
      inputSourcesRef.current.set(source, lane);
      activeLanesRef.current.add(lane);
      if (!alreadyPressed) hitLane(lane);
    },
    [hitLane],
  );

  const releaseSource = useCallback(
    (source: string) => {
      const lane = inputSourcesRef.current.get(source);
      if (lane === undefined) return;
      inputSourcesRef.current.delete(source);
      if (!Array.from(inputSourcesRef.current.values()).includes(lane)) {
        activeLanesRef.current.delete(lane);
        const held = heldNotesRef.current.get(lane);
        if (held) {
          const time = clockRef.current?.now() ?? timeRef.current;
          if (held.endTime !== undefined && time < held.endTime - windows.good) {
            held.judgement = "MISS";
            applyJudgement(playRef.current, "MISS", 0, scoreRules, time);
          }
          held.holding = false;
          heldNotesRef.current.delete(lane);
        }
      }
    },
    [scoreRules, windows.good],
  );

  // Main loop: read the audio clock, auto-miss passed notes, redraw.
  useEffect(() => {
    if (status !== "playing") return;
    let raf = 0;
    const tick = () => {
      const clock = clockRef.current;
      if (clock) timeRef.current = clock.now();
      const time = timeRef.current;
      const all = notesRef.current;
      heldNotesRef.current.forEach((note, lane) => {
        if (note.endTime !== undefined && time >= note.endTime) {
          note.holding = false;
          heldNotesRef.current.delete(lane);
        }
      });
      let cursor = missCursorRef.current;
      while (cursor < all.length) {
        const note = all[cursor]!;
        if (note.judged) {
          cursor++;
          continue;
        }
        if (time - note.time > windows.miss) {
          note.judged = true;
          note.judgement = "MISS";
          applyJudgement(playRef.current, "MISS", 0, scoreRules, time);
          cursor++;
        } else break;
      }
      missCursorRef.current = cursor;
      const last = notesRef.current[notesRef.current.length - 1];
      // Wait for the entire audio and the last judgement window, including empty charts.
      if (time > Math.max(clock?.duration ?? 0, (last?.time ?? 0) + 2.5)) {
        if (runIdRef.current) {
          setCompletedPlay({
            id: runIdRef.current,
            songId: chart.id,
            play: {
              ...playRef.current,
              counts: { ...playRef.current.counts },
              timingErrorsMs: [...playRef.current.timingErrorsMs],
            },
            competitive: options.competitive !== false,
          });
        }
        setStatus("finished");
        return;
      }
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, windows.miss, scoreRules, chart.id, options.competitive]);

  // Keyboard input (external keyboard on phones/tablets works the same way).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const lane = keyToLane.get(e.code);
      if (lane === undefined) return;
      e.preventDefault();
      pressSource(`key:${e.code}`, lane);
    };
    const up = (e: KeyboardEvent) => {
      const lane = keyToLane.get(e.code);
      if (lane !== undefined) releaseSource(`key:${e.code}`);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [keyToLane, pressSource, releaseSource]);

  const pressLane = useCallback(
    (lane: number, source = `touch:lane:${lane}`) => pressSource(source, lane),
    [pressSource],
  );
  const releaseLane = useCallback(
    (lane: number, source = `touch:lane:${lane}`) => {
      void lane;
      releaseSource(source);
    },
    [releaseSource],
  );

  const pause = useCallback(async () => {
    if (status !== "playing") return;
    const clock = clockRef.current as (AudioClock & { pause?: () => Promise<number> }) | null;
    pausedAtRef.current = clock?.pause ? await clock.pause() : timeRef.current;
    timeRef.current = pausedAtRef.current;
    clearInputs();
    setStatus("paused");
  }, [clearInputs, status]);

  const resume = useCallback(async () => {
    if (status !== "paused" || !clockRef.current) return;
    const clock = clockRef.current as AudioClock & {
      resume?: (position: number, delay?: number) => Promise<void>;
    };
    if (clock.resume) await clock.resume(pausedAtRef.current, 0.75);
    setStatus("playing");
  }, [status]);

  useEffect(() => {
    const deactivate = () => {
      clearInputs();
      if (status === "playing") void pause();
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
  }, [clearInputs, pause, status]);

  return {
    status,
    completedPlay,
    start,
    pause,
    resume,
    clearInputs,
    pressLane,
    releaseLane,
    scrollTime,
    windows,
    songTime: timeRef.current,
    notes: notesRef.current,
    play: playRef.current,
    activeLanes: activeLanesRef.current,
    duration: clockRef.current?.duration ?? 0,
  };
}
