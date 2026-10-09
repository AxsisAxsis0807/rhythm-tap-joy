import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputLedger } from "./input";
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
  const [inputs] = useState(() => new InputLedger());
  const activeLanesRef = useRef(inputs.activeLanes);
  const heldNotesRef = useRef<Map<number, RuntimeNote>>(new Map());
  const pausedAtRef = useRef(0);
  /** Index of the first possibly-unjudged note; keeps auto-miss O(1) per tick. */
  const missCursorRef = useRef(0);

  const runIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const [completedPlay, setCompletedPlay] = useState<CompletedPlay | null>(null);
  const [status, setStatus] = useState<GameStatus>("idle");
  const [, setFrame] = useState(0);

  const statusRef = useRef(status);
  const changeStatus = useCallback((next: GameStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const keySignature = JSON.stringify(keyMap);

  /** lane index by key code, rebuilt when the mapping changes. */
  const keyToLane = useMemo(() => {
    const map = new Map<string, number>();
    (JSON.parse(keySignature) as string[][]).forEach((codes, lane) =>
      codes.forEach((c) => map.set(c, lane)),
    );
    return map;
  }, [keySignature]);

  useEffect(() => {
    const clock = new AudioClock();
    const heldNotes = heldNotesRef.current;
    clockRef.current = clock;
    changeStatus("loading");
    clock
      .load(chart.audioUrl)
      .then(() => {
        if (clockRef.current === clock) changeStatus("ready");
      })
      .catch(() => {
        if (clockRef.current === clock) changeStatus("idle");
      });
    return () => {
      statusRef.current = "idle";
      inputs.clear();
      heldNotes.forEach((n) => {
        n.holding = false;
      });
      heldNotes.clear();
      clock.dispose();
      clockRef.current = null;
    };
  }, [chart.audioUrl, inputs, changeStatus]);

  useEffect(() => {
    (
      clockRef.current as (AudioClock & { setVolume?: (value: number) => void }) | null
    )?.setVolume?.(options.volume ?? 1);
  }, [options.volume]);

  const clearInputs = useCallback(() => {
    inputs.clear();
    heldNotesRef.current.forEach((held) => {
      held.holding = false;
      held.judgement = "MISS";
      applyJudgement(playRef.current, "MISS", 0, scoreRules, timeRef.current);
    });
    heldNotesRef.current.clear();
  }, [inputs, scoreRules]);

  const start = useCallback(async () => {
    const clock = clockRef.current;
    if (!clock || startingRef.current) return;
    startingRef.current = true;
    try {
      await clock.start(START_DELAY);
      if (clockRef.current !== clock) return;
      notesRef.current = buildRuntimeNotes(chart);
      playRef.current = createPlayState();
      heldNotesRef.current.forEach((note) => {
        note.holding = false;
      });
      heldNotesRef.current.clear();
      clearInputs();
      missCursorRef.current = 0;
      runIdRef.current = crypto.randomUUID();
      setCompletedPlay(null);
      timeRef.current = -START_DELAY;
      statusRef.current = "playing";
      changeStatus("playing");
    } finally {
      startingRef.current = false;
    }
  }, [chart, clearInputs, changeStatus]);

  /** Single entry point for every input source (touch, keyboard, future pads). */
  const hitLane = useCallback(
    (lane: number, stamp?: number) => {
      if (statusRef.current !== "playing") return "inactive";
      // Read the clock at the exact moment of input instead of the last frame.
      const time = (clockRef.current?.nowAt(stamp) ?? timeRef.current) + timingOffset;
      const note = findHittableNote(notesRef.current, lane, time, windows);
      if (!note) return "outside-window";
      const delta = time - note.time;
      const judgement = judgeDelta(delta, windows);
      if (!judgement) return "outside-window";
      note.judged = true;
      note.judgement = judgement;
      if (note.kind === "hold" && judgement !== "MISS") {
        note.holding = true;
        heldNotesRef.current.set(lane, note);
      }
      applyJudgement(playRef.current, judgement, delta * 1000, scoreRules, time);
      if ((options.hitSoundVolume ?? 0) > 0) {
        (
          clockRef.current as (AudioClock & { playHit?: (value: number) => void }) | null
        )?.playHit?.(options.hitSoundVolume ?? 0);
      }
      return judgement;
    },
    [windows, scoreRules, timingOffset, options.hitSoundVolume],
  );

  const pressSource = useCallback(
    (source: string, lane: number, stamp?: number) => {
      if (statusRef.current !== "playing") return;
      const bar = inputs.press(source, lane, stamp);
      if (bar) bar.outcome = hitLane(lane, bar.start);
    },
    [hitLane, inputs],
  );

  const releaseSource = useCallback(
    (source: string, stamp?: number, cancelled = false) => {
      const bar = inputs.release(source, stamp, cancelled);
      if (!bar || inputs.activeLanes.has(bar.lane)) return;
      const held = heldNotesRef.current.get(bar.lane);
      if (!held) return;
      const time = (clockRef.current?.nowAt(bar.end) ?? timeRef.current) + timingOffset;
      if (cancelled || (held.endTime !== undefined && time < held.endTime - windows.good)) {
        held.judgement = "MISS";
        applyJudgement(playRef.current, "MISS", 0, scoreRules, time);
      }
      held.holding = false;
      heldNotesRef.current.delete(bar.lane);
    },
    [inputs, scoreRules, timingOffset, windows.good],
  );

  // Main loop: read the audio clock, auto-miss passed notes, redraw.
  useEffect(() => {
    if (status !== "playing") return;
    let raf = 0;
    const tick = () => {
      if (statusRef.current !== "playing") return;
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
        statusRef.current = "finished";
        clearInputs();
        changeStatus("finished");
        return;
      }
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, windows.miss, scoreRules, chart.id, options.competitive, clearInputs, changeStatus]);

  const latestInput = useRef({ pressSource, releaseSource });
  latestInput.current = { pressSource, releaseSource };

  // Keyboard input (external keyboard on phones/tablets works the same way).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || statusRef.current !== "playing") return;
      const lane = keyToLane.get(e.code);
      if (lane === undefined) return;
      e.preventDefault();
      latestInput.current.pressSource(`key:${e.code}`, lane, e.timeStamp);
    };
    const up = (e: KeyboardEvent) => {
      latestInput.current.releaseSource(`key:${e.code}`, e.timeStamp);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [keyToLane]);

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
    changeStatus("paused");
    const clock = clockRef.current as (AudioClock & { pause?: () => Promise<number> }) | null;
    clearInputs();
    pausedAtRef.current = clock?.pause ? await clock.pause() : timeRef.current;
    timeRef.current = pausedAtRef.current;
  }, [clearInputs, changeStatus]);

  const resume = useCallback(async () => {
    if (statusRef.current !== "paused" || !clockRef.current || startingRef.current) return;
    const clock = clockRef.current as AudioClock & {
      resume?: (position: number, delay?: number) => Promise<void>;
    };
    startingRef.current = true;
    try {
      if (clock.resume) await clock.resume(pausedAtRef.current, 0.75);
      if (clockRef.current === clock && statusRef.current === "paused") changeStatus("playing");
    } finally {
      startingRef.current = false;
    }
  }, [changeStatus]);

  useEffect(() => {
    const deactivate = () => {
      clearInputs();
      if (statusRef.current === "playing") void pause();
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
