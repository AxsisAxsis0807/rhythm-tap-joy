import { useXpEvidenceDelivery } from "@/lib/usePlaySession";
import { useAuth } from "@/lib/useAuth";
import { useAccountGrowth } from "@/lib/useAccountGrowth";
import { useGameSettings } from "@/game/settings";
import { AccountGrowthProvider } from "./AccountGrowth";
export function LiveGrowthProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  useXpEvidenceDelivery(user?.id ?? null);
  const { settings } = useGameSettings();
  const value = useAccountGrowth(user?.id ?? null, settings.reducedMotion);
  return <AccountGrowthProvider value={value}>{children}</AccountGrowthProvider>;
}
