/** Display contract only: levels, thresholds, rewards and rules come from the server.
 * This repository currently has no XP backend. With no enabled provider, render nothing.
 */
export type GrowthSnapshot = {
  level: string;
  nextLevel: string;
  totalXp: string;
  xpInLevel: string;
  xpToNextLevel: string;
  levelPublic: boolean;
};
export type XpOutcome =
  | { status: "checking" | "pending" }
  | { status: "error"; message: string; retrying: boolean }
  | { status: "ineligible"; reason: string }
  | {
      status: "awarded";
      earnedXp: string;
      previousLevel: string;
      growth: GrowthSnapshot;
      breakdown: { label: string; xp: string; boost?: boolean }[];
    };
export type AccountGrowthState = {
  enabled: boolean;
  ownerId: string;
  growth: GrowthSnapshot | null;
  error?: string;
  rules: string[];
  rewards: Record<string, XpOutcome>;
  selectedTitle?: string;
  supporter?: { badge: string; tier: string; syncState: string };
  boostEnabled?: boolean;
  refresh?: (playId?: string) => void;
};
export function formatXp(value: string) {
  return BigInt(value).toLocaleString();
}
export function growthProgress(growth: GrowthSnapshot) {
  const current = BigInt(growth.xpInLevel);
  const needed = BigInt(growth.xpToNextLevel);
  if (current < 0n || needed <= 0n || current >= needed)
    throw new Error("Invalid server XP progress");
  return {
    current,
    needed,
    remaining: needed - current,
    percent: Number((current * 10_000n) / needed) / 100,
  };
}
