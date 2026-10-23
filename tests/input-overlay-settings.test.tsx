import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createGameSettingsStore,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  useGameSettings,
} from "@/game/settings";
import {
  inputOverlayLayout,
  inputOverlayMetrics,
  resetInputOverlay,
} from "@/game/inputOverlayLayout";
import { SettingsPanel } from "@/components/game/SettingsPanel";
beforeEach(() => {
  localStorage.clear();
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
  cleanup();
  vi.unstubAllGlobals();
});
it("migrates v2 left/right placement without losing preferences; bounds new/corrupt fields", () => {
  const old = sanitizeSettings({
    version: 2,
    inputOverlayPosition: "left",
    inputOverlaySize: 135,
    inputOverlayOpacity: 0.45,
    keyBindings: ["KeyA", "KeyS", "KeyL", "KeyP"],
  });
  expect(old).toMatchObject({
    version: 5,
    inputOverlayX: 15,
    inputOverlayY: 18,
    inputOverlaySize: 135,
    inputOverlayOpacity: 0.45,
    maniaKeybinds: ["KeyA", "KeyS", "KeyL", "KeyP"],
  });
  expect(sanitizeSettings({ version: 2, inputOverlayPosition: "right" }).inputOverlayX).toBe(85);
  const bounded = sanitizeSettings({
    inputOverlayX: Infinity,
    inputOverlayY: -20,
    inputOverlayKeyWidth: 500,
    inputOverlayKeyHeight: 0,
    inputOverlayGap: NaN,
    inputOverlayHistoryHeight: 999,
    inputOverlaySize: 2000,
    inputOverlayOpacity: 99,
  });
  expect(bounded).toMatchObject({
    inputOverlayX: 85,
    inputOverlayY: 0,
    inputOverlayKeyWidth: 120,
    inputOverlayKeyHeight: 16,
    inputOverlayGap: 4,
    inputOverlayHistoryHeight: 360,
    inputOverlaySize: 200,
    inputOverlayOpacity: 1,
  });
});
it("all edge placements and large overlays fit phone/landscape/desktop and safe areas without overwriting saved coordinates", () => {
  for (const [width, height] of [
    [360, 744],
    [844, 354],
    [1440, 864],
    [320, 220],
  ])
    for (const x of [0, 50, 100])
      for (const y of [0, 50, 100]) {
        const s = {
          ...DEFAULT_SETTINGS,
          inputOverlayX: x,
          inputOverlayY: y,
          inputOverlayKeyWidth: 120,
          inputOverlayKeyHeight: 120,
          inputOverlayGap: 24,
          inputOverlayHistoryHeight: 360,
          inputOverlaySize: 200,
        };
        const viewport = {
            width: width!,
            height: height!,
            left: 34,
            right: 8,
            top: 10,
            bottom: 20,
          },
          result = inputOverlayLayout(s, viewport);
        expect(result.left).toBeGreaterThanOrEqual(42 - 0.00001);
        expect(result.top).toBeGreaterThanOrEqual(18 - 0.00001);
        expect(result.left + result.width).toBeLessThanOrEqual(width! - 16 + 0.00001);
        expect(result.top + result.height).toBeLessThanOrEqual(height! - 28 + 0.00001);
        expect(s.inputOverlayX).toBe(x);
        expect(s.inputOverlayY).toBe(y);
      }
  const s = { ...DEFAULT_SETTINGS, inputOverlayX: 50, inputOverlayY: 50 };
  const center = inputOverlayLayout(s, { width: 1000, height: 600 });
  expect(center.left + center.width / 2).toBe(500);
  expect(center.top + center.height / 2).toBe(300);
});
it("geometry applies each dimension independently and reset does not alter gameplay/audio/touch preferences", () => {
  expect(
    inputOverlayMetrics({
      ...DEFAULT_SETTINGS,
      inputOverlayKeyWidth: 60,
      inputOverlayKeyHeight: 40,
      inputOverlayGap: 10,
      inputOverlayHistoryHeight: 160,
    }),
  ).toEqual({ width: 284, height: 234 });
  const adjusted = {
    ...DEFAULT_SETTINGS,
    inputOverlayX: 0,
    inputOverlayY: 100,
    inputOverlaySize: 180,
    inputOverlayEnabled: false,
    timingOffsetMs: 27,
    masterVolume: 0.3,
    touchAreaHeight: 60,
  };
  const reset = resetInputOverlay(adjusted);
  expect(reset).toMatchObject({
    ...DEFAULT_SETTINGS,
    timingOffsetMs: 27,
    masterVolume: 0.3,
    touchAreaHeight: 60,
    preset: "custom",
  });
});
it("saves and restores v5 fields only after hydration; device timing remains separate", async () => {
  const saved = {
    ...DEFAULT_SETTINGS,
    inputOverlayX: 25.75,
    inputOverlayY: 78.2,
    inputOverlayKeyWidth: 76,
    inputOverlayKeyHeight: 48,
    inputOverlayGap: 10,
    inputOverlayHistoryHeight: 220,
    inputOverlaySize: 140,
    inputOverlayOpacity: 0.35,
  };
  localStorage.setItem("pulse-lane:game-settings", JSON.stringify(saved));
  localStorage.setItem("pulse-lane:device-settings:v2", JSON.stringify({ timingOffsetMs: 23 }));
  const store = createGameSettingsStore(localStorage);
  store.hydrate();
  expect(store.getSnapshot().settings).toEqual({ ...saved, timingOffsetMs: 23 });
  store.setSettings((s) => ({ ...s, inputOverlayX: 88.4, inputOverlayY: 10.1 }));
  const secondStore = createGameSettingsStore(localStorage);
  secondStore.hydrate();
  expect(secondStore.getSnapshot().settings).toMatchObject({
    inputOverlayX: 88.4,
    inputOverlayY: 10.1,
    inputOverlayKeyWidth: 76,
    inputOverlayHistoryHeight: 220,
    timingOffsetMs: 23,
  });
});
it("settings offer labelled number/slider pairs, preview, recenter, local reset and visibility", async () => {
  function Panel() {
    const [settings, set] = useState({ ...DEFAULT_SETTINGS, masterVolume: 0.3 });
    return <SettingsPanel open settings={settings} onChange={set} onClose={() => {}} />;
  }
  render(<Panel />);
  fireEvent.click(screen.getByRole("button", { name: "入力可視化", exact: true }));
  for (const label of [
    "横位置",
    "縦位置",
    "全体の大きさ",
    "キー表示の幅",
    "キー表示の高さ",
    "キー同士の間隔",
    "棒の表示領域の高さ",
    "不透明度",
  ]) {
    expect(screen.getByLabelText(`${label} 数値`)).toBeTruthy();
    expect(screen.getByRole("slider", { name: `${label} スライダー` })).toBeTruthy();
  }
  fireEvent.change(screen.getByLabelText("横位置 数値"), { target: { value: "33.3" } });
  expect(
    screen.getByRole("slider", { name: "横位置 スライダー" }).getAttribute("aria-valuenow"),
  ).toBe("33.3");
  fireEvent.change(screen.getByLabelText("キー表示の幅 数値"), { target: { value: "77" } });
  expect(screen.getByTestId("input-overlay").style.width).toBe("334px");
  fireEvent.click(screen.getByRole("button", { name: "中央に戻す", exact: true }));
  expect((screen.getByLabelText("横位置 数値") as HTMLInputElement).value).toBe("50");
  expect((screen.getByLabelText("縦位置 数値") as HTMLInputElement).value).toBe("50");
  fireEvent.click(screen.getByRole("switch", { name: "入力可視化を表示" }));
  expect(screen.queryByTestId("input-overlay")).toBeNull();
  expect(screen.getByText("入力可視化は非表示です")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "初期設定に戻す", exact: true }));
  expect((screen.getByLabelText("キー表示の幅 数値") as HTMLInputElement).value).toBe("42");
  expect(screen.getByTestId("input-overlay")).toBeTruthy();
});

