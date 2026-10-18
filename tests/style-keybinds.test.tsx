import { useState } from "react";
import { act, cleanup, fireEvent, render, renderHook, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGameSettingsStore,
  DEFAULT_SETTINGS,
  resolveKeyMap,
  sanitizeSettings,
} from "@/game/settings";
import { SettingsPanel } from "@/components/game/SettingsPanel";
import { useRhythmGame } from "@/game/useRhythmGame";
import { InputOverlay } from "@/components/game/InputOverlay";
import type { Chart } from "@/game/types";
let songTime = 1;
vi.mock("@/game/audio", () => ({
  AudioClock: class {
    duration = 10;
    load = async () => {};
    start = async () => {};
    now = () => songTime;
    nowAt = () => songTime;
    pause = async () => songTime;
    resume = async () => {};
    dispose = () => {};
  },
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
  songTime = 1;
});
const chart: Chart = {
  id: "keys",
  title: "Keys",
  artist: "Test",
  audioUrl: "test",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "Test",
  notes: [0, 1, 2, 3].map((lane) => ({ beat: 1, lane, kind: "hold", lengthBeats: 2 })),
};
function memory(initial: unknown) {
  const items = new Map([["pulse-lane:game-settings", JSON.stringify(initial)]]);
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      items.set(k, v);
    },
  };
}
describe("style settings migration", () => {
  it("copies legacy primary independently, preserves Lovable secondary and remains idempotent", () => {
    const migrated = sanitizeSettings({
      version: 3,
      keyBindings: ["KeyQ", "KeyW", "KeyO", "KeyP"],
      altKeyBindings: ["ArrowLeft", "", "ArrowUp", "ArrowRight"],
    });
    expect(migrated.maniaKeybinds).toEqual(["KeyQ", "KeyW", "KeyO", "KeyP"]);
    expect(migrated.fnfKeybinds.primary).toEqual(migrated.maniaKeybinds);
    expect(migrated.fnfKeybinds.primary).not.toBe(migrated.maniaKeybinds);
    expect(migrated.fnfKeybinds.secondary[1]).toBe("");
    expect(sanitizeSettings(migrated)).toEqual(migrated);
    migrated.maniaKeybinds[0] = "KeyZ";
    expect(migrated.fnfKeybinds.primary[0]).toBe("KeyQ");
  });
  it("repairs corruption and cross-lane conflicts without stealing later valid assignments", () => {
    const settings = sanitizeSettings({
      keyBindings: [null, "KeyD", "KeyD", "Escape"],
      altKeyBindings: ["KeyD", "KeyD", "Bogus", ""],
    });
    expect(settings.maniaKeybinds[1]).toBe("KeyD");
    for (const style of ["mania", "fnf"] as const) {
      const keys = resolveKeyMap(settings, style).flat();
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(sanitizeSettings(settings)).toEqual(settings);
    for (const broken of [
      undefined,
      null,
      "bad json",
      [],
      { fnfKeybinds: null },
      { maniaKeybinds: ["", "Tab", "F1", "Unknown"] },
    ])
      expect(() => sanitizeSettings(broken)).not.toThrow();
  });
  it("deduplicates the same lane but rejects another lane's physical key", () => {
    const settings = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      fnfKeybinds: {
        primary: ["KeyA", "KeyS", "KeyW", "KeyD"],
        secondary: ["KeyA", "KeyA", "", ""],
      },
    });
    expect(resolveKeyMap(settings, "fnf")[0]).toEqual(["KeyA"]);
    expect(resolveKeyMap(settings, "fnf")[1]).not.toContain("KeyA");
    expect(resolveKeyMap(settings, "mania").flat()).not.toContain("ArrowLeft");
  });
  it("persists both styles across hydration and reports write failures", () => {
    const storage = memory({ keyBindings: ["KeyQ", "KeyW", "KeyO", "KeyP"] });
    const store = createGameSettingsStore(storage);
    store.hydrate();
    store.setSettings((s) => ({
      ...s,
      maniaKeybinds: ["KeyZ", ...s.maniaKeybinds.slice(1)] as typeof s.maniaKeybinds,
    }));
    const reloaded = createGameSettingsStore(storage);
    reloaded.hydrate();
    expect(reloaded.getSnapshot().settings).toEqual(store.getSnapshot().settings);
    expect(reloaded.getSnapshot().settings.fnfKeybinds.primary[0]).toBe("KeyQ");
    const failed = createGameSettingsStore({
      getItem: () => "{",
      setItem: () => {
        throw new Error("quota");
      },
    });
    failed.hydrate();
    failed.setSettings(DEFAULT_SETTINGS);
    expect(failed.getSnapshot().saveError).toBe(true);
  });
});
function Editor() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  return (
    <>
      <SettingsPanel open settings={settings} onChange={setSettings} onClose={() => {}} />
      <output data-testid="settings">{JSON.stringify(settings)}</output>
    </>
  );
}
it("shows one/two sets, isolates edits, rejects invalid/ambiguous keys and previews the editing style", () => {
  const view = render(<Editor />);
  fireEvent.click(view.getByRole("button", { name: "操作" }));
  expect(view.queryByText(/SET 2/)).toBeNull();
  expect(view.queryByText("シンプル")).toBeNull();
  const captures = () => view.getAllByRole("button").filter((b) => b.textContent?.startsWith("L"));
  fireEvent.click(captures()[0]!);
  fireEvent.keyDown(window, { code: "KeyQ", key: "q" });
  fireEvent.click(view.getByRole("button", { name: "FNF" }));
  expect(view.getByText(/SET 2/)).toBeTruthy();
  expect(captures()).toHaveLength(8);
  fireEvent.click(captures()[0]!);
  fireEvent.keyDown(window, { code: "KeyZ", key: "z" });
  fireEvent.click(captures()[1]!);
  fireEvent.keyDown(window, { code: "KeyZ", key: "z" });
  expect(view.getByText("重複")).toBeTruthy();
  fireEvent.click(captures()[1]!);
  fireEvent.keyDown(window, { code: "Unidentified", key: "" });
  expect(view.getByText("使用不可")).toBeTruthy();
  const value = JSON.parse(view.getByTestId("settings").textContent!);
  expect(value.maniaKeybinds[0]).toBe("KeyQ");
  expect(value.fnfKeybinds.primary[0]).toBe("KeyZ");
  expect(value.lastPlayedStyle).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "入力テストを開始" }));
  fireEvent.keyDown(window, { code: "ArrowLeft" });
  const overlay = view.getByTestId("input-overlay");
  expect(overlay.querySelector('[data-source="key:ArrowLeft"]')).toBeTruthy();
  fireEvent.keyUp(window, { code: "ArrowLeft" });
  fireEvent.click(view.getByRole("button", { name: "OSU!MANIA" }));
  fireEvent.keyDown(window, { code: "ArrowLeft" });
  expect(view.getByText(/保持 0/)).toBeTruthy();
  expect(view.getByText("LIVE PREVIEW")).toBeTruthy();
});
for (const style of ["mania", "fnf"] as const) {
  it(`${style}: keyboard resolution, chords, hold ownership, overlay, repeat, pause, retry`, async () => {
    const { result } = renderHook(() =>
      useRhythmGame(chart, { playStyle: style, keyMap: resolveKeyMap(DEFAULT_SETTINGS, style) }),
    );
    await act(async () => {});
    await act(async () => {
      await result.current.start();
    });
    const view = render(
      <InputOverlay inputs={result.current.inputs} settings={DEFAULT_SETTINGS} playStyle={style} />,
    );
    const keys = resolveKeyMap(DEFAULT_SETTINGS, style);
    act(() => {
      for (const lane of keys) fireEvent.keyDown(window, { code: lane[0] });
    });
    expect(result.current.play.counts.PERFECT).toBe(4);
    expect(result.current.activeLanes.size).toBe(4);
    expect(view.getByTestId("input-overlay").querySelectorAll("[data-source]")).toHaveLength(4);
    const score = result.current.play.score;
    act(() => {
      keys.forEach((lane) => fireEvent.keyDown(window, { code: lane[0], repeat: true }));
      if (style === "fnf") keys.forEach((lane) => fireEvent.keyDown(window, { code: lane[1] }));
    });
    expect(result.current.play.score).toBe(score);
    expect(result.current.play.counts.MISS).toBe(0);
    act(() => keys.forEach((lane) => fireEvent.keyUp(window, { code: lane[0] })));
    expect(result.current.activeLanes.size).toBe(style === "fnf" ? 4 : 0);
    if (style === "fnf") {
      expect(result.current.notes.every((n) => n.holding)).toBe(true);
      songTime = 3;
      act(() => keys.forEach((lane) => fireEvent.keyUp(window, { code: lane[1] })));
      expect(result.current.play.counts.MISS).toBe(0);
    }
    expect(result.current.activeLanes.size).toBe(0);
    await act(async () => {
      fireEvent.blur(window);
    });
    expect(result.current.status).toBe("paused");
    await act(async () => {
      await result.current.start();
    });
    songTime = 1;
    act(() => fireEvent.keyDown(window, { code: style === "fnf" ? "ArrowLeft" : "KeyD" }));
    expect(result.current.play.counts.PERFECT).toBe(1);
    expect(result.current.runConfiguration?.playStyle).toBe(style);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"));
    });
    expect(result.current.status).toBe("paused");
    expect(result.current.inputs.sources.size).toBe(0);
    expect(within(view.getByTestId("input-overlay")).getByText(/LEFT/)).toBeTruthy();
  });
}
