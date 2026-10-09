import { useEffect, useState } from "react";

export type ScrollDirectionSetting = "mode" | "down" | "up";
export type NoteShapeSetting = "mode" | "bar" | "circle" | "arrow";
export type SettingsPreset = "simple" | "readable" | "effects" | "custom";

export interface GameSettings {
  version: 2;
  showTouchBorders: boolean;
  middleScroll: boolean;
  scrollSpeed: number;
  scrollDirection: ScrollDirectionSetting;
  timingOffsetMs: number;
  visualOffsetMs: number;
  masterVolume: number;
  musicVolume: number;
  hitSoundVolume: number;
  menuVolume: number;
  hitSoundEnabled: boolean;
  keyBindings: [string, string, string, string];
  laneWidth: number;
  noteScale: number;
  judgeLinePct: number;
  noteShape: NoteShapeSetting;
  backgroundDim: number;
  laneOpacity: number;
  showFastLate: boolean;
  showErrorMeter: boolean;
  showProgress: boolean;
  hitEffects: boolean;
  glowEffects: boolean;
  screenShake: boolean;
  backgroundEffects: boolean;
  reducedMotion: boolean;
  lightweightMode: boolean;
  showFps: boolean;
  touchAreaHeight: number;
  inputOverlayEnabled: boolean;
  inputOverlayPosition: "left" | "right";
  inputOverlaySize: number;
  inputOverlayOpacity: number;
  inputOverlayDuration: number;
  preset: SettingsPreset;
}

export const DEFAULT_SETTINGS: GameSettings = {
  version: 2,
  showTouchBorders: false,
  middleScroll: false,
  scrollSpeed: 1,
  scrollDirection: "mode",
  timingOffsetMs: 0,
  visualOffsetMs: 0,
  masterVolume: 0.8,
  musicVolume: 0.9,
  hitSoundVolume: 0.55,
  menuVolume: 0.7,
  hitSoundEnabled: true,
  keyBindings: ["KeyD", "KeyF", "KeyJ", "KeyK"],
  laneWidth: 100,
  noteScale: 100,
  judgeLinePct: 86,
  noteShape: "mode",
  backgroundDim: 55,
  laneOpacity: 82,
  showFastLate: true,
  showErrorMeter: true,
  showProgress: true,
  hitEffects: true,
  glowEffects: true,
  screenShake: false,
  backgroundEffects: true,
  reducedMotion: false,
  lightweightMode: false,
  showFps: false,
  touchAreaHeight: 100,
  inputOverlayEnabled: true,
  inputOverlayPosition: "right",
  inputOverlaySize: 100,
  inputOverlayOpacity: 0.8,
  inputOverlayDuration: 2,
  preset: "simple",
};

