/** Display contract only: levels, thresholds, rewards and rules come from the server. */
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
      receiptId?: string;
      reason?: string;
      earnedXp: string;
      previousLevel: string;
      growth: GrowthSnapshot;
      breakdown: {
        label: string;
        xp: string;
        requestedXp?: string;
        cappedXp?: string;
        boost?: boolean;
      }[];
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
  reducedMotion?: boolean;
  unavailablePlayIds?: string[];
  profile?: CardPreferences;
  profileError?: string;
  savingProfile?: boolean;
  saveProfile?: (patch: CardPreferencePatch) => Promise<void>;
  refresh?: (playId?: string) => void;
};
export type CardCrop = { x: number; y: number; zoom: number };
export type CardPreferences = {
  version: number;
  levelPublic: boolean;
  cardImage: { assetId: string; url: string } | null;
  crop: CardCrop;
  imageUploadEnabled: false;
};
export type CardPreferencePatch = {
  expectedVersion: number;
  levelPublic?: boolean;
  crop?: CardCrop;
  removeImage?: boolean;
};
export const DEFAULT_CARD_CROP: CardCrop = { x: 0.5, y: 0.5, zoom: 1 };

export function validCardCrop(crop: CardCrop) {
  return (
    Number.isFinite(crop.x) &&
    crop.x >= 0 &&
    crop.x <= 1 &&
    Number.isFinite(crop.y) &&
    crop.y >= 0 &&
    crop.y <= 1 &&
    Number.isFinite(crop.zoom) &&
    crop.zoom >= 1 &&
    crop.zoom <= 3
  );
}

/** One geometry supplies both the background clip and the un-clipped SVG outline. */
export function levelCardGeometry(width: number, height: number) {
  const w = Math.max(1, width),
    h = Math.max(1, height);
  const cut = Math.min(70, w * 0.11);
  const foot = Math.min(35, w * 0.055);
  const points = [
    [cut, 0.5],
    [w - 0.5, 0.5],
    [w - 0.5, h - 0.5],
    [foot, h - 0.5],
    [0.5, h * 0.72],
  ];
  return {
    polygon: `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(", ")})`,
    path: `${points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ")} Z`,
    inset: cut + 12,
  };
}

const animatedReceipts = new Set<string>();
/** If persistence is unavailable, prefer a static receipt to replaying an effect on reload. */
export function claimLevelUpAnimation(ownerId: string, receiptId: string) {
  const key = `pulse-lane:level-up:v1:${ownerId}:${receiptId}`;
  if (animatedReceipts.has(key)) return false;
  animatedReceipts.add(key);
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, "seen");
    return true;
  } catch {
    return false;
  }
}
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
