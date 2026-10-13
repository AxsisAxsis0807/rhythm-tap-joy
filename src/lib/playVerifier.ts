import { GameplayCore } from "@/game/gameplayCore";
import { START_DELAY } from "@/game/config";
import { createRunConfiguration } from "@/game/runConfiguration";
import type { Chart } from "@/game/types";
import { replaySchema, canonicalJson } from "./xpContract";
import { evaluateParticipation } from "./xpRules";
import { MAX_REPLAY_BYTES } from "@/game/replay";

export function verifyReplay(
  chart: Chart,
  durationMs: number,
  payload: unknown,
  elapsedServerMs: number,
) {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_REPLAY_BYTES)
    throw new Error("replay_too_large");
  const replay = replaySchema.parse(payload);
  const config = replay.configuration;
  const expected = createRunConfiguration(chart, {
    playStyle: config.playStyle,
    visualMode: config.visualMode,
    timingOffsetMs: config.timingOffsetMs,
    revisionId: chart.revisionId ?? null,
  });
  if (canonicalJson(config) !== canonicalJson(expected))
    throw new Error("run_configuration_mismatch");
  const core = new GameplayCore(chart, config);
  let sequence = 0,
    elapsed = 0,
    clock = -START_DELAY,
    paused = false,
    pauseAt = 0,
    completion = false;
  for (const e of replay.events) {
    if (
      completion ||
      e.sequence !== ++sequence ||
      e.elapsedMs < elapsed ||
      e.elapsedMs > elapsedServerMs + 500
    )
      throw new Error("invalid_sequence_or_elapsed_time");
    const clockDelta = e.clockTime - clock;
    if (
      clockDelta > (e.elapsedMs - elapsed) / 1000 + 0.05 ||
      (clockDelta < -0.02 && !(e.type === "resume" && clockDelta >= -0.8))
    )
      throw new Error("invalid_audio_clock");
    if (e.type === "press" || e.type === "release" || e.type === "cancel") {
      if (e.songTime > e.clockTime + 0.02 || e.songTime < e.clockTime - 0.5 || paused)
        throw new Error("invalid_input_time");
      if (e.type === "press" && core.sources.has(e.source)) throw new Error("duplicate_source");
      if (e.type !== "press" && core.sources.get(e.source) !== e.lane)
        throw new Error("invalid_input_source");
    } else if (
      e.type !== "clear" &&
      e.type !== "resume" &&
      Math.abs(e.songTime - e.clockTime) > 0.05
    )
      throw new Error("invalid_advance_time");
    if (e.type === "pause") {
      if (paused) throw new Error("duplicate_pause");
      paused = true;
      pauseAt = e.elapsedMs;
    }
    if (e.type === "resume") {
      if (!paused || e.elapsedMs - pauseAt > 300000) throw new Error("invalid_pause_duration");
      paused = false;
    }
    if (e.type === "complete") {
      const end = Math.max(durationMs / 1000, (core.notes.at(-1)?.time ?? 0) + 2.5);
      if (paused || e.songTime <= end || elapsedServerMs < (end + START_DELAY) * 1000 - 500)
        throw new Error("incomplete_audio");
      completion = true;
    }
    core.process(e);
    elapsed = e.elapsedMs;
    clock = e.clockTime;
  }
  if (!completion || core.notes.some((n) => !n.judged || n.holding))
    throw new Error("incomplete_judgements");
  const notesById = new Map(core.notes.map((n) => [n.id, n]));
  const participation = evaluateParticipation({
    heads: core.notes.map((n) => ({
      id: n.id,
      timeMs: Math.round(n.time * 1000),
      ...(n.endTime !== undefined ? { holdEndMs: Math.round(n.endTime * 1000) } : {}),
    })),
    successfulHeadIds: core.hitHeadIds,
    durationMs,
    heldIntervals: core.heldIntervals.map((h) => {
      const note = notesById.get(h.noteId)!;
      return [
        Math.round(Math.max(note.time, h.startedAt) * 1000),
        Math.round(Math.min(note.endTime ?? note.time, h.endedAt) * 1000),
      ] as const;
    }),
  });
  return { ...participation, play: core.snapshotPlay(), verifierVersion: "pulse-verifier-v1" };
}
