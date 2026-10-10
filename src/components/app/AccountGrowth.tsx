import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { subscribeToPlayResultQueue } from "@/lib/playResultQueue";

import {
  formatXp,
  growthProgress,
  type GrowthSnapshot,
  type XpOutcome,
  type AccountGrowthState,
} from "@/lib/accountGrowth";
export type { GrowthSnapshot, XpOutcome, AccountGrowthState } from "@/lib/accountGrowth";

const GrowthContext = createContext<AccountGrowthState | null>(null);
export function AccountGrowthProvider({
  value,
  children,
}: {
  value: AccountGrowthState | null;
  children: React.ReactNode;
}) {
  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    if (!value?.enabled || !value.refresh) return;
    return subscribeToPlayResultQueue((event) => {
      const key = `${event.ownerId}:${event.playId}`;
      if (
        event.ownerId === value.ownerId &&
        event.status === "saved" &&
        !refreshed.current.has(key)
      ) {
        refreshed.current.add(key);
        if (refreshed.current.size > 200)
          refreshed.current.delete(refreshed.current.values().next().value!);
        value.refresh?.(event.playId);
      }
    });
  }, [value]);
  return <GrowthContext.Provider value={value}>{children}</GrowthContext.Provider>;
}
function useGrowth(ownerId: string) {
  const value = useContext(GrowthContext);
  return value?.enabled && value.ownerId === ownerId ? value : null;
}
function XpBar({ growth }: { growth: GrowthSnapshot }) {
  const { percent } = growthProgress(growth);
  return (
    <div
      role="progressbar"
      aria-label={`Lv. ${growth.level} XP進捗`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${formatXp(growth.xpInLevel)} / ${formatXp(growth.xpToNextLevel)} XP`}
      className="my-3 h-2 overflow-hidden rounded-full bg-white/10"
    >
      <div
        className="h-full rounded-full bg-cyan-200/80 motion-safe:transition-[width] motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
function ProgressDetails({ growth }: { growth: GrowthSnapshot }) {
  const { remaining } = growthProgress(growth);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 break-words text-cyan-100">
        <p className="font-display text-lg">Lv. {formatXp(growth.level)}</p>
        <p className="text-xs">NEXT Lv. {formatXp(growth.nextLevel)}</p>
      </div>
      <XpBar growth={growth} />
      <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums text-white/65 [overflow-wrap:anywhere]">
        <p>
          {formatXp(growth.xpInLevel)} / {formatXp(growth.xpToNextLevel)} XP
        </p>
        <p>次のLevelまで{remaining.toLocaleString()} XP</p>
      </div>
    </>
  );
}
function GrowthInfo({ data }: { data: AccountGrowthState }) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const growth = data.growth!;
  const description = (
    <>
      <p>Levelはアカウントの成長を表し、実力や世界順位とは別です。</p>
      <p className="mt-3">
        現在 Lv. {formatXp(growth.level)} · 累計 {formatXp(growth.totalXp)} XP
      </p>
      <p>次のLevelまで {growthProgress(growth).remaining.toLocaleString()} XP</p>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        {data.rules.map((rule, i) => (
          <li key={i}>{rule}</li>
        ))}
      </ul>
      <p className="mt-3">デイリー更新の基準はUTCです。</p>
    </>
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="LevelとXPの説明"
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-cyan-100 hover:bg-white/10"
      >
        <Info className="size-5" />
      </button>
      {mobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[85dvh] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <DrawerTitle className="py-4">LevelとXP</DrawerTitle>
            <DrawerDescription asChild>
              <div className="break-words text-sm">{description}</div>
            </DrawerDescription>
            <button className="mt-4 min-h-11 text-cyan-100" onClick={() => setOpen(false)}>
              閉じる
            </button>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto [&>button]:min-h-11 [&>button]:min-w-11">
            <DialogTitle>LevelとXP</DialogTitle>
            <DialogDescription asChild>
              <div className="break-words text-sm">{description}</div>
            </DialogDescription>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
export function ProfileGrowth({ userId, own = true }: { userId: string; own?: boolean }) {
  const data = useGrowth(userId);
  if (!data || (!own && data.growth?.levelPublic === false)) return null;
  if (!data.growth)
    return (
      <div
        role={data.error ? "alert" : "status"}
        className="mb-5 rounded-2xl border border-cyan-200/15 p-4 text-sm text-white/60"
      >
        {data.error ? "成長情報を読み込めませんでした。" : "成長情報を読み込み中…"}
        {data.error && (
          <button className="ml-2 min-h-11 underline" onClick={() => data.refresh?.()}>
            再読み込み
          </button>
        )}
      </div>
    );
  return (
    <section
      aria-label="LevelとXP"
      className="mb-5 w-full min-w-0 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[10px] tracking-[0.2em] text-cyan-100/70">ACCOUNT GROWTH</h2>
        <GrowthInfo data={data} />
      </div>
      <ProgressDetails growth={data.growth} />
    </section>
  );
}
export function HomeLevel({ userId }: { userId: string }) {
  const data = useGrowth(userId);
  if (!data?.growth) return null;
  return (
    <span className="shrink-0 text-xs tabular-nums text-cyan-100">
      Lv. {formatXp(data.growth.level)}
    </span>
  );
}
export function SupporterBadge({ userId }: { userId: string }) {
  const data = useGrowth(userId);
  if (!data?.supporter) return null;
  return (
    <span className="shrink-0 rounded-full border border-cyan-200/20 px-2 py-1 text-[10px] text-cyan-100">
      {data.supporter.badge}
    </span>
  );
}
export function SelectedTitle({ userId }: { userId: string }) {
  const data = useGrowth(userId);
  return data?.selectedTitle ? (
    <p className="mb-4 break-words text-sm text-cyan-100/80">{data.selectedTitle}</p>
  ) : null;
}
export function SupporterStatus({ userId }: { userId: string }) {
  const data = useGrowth(userId);
  if (!data?.supporter) return null;
  return (
    <section className="mb-5 rounded-2xl border border-white/10 p-4 text-sm">
      <h2 className="mb-2 text-white/60">Supporter</h2>
      <p className="break-words">
        {data.supporter.tier} · {data.supporter.syncState}
      </p>
    </section>
  );
}
export function ResultXpCard({ userId, playId }: { userId: string | null; playId: string | null }) {
  const data = useGrowth(userId ?? "");
  if (!data || !userId || !playId) return null;
  const reward = data.rewards[playId] ?? { status: "checking" as const };
  return (
    <section
      aria-label="XP獲得"
      aria-live="polite"
      className="w-full min-w-0 max-w-sm rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4 text-left text-sm [overflow-wrap:anywhere]"
    >
      <h3 className="mb-2 text-xs tracking-widest text-cyan-100/70">XP獲得</h3>
      {reward.status === "checking" && <p>獲得XPを確認中…</p>}
      {reward.status === "pending" && <p>XPの反映待ちです</p>}
      {reward.status === "error" && (
        <>
          <p role="alert">XPを確認できませんでした。{reward.message}</p>
          <p className="mt-2 text-xs text-white/60">
            通常プレイを続けられます。
            {reward.retrying ? "再試行を待っています。" : "再試行できます。"}
          </p>
          <button className="min-h-11 underline" onClick={() => data.refresh?.(playId)}>
            XPを再確認
          </button>
        </>
      )}
      {reward.status === "ineligible" && (
        <>
          <p>このプレイはXP対象外です</p>
          <p className="mt-1 text-xs text-white/60">{reward.reason}</p>
        </>
      )}
      {reward.status === "awarded" && (
        <>
          <p className="font-display text-2xl text-cyan-100">+{formatXp(reward.earnedXp)} XP</p>
          <ul className="my-2 text-xs text-white/60">
            {reward.breakdown
              .filter((row) => !row.boost || data.boostEnabled)
              .map((row, i) => (
                <li key={i}>
                  {row.label} +{formatXp(row.xp)}
                </li>
              ))}
          </ul>
          {reward.previousLevel !== reward.growth.level && (
            <p className="mb-2 text-cyan-100">
              Lv. {formatXp(reward.previousLevel)} → Lv. {formatXp(reward.growth.level)}
            </p>
          )}
          <ProgressDetails growth={reward.growth} />
        </>
      )}
    </section>
  );
}
