import type { GameSettings } from "./settings";

export const INPUT_OVERLAY_DEFAULTS = {
  inputOverlayEnabled: true,
  inputOverlayX: 85,
  inputOverlayY: 18,
  inputOverlaySize: 100,
  inputOverlayKeyWidth: 42,
  inputOverlayKeyHeight: 32,
  inputOverlayGap: 4,
  inputOverlayHistoryHeight: 72,
  inputOverlayOpacity: 0.8,
  inputOverlayDuration: 2,
};
export type OverlayViewport = {
  width: number;
  height: number;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
};
export function inputOverlayMetrics(s: GameSettings) {
  // Includes 6px padding + 1px border on each edge, a 12px caption and two 4px gaps.
  return {
    width: s.inputOverlayKeyWidth * 4 + s.inputOverlayGap * 3 + 14,
    height: s.inputOverlayHistoryHeight + s.inputOverlayKeyHeight + 34,
  };
}
/** Coordinates refer to the card CENTER in the safe display area. Keep requested
 * settings across resize; only the displayed bounds/scale are corrected to fit. */
export function inputOverlayLayout(s: GameSettings, viewport: OverlayViewport) {
  const insetLeft = (viewport.left ?? 0) + 8,
    insetTop = (viewport.top ?? 0) + 8;
  const width = Math.max(0, viewport.width - insetLeft - (viewport.right ?? 0) - 8);
  const height = Math.max(0, viewport.height - insetTop - (viewport.bottom ?? 0) - 8);
  const metrics = inputOverlayMetrics(s);
  const scale = Math.max(
    0,
    Math.min(s.inputOverlaySize / 100, width / metrics.width, height / metrics.height),
  );
  const drawnWidth = metrics.width * scale,
    drawnHeight = metrics.height * scale;
  const x = Math.max(
    drawnWidth / 2,
    Math.min(width - drawnWidth / 2, (width * s.inputOverlayX) / 100),
  );
  const y = Math.max(
    drawnHeight / 2,
    Math.min(height - drawnHeight / 2, (height * s.inputOverlayY) / 100),
  );
  return {
    left: insetLeft + x - drawnWidth / 2,
    top: insetTop + y - drawnHeight / 2,
    width: drawnWidth,
    height: drawnHeight,
    scale,
  };
}
export function resetInputOverlay(settings: GameSettings): GameSettings {
  return { ...settings, ...INPUT_OVERLAY_DEFAULTS, preset: "custom" };
}
