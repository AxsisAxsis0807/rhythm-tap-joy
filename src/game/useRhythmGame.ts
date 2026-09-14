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
  JudgementWindows,
  PlayState,
  RuntimeNote,
  ScoreRules,
} from "./types";

export type GameStatus = "idle" | "loading" | "ready" | "playing" | "finished";

export interface RhythmGameOptions {
  windows?: JudgementWindows;
  scoreRules?: ScoreRules;
  keyMap?: string[][];
  scrollTime?: number;
}

export function useRhythmGame(chart: Chart, options: RhythmGameOptions = {}) {
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const scoreRules = options.scoreRules ?? DEFAULT_SCORE_RULES;
  const keyMap = options.keyMap ?? DEFAULT_KEY_MAP;
  const scrollTime = options.scrollTime ?? DEFAULT_SCROLL_TIME;

  const clockRef = useRef<AudioClock | null>(null);
  const notesRef = useRef<RuntimeNote[]>(buildRuntimeNotes(chart));
  const playRef = useRef<PlayState>(createPlayState());
  const timeRef = useRef(0);
  const activeLanesRef = useRef<Set<number>>(new Set());
  /** Index of the first possibly-unjudged note; keeps auto-miss O(1) per tick. */
  const missCursorRef = useRef(0);

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

  const start = useCallback(async () => {
    const clock = clockRef.current;
    if (!clock) return;
    notesRef.current = buildRuntimeNotes(chart);
    playRef.current = createPlayState();
    missCursorRef.current = 0;
    await clock.start(START_DELAY);
    timeRef.current = -START_DELAY;
    setStatus("playing");
  }, [chart]);

  /** Single entry point for every input source (touch, keyboard, future pads). */
  const hitLane = useCallback(
    (lane: number) => {
      if (status !== "playing") return;
      const time = timeRef.current;
      const note = findHittableNote(notesRef.current, lane, time, windows);
      if (!note) return;
      const delta = time - note.time;
      const judgement = judgeDelta(delta, windows);
      if (!judgement) return;
      note.judged = true;
      note.judgement = judgement;
      applyJudgement(playRef.current, judgement, delta * 1000, scoreRules, time);
    },
    [status, windows, scoreRules],
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
      if (last && time > last.time + 2.5) {
        setStatus("finished");
        return;
      }
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, windows.miss, scoreRules]);

  // Keyboard input (external keyboard on phones/tablets works the same way).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const lane = keyToLane.get(e.code);
      if (lane === undefined) return;
      e.preventDefault();
      activeLanesRef.current.add(lane);
      hitLane(lane);
    };
    const up = (e: KeyboardEvent) => {
      const lane = keyToLane.get(e.code);
      if (lane !== undefined) activeLanesRef.current.delete(lane);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [keyToLane, hitLane]);

  const pressLane = useCallback(
    (lane: number) => {
      activeLanesRef.current.add(lane);
      hitLane(lane);
    },
    [hitLane],
  );

  const releaseLane = useCallback((lane: number) => {
    activeLanesRef.current.delete(lane);
  }, []);

  return {
    status,
    start,
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