const STORAGE_KEY = "pulse-lane:game-settings";
const DEVICE_STORAGE_KEY = "pulse-lane:device-settings:v2";
const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function sanitizeSettings(stored: unknown, deviceStored?: unknown): GameSettings {
  const s = typeof stored === "object" && stored ? (stored as Partial<GameSettings>) : {};
  const d =
    typeof deviceStored === "object" && deviceStored ? (deviceStored as Partial<GameSettings>) : s;
  const keys = Array.isArray(s.keyBindings) ? s.keyBindings : [];
  const pick = <T extends string>(v: unknown, values: T[], fallback: T) =>
    values.includes(v as T) ? (v as T) : fallback;
  return {
    ...DEFAULT_SETTINGS,
    showTouchBorders: bool(s.showTouchBorders, false),
    middleScroll: bool(s.middleScroll, false),
    scrollSpeed: clamp(s.scrollSpeed, 0.5, 4, 1),
    scrollDirection: pick(s.scrollDirection, ["mode", "down", "up"], "mode"),
    timingOffsetMs: clamp(d.timingOffsetMs, -300, 300, 0),
    visualOffsetMs: clamp(d.visualOffsetMs, -300, 300, 0),
    masterVolume: clamp(s.masterVolume, 0, 1, 0.8),
    musicVolume: clamp(s.musicVolume, 0, 1, 0.9),
    hitSoundVolume: clamp(s.hitSoundVolume, 0, 1, 0.55),
    menuVolume: clamp(s.menuVolume, 0, 1, 0.7),
    hitSoundEnabled: bool(s.hitSoundEnabled, true),
    keyBindings: DEFAULT_SETTINGS.keyBindings.map((fallback, i) =>
      typeof keys[i] === "string" && /^[A-Za-z0-9]+$/.test(keys[i]) ? keys[i] : fallback,
    ) as GameSettings["keyBindings"],
    laneWidth: clamp(d.laneWidth, 70, 130, 100),
    noteScale: clamp(s.noteScale, 70, 140, 100),
    judgeLinePct: clamp(d.judgeLinePct, 65, 92, 86),
    noteShape: pick(s.noteShape, ["mode", "bar", "circle", "arrow"], "mode"),
    backgroundDim: clamp(s.backgroundDim, 0, 90, 55),
    laneOpacity: clamp(s.laneOpacity, 25, 100, 82),
    showFastLate: bool(s.showFastLate, true),
    showErrorMeter: bool(s.showErrorMeter, true),
    showProgress: bool(s.showProgress, true),
    hitEffects: bool(s.hitEffects, true),
    glowEffects: bool(s.glowEffects, true),
    screenShake: bool(s.screenShake, false),
    backgroundEffects: bool(s.backgroundEffects, true),
    reducedMotion: bool(s.reducedMotion, false),
    lightweightMode: bool(s.lightweightMode, false),
    showFps: bool(s.showFps, false),
    touchAreaHeight: clamp(d.touchAreaHeight, 45, 100, 100),
    inputOverlayEnabled: bool(s.inputOverlayEnabled, true),
    inputOverlayPosition: pick(s.inputOverlayPosition, ["left", "right"], "right"),
    inputOverlaySize: clamp(s.inputOverlaySize, 70, 140, 100),
    inputOverlayOpacity: clamp(s.inputOverlayOpacity, 0.2, 1, 0.8),
    inputOverlayDuration: clamp(s.inputOverlayDuration, 0.5, 5, 2),
    preset: pick(s.preset, ["simple", "readable", "effects", "custom"], "custom"),
  };
}

export function applyPreset(
  s: GameSettings,
  preset: Exclude<SettingsPreset, "custom">,
): GameSettings {
  const base = { ...s, preset };
  if (preset === "readable")
    return {
      ...base,
      noteScale: 120,
      laneOpacity: 100,
      backgroundDim: 75,
      glowEffects: false,
      backgroundEffects: false,
    };
  if (preset === "effects")
    return {
      ...base,
      noteScale: 105,
      laneOpacity: 88,
      backgroundDim: 45,
      hitEffects: true,
      glowEffects: true,
      backgroundEffects: true,
    };
  return {
    ...base,
    noteScale: 100,
    laneOpacity: 82,
    backgroundDim: 55,
    hitEffects: true,
    glowEffects: true,
    screenShake: false,
  };
}

export function useGameSettings() {
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY),
        device = localStorage.getItem(DEVICE_STORAGE_KEY);
      setSettingsState(
        sanitizeSettings(raw ? JSON.parse(raw) : {}, device ? JSON.parse(device) : undefined),
      );
    } catch {
      /* corrupt/unavailable storage uses safe defaults */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      localStorage.setItem(
        DEVICE_STORAGE_KEY,
        JSON.stringify({
          version: 2,
          timingOffsetMs: settings.timingOffsetMs,
          visualOffsetMs: settings.visualOffsetMs,
          laneWidth: settings.laneWidth,
          judgeLinePct: settings.judgeLinePct,
          touchAreaHeight: settings.touchAreaHeight,
        }),
      );
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [settings, loaded]);
  const setSettings: React.Dispatch<React.SetStateAction<GameSettings>> = (next) =>
    setSettingsState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      return sanitizeSettings(value, value);
    });
  return { settings, setSettings, saveError, loaded };
}
