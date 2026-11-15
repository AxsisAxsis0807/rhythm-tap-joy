import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyRenderingPreset,
  DEFAULT_SETTINGS,
  effectiveRendering,
  sanitizeSettings,
} from "@/game/settings";
import { InputOverlayLayer, InputOverlayPreview } from "@/components/game/InputOverlay";
import { NoteSprite } from "@/components/game/NoteSprite";
import { FnfField } from "@/components/game/FnfField";
import { SettingsPanel } from "@/components/game/SettingsPanel";
import { buildRuntimeNotes } from "@/game/engine";
import type { Chart } from "@/game/types";
import { InputLedger } from "@/game/input";
import { getMode } from "@/game/modes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("migrates existing v5 settings idempotently without applying a preset", () => {
  const old = {
    ...DEFAULT_SETTINGS,
    renderingPreset: undefined,
    timingOffsetMs: -27,
    visualOffsetMs: 18,
    scrollSpeed: 1.75,
    masterVolume: 0.31,
    touchAreaHeight: 67,
    inputOverlayEnabled: false,
    screenShake: true,
  };
  const once = sanitizeSettings(old);
  expect(once).toMatchObject({
    version: 5,
    renderingPreset: "custom",
    timingOffsetMs: -27,
    visualOffsetMs: 18,
    scrollSpeed: 1.75,
    masterVolume: 0.31,
    touchAreaHeight: 67,
    inputOverlayEnabled: false,
    screenShake: true,
  });
  expect(sanitizeSettings(once, once)).toEqual(once);
});
it.each(["standard", "light", "recording"] as const)(
  "%s changes only rendering controls",
  (preset) => {
    const initial = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      scrollSpeed: 2,
      timingOffsetMs: -53,
      visualOffsetMs: 28,
      touchAreaHeight: 61,
      masterVolume: 0.17,
    });
    const next = applyRenderingPreset(initial, preset);
    const allowed = new Set([
      "renderingPreset",
      "lightweightMode",
      "reducedMotion",
      "glowEffects",
      "hitEffects",
      "screenShake",
      "backgroundEffects",
      "inputOverlayEnabled",
    ]);
    for (const key of Object.keys(initial) as (keyof typeof initial)[])
      if (!allowed.has(key)) expect(next[key], key).toEqual(initial[key]);
    expect(applyRenderingPreset(next, preset)).toEqual(next);
    expect(next.inputOverlayEnabled).toBe(preset !== "light");
  },
);
it("uses lightweight and reduced-motion overrides for every decorative policy", () => {
  const all = { ...DEFAULT_SETTINGS, screenShake: true };
  expect(effectiveRendering(all)).toEqual({
    glow: true,
    hitPing: true,
    shake: true,
    background: true,
  });
  expect(effectiveRendering({ ...all, lightweightMode: true })).toEqual({
    glow: false,
    hitPing: false,
    shake: false,
    background: false,
  });
  expect(effectiveRendering({ ...all, reducedMotion: true })).toEqual({
    glow: true,
    hitPing: false,
    shake: false,
    background: true,
  });
});
it.each(["standard", "circle"])("disables the %s note shadow", (id) => {
  const mode = {
    ...getMode("mania"),
    noteShape: id === "circle" ? ("circle" as const) : ("bar" as const),
  };
  const { container } = render(<NoteSprite mode={mode} lane={0} glow={false} />);
  expect(container.querySelector(".shadow-note")).toBeNull();
  expect((container.firstChild as HTMLElement).style.boxShadow).toBe("");
});
it("OFF unmounts all display effects through 20 re-entries while ledger inputs continue", () => {
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect = disconnect;
    },
  );
  let serial = 0;
  const frames = new Set<number>();
  vi.stubGlobal("requestAnimationFrame", () => {
    frames.add(++serial);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const input = new InputLedger();
  const subscribe = vi.spyOn(input, "subscribe");
  const { container, rerender } = render(
    <InputOverlayLayer
      inputs={input}
      settings={{ ...DEFAULT_SETTINGS, inputOverlayEnabled: false }}
    />,
  );
  expect(container.childElementCount).toBe(0);
  expect(subscribe).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
  for (let i = 0; i < 20; i++) {
    rerender(<InputOverlayLayer inputs={input} settings={DEFAULT_SETTINGS} />);
    expect(frames.size).toBe(1);
    act(() => {
      input.press("key:KeyD", 0);
    });
    rerender(
      <InputOverlayLayer
        inputs={input}
        settings={{ ...DEFAULT_SETTINGS, inputOverlayEnabled: false }}
      />,
    );
    expect(frames.size).toBe(0);
    expect(input.sources.size).toBe(1);
    input.release("key:KeyD");
    expect(input.sources.size).toBe(0);
    expect(container.childElementCount).toBe(0);
  }
  expect(input.accepted).toBe(20);
  expect(disconnect).toHaveBeenCalledTimes(40);
});
it("updates sprite presentation when mode properties mutate without a new object", () => {
  const mode = { ...getMode("mania"), laneColors: ["red"], noteSize: 40 };
  const { container, rerender } = render(
    <NoteSprite mode={mode} lane={0} receptor pressed={false} />,
  );
  expect((container.firstChild as HTMLElement).style.opacity).toBe("0.45");
  mode.noteSize = 60;
  mode.laneColors[0] = "blue";
  rerender(<NoteSprite mode={mode} lane={0} receptor pressed />);
  const circle = container.firstChild as HTMLElement;
  expect(circle.style.width).toBe("60px");
  expect(circle.style.borderColor).toBe("blue");
  expect(circle.style.opacity).toBe("0.95");
  mode.noteShape = "arrow";
  rerender(<NoteSprite mode={mode} lane={2} glow={false} />);
  expect(container.querySelector("path")?.getAttribute("transform")).toBe("rotate(270 32 32)");
});