it("preserves v4 style keys, preview and device settings through overlay migration", () => {
  const settings = sanitizeSettings(
    {
      version: 4,
      maniaKeybinds: ["KeyQ", "KeyW", "KeyO", "KeyP"],
      fnfKeybinds: {
        primary: ["KeyA", "KeyS", "KeyW", "KeyD"],
        secondary: ["ArrowLeft", "", "ArrowUp", "ArrowRight"],
      },
      autoPreview: false,
      previewVolume: 0.25,
      lastPlayedStyle: "fnf",
      maniaSkin: "classic",
      inputOverlayPosition: "left",
    },
    { timingOffsetMs: 43, laneWidth: 115, touchAreaHeight: 65 },
  );
  expect(settings).toMatchObject({
    version: 5,
    inputOverlayX: 15,
    maniaKeybinds: ["KeyQ", "KeyW", "KeyO", "KeyP"],
    fnfKeybinds: {
      primary: ["KeyA", "KeyS", "KeyW", "KeyD"],
      secondary: ["ArrowLeft", "", "ArrowUp", "ArrowRight"],
    },
    autoPreview: false,
    previewVolume: 0.25,
    lastPlayedStyle: "fnf",
    maniaSkin: "classic",
    timingOffsetMs: 43,
    laneWidth: 115,
    touchAreaHeight: 65,
  });
  expect(sanitizeSettings(settings)).toEqual(settings);
});
