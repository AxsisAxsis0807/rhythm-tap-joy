import { useEffect, useState } from "react";

export interface GameSettings {
  showTouchBorders: boolean;
  middleScroll: boolean;
  scrollSpeed: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  showTouchBorders: false,
  middleScroll: false,
  scrollSpeed: 1,
};

const STORAGE_KEY = "pulse-lane:game-settings";

export function useGameSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const stored = raw ? JSON.parse(raw) : {};
      setSettings({
        showTouchBorders: stored.showTouchBorders === true,
        middleScroll: stored.middleScroll === true,
        scrollSpeed: typeof stored.scrollSpeed === "number" && Number.isFinite(stored.scrollSpeed)
          ? Math.max(0.5, Math.min(3, stored.scrollSpeed)) : 1,
      });
    } catch { /* Unavailable storage leaves safe defaults. */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSaveError(false);
    } catch { setSaveError(true); }
  }, [settings, loaded]);
  return { settings, setSettings, saveError };
}