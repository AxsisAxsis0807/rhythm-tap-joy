/** A new visual milestone is reached on every complete set of 100 combo. */
export const DEFAULT_COMBO_RIPPLE_COLOR = "#3b9eff";
export const FIXED_COMBO_RIPPLE_RED = "#ff4848";

export function getComboMilestone(combo: number): number {
  if (!Number.isSafeInteger(combo) || combo < 100) return 0;
  return Math.floor(combo / 100) * 100;
}

export function isFixedRedComboMilestone(milestone: number): boolean {
  return milestone > 0 && milestone % 1000 === 0;
}
