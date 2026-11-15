import { describe, expect, it } from "vitest";
import { buildRuntimeNotes, createPlayState } from "@/game/engine";
import { DEFAULT_SETTINGS, resolveJudgeLinePct, sanitizeSettings } from "@/game/settings";
import type { Chart } from "@/game/types";

describe("settings migration", () => {
  it("keeps legacy values and clamps corrupt values", () => {
    const settings = sanitizeSettings({
      showTouchBorders: true,
      middleScroll: true,
      scrollSpeed: 99,
      timingOffsetMs: Infinity,
      keyBindings: ["KeyA", "!", "KeyL", "KeyP"],
    });
    expect(settings.version).toBe(5);
    expect(settings.showTouchBorders).toBe(true);
    expect(settings.middleScroll).toBe(true);
    expect(settings.scrollSpeed).toBe(4);
    expect(settings.timingOffsetMs).toBe(0);
    expect(settings.maniaKeybinds).toEqual(["KeyA", "KeyF", "KeyL", "KeyP"]);
  });

  it("keeps device timing separate from general settings", () => {
    expect(sanitizeSettings({ timingOffsetMs: 10 }, { timingOffsetMs: -27 }).timingOffsetMs).toBe(
      -27,
    );
  });
});

describe("settings source of truth", () => {
  it("keeps new users on the advertised standard rendering preset", () => {
    expect(sanitizeSettings(undefined).renderingPreset).toBe("standard");
    expect(sanitizeSettings({}).renderingPreset).toBe("standard");
    // Existing users without a preset must retain custom rendering flags.
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, renderingPreset: undefined }).renderingPreset).toBe("custom");
  });

  it("keeps general device preferences when a partial device record exists", () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      timingOffsetMs: 11,
      visualOffsetMs: -34,
      laneWidth: 125,
      judgeLinePct: 78,
      touchAreaHeight: 65,
    };
    const loaded = sanitizeSettings(saved, { timingOffsetMs: -27 });
    expect(loaded).toMatchObject({
      timingOffsetMs: -27,
      visualOffsetMs: -34,
      laneWidth: 125,
      judgeLinePct: 78,
      touchAreaHeight: 65,
    });
    expect(sanitizeSettings(saved, { laneWidth: 80, judgeLinePct: 70 })).toMatchObject({
      laneWidth: 80,
      judgeLinePct: 70,
      timingOffsetMs: 11,
      visualOffsetMs: -34,
    });
  });

  it("maps judge positions symmetrically between down and up scrolls", () => {
    for (const stored of [65, 70, 86, 92]) {
      const settings = { judgeLinePct: stored };
      expect(resolveJudgeLinePct(settings, "down")).toBe(stored);
      expect(resolveJudgeLinePct(settings, "up")).toBe(100 - stored);
    }
    expect(resolveJudgeLinePct(DEFAULT_SETTINGS, "up")).toBe(14);
    expect(resolveJudgeLinePct(DEFAULT_SETTINGS, "down")).toBe(86);
  });
});

describe("hold chart preparation", () => {
  it("computes a hold end on the same audio timeline", () => {
    const chart: Chart = {
      id: "hold",
      title: "Hold",
      artist: "Test",
      audioUrl: "/hold",
      bpm: 120,
      offset: 0.25,
      laneCount: 4,
      difficultyName: "TEST",
      notes: [{ beat: 2, lane: 1, kind: "hold", lengthBeats: 4 }],
    };
    expect(buildRuntimeNotes(chart)[0]).toMatchObject({ time: 1.25, endTime: 3.25, kind: "hold" });
  });

  it("starts with an independent timing sample collection", () => {
    const a = createPlayState(),
      b = createPlayState();
    a.timingErrorsMs.push(4);
    expect(b.timingErrorsMs).toEqual([]);
  });
});
