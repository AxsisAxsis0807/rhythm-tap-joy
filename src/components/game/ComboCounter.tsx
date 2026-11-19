import { useState } from "react";

export function ComboCounter({
  combo,
  enabled,
  fnf = false,
}: {
  combo: number;
  enabled: boolean;
  fnf?: boolean;
}) {
  const tier = combo >= 1000 ? 1000 : combo >= 100 ? 100 : 0;
  const [milestone, setMilestone] = useState({ tier, enabled, active: false });
  // Track the displayed tier, rather than an exact combo value: a chord may
  // cross a threshold between rendered frames.
  if (tier !== milestone.tier || enabled !== milestone.enabled) {
    setMilestone({ tier, enabled, active: enabled && tier > milestone.tier });
  }

  if (combo <= 1) return null;

  const Tag = fnf ? "p" : "span";
  const color = tier === 1000 ? "#ff4848" : tier === 100 ? "#3b9eff" : undefined;
  return (
    <Tag
      data-testid="combo-counter"
      className={
        fnf
          ? "relative font-display text-4xl tabular-nums text-combo"
          : "relative font-display text-4xl tabular-nums text-combo drop-shadow sm:text-5xl"
      }
      style={{ color }}
    >
      {combo}
      {enabled && milestone.active && milestone.tier === tier && (
        <span
          key={tier}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 motion-reduce:hidden"
        >
          <i
            data-testid="combo-milestone-ping"
            className="animate-combo-milestone-ping absolute inset-0 rounded-full border border-current"
            onAnimationEnd={() => setMilestone({ tier, enabled, active: false })}
          />
        </span>
      )}
    </Tag>
  );
}
