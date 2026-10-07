import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleUserRound, Trophy } from "lucide-react";
import type { PlayerRanking } from "@/integrations/supabase/types";
import { fetchLeaderboard, fetchPlayerRanking, rankingKeys } from "@/lib/playerRanking";

function formatInteger(value: string) {
  try {
    return BigInt(value).toLocaleString();
  } catch {
    return value;
  }
}

function ErrorNotice({ retry }: { retry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100"
    >
      統計を読み込めませんでした。
      <button type="button" onClick={retry} className="ml-3 underline">
        再読み込み
      </button>
    </div>
  );
}

export function PlayerStats({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: rankingKeys.player(userId),
    queryFn: () => fetchPlayerRanking(userId),
  });
  if (query.isPending)
    return (
      <p role="status" className="mb-5 text-sm text-white/50">
        実績を読み込み中…
      </p>
    );
  if (query.isError)
    return (
      <div className="mb-5">
        <ErrorNotice retry={() => void query.refetch()} />
      </div>
    );
  const player = query.data;
  return (
    <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {[
        ["TOTAL SCORE", formatInteger(player?.total_score ?? "0")],
        ["GLOBAL RANK", player ? `#${formatInteger(player.global_rank)}` : "—"],
        ["PLAYS", formatInteger(player?.play_count ?? "0")],
      ].map(([label, value]) => (
        <div
          key={label}
          className={`min-w-0 rounded-2xl border border-cyan-200/15 bg-gradient-to-br from-cyan-200/[0.08] to-violet-400/[0.06] p-4 ${label === "TOTAL SCORE" ? "col-span-2 sm:col-span-1" : ""}`}
        >
          <dt className="text-[10px] tracking-[0.2em] text-white/45">{label}</dt>
          <dd className="mt-2 break-words font-display text-xl tabular-nums text-cyan-100 sm:text-2xl">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RankingRow({ player, own }: { player: PlayerRanking; own: boolean }) {
  return (
    <li
      className={`flex min-w-0 items-center gap-3 rounded-2xl border p-3 sm:p-4 ${own ? "border-cyan-200/40 bg-cyan-200/10" : "border-white/10 bg-white/[0.03]"}`}
    >
      <span className="w-12 shrink-0 text-center font-display text-sm tabular-nums text-cyan-100">
        #{formatInteger(player.global_rank)}
      </span>
      {player.avatar_url ? (
        <img
          src={player.avatar_url}
          alt=""
          className="size-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <CircleUserRound aria-hidden="true" className="size-10 shrink-0 text-white/35" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          {player.display_name || player.username}
          {own && <span className="ml-2 text-[10px] text-cyan-200">YOU</span>}
        </p>
        <p className="truncate text-xs text-white/40">@{player.username}</p>
        <p className="mt-1 text-[10px] tracking-widest text-white/40">
          {formatInteger(player.play_count)} PLAYS
        </p>
      </div>
      <div className="min-w-0 max-w-[40%] text-right">
        <p className="break-words font-display text-sm tabular-nums text-cyan-100 sm:text-lg">
          {formatInteger(player.total_score)}
        </p>
        <p className="text-[9px] tracking-widest text-white/35">TOTAL SCORE</p>
      </div>
    </li>
  );
}

export function RankingScreen({ userId, onBack }: { userId: string | null; onBack: () => void }) {
  const top = useQuery({ queryKey: rankingKeys.leaderboard, queryFn: fetchLeaderboard });
  const mine = useQuery({
    queryKey: rankingKeys.player(userId ?? ""),
    queryFn: () => fetchPlayerRanking(userId!),
    enabled: Boolean(userId),
  });
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 md:px-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 flex items-center gap-2 text-sm text-white/50"
      >
        <ArrowLeft className="size-4" />
        戻る
      </button>
      <div className="mb-7 flex items-center gap-4">
        <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/10 p-3">
          <Trophy className="size-7 text-cyan-200" />
        </div>
        <div>
          <p className="text-[10px] tracking-[0.3em] text-cyan-200/70">GLOBAL RANKING</p>
          <h1 className="mt-1 text-2xl font-bold">世界ランキング</h1>
        </div>
      </div>
      <p className="mb-6 text-sm text-white/50">
        プレイを重ねて、累計スコアを伸ばそう。同じスコアは同順位です。
      </p>
      {userId && (
        <section aria-label="自分の世界順位" className="mb-7">
          <h2 className="mb-3 text-xs tracking-[0.2em] text-white/50">YOUR WORLD RANK</h2>
          {mine.isPending && (
            <p role="status" className="text-sm text-white/50">
              順位を読み込み中…
            </p>
          )}
          {mine.isError && <ErrorNotice retry={() => void mine.refetch()} />}
          {mine.data && (
            <ul>
              <RankingRow player={mine.data} own />
            </ul>
          )}
          {mine.isSuccess && !mine.data && (
            <p className="text-sm text-white/50">プロフィール作成後に順位が表示されます。</p>
          )}
        </section>
      )}
      <section aria-label="世界トップ100">
        <h2 className="mb-3 text-xs tracking-[0.2em] text-white/50">TOP 100</h2>
        {top.isPending && (
          <p role="status" className="text-sm text-white/50">
            ランキングを読み込み中…
          </p>
        )}
        {top.isError && <ErrorNotice retry={() => void top.refetch()} />}
        {top.isSuccess && top.data.length === 0 && (
          <p className="text-sm text-white/50">まだプレイヤーがいません。</p>
        )}
        <ol className="space-y-2">
          {top.data?.map((player) => (
            <RankingRow key={player.user_id} player={player} own={player.user_id === userId} />
          ))}
        </ol>
      </section>
    </main>
  );
}
