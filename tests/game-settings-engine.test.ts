import { describe, expect, it } from "vitest";
import { buildRuntimeNotes, createPlayState } from "@/game/engine";
import { sanitizeSettings } from "@/game/settings";
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
    expect(settings.version).toBe(2);
    expect(settings.showTouchBorders).toBe(true);
    expect(settings.middleScroll).toBe(true);
    expect(settings.scrollSpeed).toBe(4);
    expect(settings.timingOffsetMs).toBe(0);
    expect(settings.keyBindings).toEqual(["KeyA", "KeyF", "KeyL", "KeyP"]);
  });

  it("keeps device timing separate from general settings", () => {
    expect(sanitizeSettings({ timingOffsetMs: 10 }, { timingOffsetMs: -27 }).timingOffsetMs).toBe(
      -27,
    );
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
