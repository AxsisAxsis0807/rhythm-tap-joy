import { supabase } from "@/integrations/supabase/client";
import type { CompletedPlay } from "@/game/types";

export const rankingKeys = {
  all: ["player-ranking"] as const,
  leaderboard: ["player-ranking", "top100"] as const,
  player: (id: string) => ["player-ranking", "player", id] as const,
};

export class PlayResultSaveError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly kind: "auth" | "invalid" | "network" | "unknown",
  ) {
    super(message);
    this.name = "PlayResultSaveError";
  }
}

export async function fetchLeaderboard() {
  const { data, error } = await supabase.rpc("get_global_leaderboard");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchPlayerRanking(userId: string) {
  const { data, error } = await supabase.rpc("get_player_ranking", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function recordCompletedPlay(result: CompletedPlay, ownerId: string) {
  // Do not attribute an earlier result to a different account after an auth change.
  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession();
  if (authError) throw new PlayResultSaveError(authError.message, true, "network");
  if (session?.user.id !== ownerId)
    throw new PlayResultSaveError(
      "プレイ時のアカウントでログインすると保存を再開します",
      false,
      "auth",
    );
  if (result.competitive === false)
    throw new PlayResultSaveError("練習プレイは累計スコア対象外です", false, "invalid");
  const { play } = result;
  const c = play?.counts;
  if (
    !play ||
    !c ||
    ![play.score, play.combo, play.maxCombo, c.PERFECT, c.GREAT, c.GOOD, c.MISS].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new PlayResultSaveError("保存待ちの結果データが不正です", false, "invalid");
  const judged = c.PERFECT + c.GREAT + c.GOOD + c.MISS;
  const { error } = await supabase
    .rpc("record_play_result", {
      p_id: result.id,
      p_song_id: result.songId,
      p_score: play.score,
      p_accuracy: judged ? ((c.PERFECT + c.GREAT * 0.7 + c.GOOD * 0.4) / judged) * 100 : 100,
      p_max_combo: play.maxCombo,
      p_perfect_count: c.PERFECT,
      p_great_count: c.GREAT,
      p_good_count: c.GOOD,
      p_miss_count: c.MISS,
    })
    // Pin this request to the captured session. A concurrent sign-in must never
    // send the old account's result with the new account's access token.
    .setHeader("Authorization", `Bearer ${session.access_token}`)
    .abortSignal(AbortSignal.timeout(15_000));
  if (error) {
    const invalid =
      error.code === "22023" ||
      error.code === "23514" ||
      error.code === "22P02" ||
      error.code === "23502" ||
      error.code === "22003" ||
      error.code === "23503";
    const auth = error.code === "42501" || error.code === "PGRST301";
    throw new PlayResultSaveError(
      error.message,
      !invalid && !auth && error.code !== "PGRST202",
      invalid ? "invalid" : auth ? "auth" : error.code ? "unknown" : "network",
    );
  }
}
