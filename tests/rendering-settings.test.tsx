import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyRenderingPreset,
  DEFAULT_SETTINGS,
  effectiveRendering,
  sanitizeSettings,
} from "@/game/settings";
import { InputOverlayLayer } from "@/components/game/InputOverlay";
import { NoteSprite } from "@/components/game/NoteSprite";
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