it("FNF applies note scale, lane width, opacity and visual timing to both banks", () => {
  const chart: Chart = {
    id: "fnf-display-settings",
    title: "Display Settings",
    artist: "Test",
    audioUrl: "/fixture.wav",
    bpm: 60,
    offset: 0,
    laneCount: 4,
    difficultyName: "Test",
    notes: [{ beat: 1, lane: 0, kind: "tap" }],
    fnf: {
      playerSide: "right",
      right: [{ beat: 1, lane: 0, kind: "tap" }],
      left: [{ beat: 0.5, lane: 0, kind: "tap" }],
    },
  };
  const notes = buildRuntimeNotes(chart);
  const base = {
    chart,
    mode: getMode("fnf"),
    notes,
    scrollTime: 2,
    activeLanes: new Set<number>(),
    middleScroll: false,
  };
  const view = render(<FnfField {...base} songTime={0.25} />);
  const beforeTop = view.getByTestId("player-note-0").style.top;
  const beforeTime = notes[0]!.time;
  view.rerender(
    <FnfField
      {...base}
      songTime={0.35}
      noteScale={140}
      laneWidth={125}
      laneOpacity={50}
      middleScroll
    />,
  );
  expect(view.getByTestId("player-note-0").style.transform).toContain("scale(1.4)");
  expect(view.getByTestId("player-note-0").style.top).not.toBe(beforeTop);
  expect(view.getByTestId("fnf-right").style.width).toBe("50%");
  expect(view.getByTestId("fnf-right").style.opacity).toBe("1");
  expect(view.getByTestId("fnf-left").style.width).toBe("30%");
  expect(view.getByTestId("fnf-left").style.opacity).toBe("0.4");
  expect(view.getByTestId("fnf-right").querySelector<HTMLElement>(".bg-lane")?.style.opacity).toBe(
    "0.5",
  );
  expect(view.getByTestId("fnf-left").querySelector<HTMLElement>(".bg-lane")?.style.opacity).toBe(
    "0.5",
  );
  expect(view.getByTestId("opponent-receptor-0").style.transform).toContain("scale(1.4)");
  expect(notes[0]!.time).toBe(beforeTime);
  expect(notes[0]!.judged).toBe(false);
  view.rerender(<FnfField {...base} songTime={0.25} noteScale={70} laneWidth={70} />);
  expect(view.getByTestId("player-note-0").style.transform).toContain("scale(0.7)");
  expect(view.getByTestId("fnf-right").style.width).toBe("28%");
});

it("input overlay preview uses the same judge position as each gameplay direction", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const view = render(<InputOverlayPreview settings={DEFAULT_SETTINGS} playStyle="fnf" />);
  expect(view.getByTestId("input-preview-judge-line-0").style.top).toBe("14%");
  view.rerender(
    <InputOverlayPreview
      settings={{ ...DEFAULT_SETTINGS, scrollDirection: "down", judgeLinePct: 70 }}
      playStyle="fnf"
    />,
  );
  expect(view.getByTestId("input-preview-judge-line-0").style.top).toBe("70%");
  view.rerender(
    <InputOverlayPreview
      settings={{ ...DEFAULT_SETTINGS, scrollDirection: "mode", judgeLinePct: 85 }}
      playStyle="mania"
    />,
  );
  expect(view.getByTestId("input-preview-judge-line-0").style.top).toBe("85%");
});

it("settings panel preview tracks the effective judge line and visual percentages", () => {
  const props = { open: true, onChange: () => {}, onClose: () => {}, fnf: true };
  const view = render(<SettingsPanel {...props} settings={DEFAULT_SETTINGS} />);
  expect(view.getByTestId("settings-preview-judge-line").style.top).toBe("14%");
  view.rerender(
    <SettingsPanel
      {...props}
      settings={{ ...DEFAULT_SETTINGS, judgeLinePct: 75, scrollDirection: "down" }}
    />,
  );
  expect(view.getByTestId("settings-preview-judge-line").style.top).toBe("75%");
});
