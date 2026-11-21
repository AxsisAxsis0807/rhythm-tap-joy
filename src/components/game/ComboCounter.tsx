import { useEffect, useState } from "react";
import {
  DEFAULT_COMBO_RIPPLE_COLOR,
  FIXED_COMBO_RIPPLE_RED,
  getComboMilestone,
  isFixedRedComboMilestone,
} from "@/game/comboMilestone";

export function ComboCounter({
  combo,
  enabled,
  fnf = false,
  rippleColor = DEFAULT_COMBO_RIPPLE_COLOR,
}: {
  combo: number;
  enabled: boolean;
  fnf?: boolean;
  rippleColor?: string;
}) {
  const milestone = getComboMilestone(combo);
  const [effect, setEffect] = useState({ milestone, enabled, active: false });

  // Compare milestone numbers, not display frames: simultaneous notes may skip
  // an exact multiple of 100, and the display must never replay an old ripple.
  if (milestone !== effect.milestone || enabled !== effect.enabled) {
    setEffect({
      milestone,
      enabled,
      active: enabled && milestone > effect.milestone,
    });
  }

  const active = enabled && effect.active && effect.milestone === milestone;
  useEffect(() => {
    if (!active) return;
    // Clear the ripple when the animation completes, even without animationend.
    const timeout = window.setTimeout(() => {
      setEffect({ milestone, enabled, active: false });
    }, 750);
    return () => window.clearTimeout(timeout);
  }, [active, milestone, enabled]);

  if (combo <= 1) return null;

  const Tag = fnf ? "p" : "span";
  const borderColor = isFixedRedComboMilestone(milestone) ? FIXED_COMBO_RIPPLE_RED : rippleColor;

  return (
    <Tag
      data-testid="combo-counter"
      className={
        fnf
          ? "relative font-display text-4xl tabular-nums text-combo"
          : "relative font-display text-4xl tabular-nums text-combo drop-shadow sm:text-5xl"
      }
    >
      {combo}
      {active && (
        <span
          key={milestone}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 motion-reduce:hidden"
        >
          <i
            data-testid="combo-milestone-ping"
            className="animate-combo-milestone-ping absolute inset-0 rounded-full border"
            style={{ borderColor }}
          />
        </span>
      )}
    </Tag>
  );
}
