import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chartRevision, sha256, verifyReplay, type PlayReplay } from "@/game/replay";
import { outcomeSchema } from "./xpTypes";
/** Trusted boundary: caller identity comes from validated JWT middleware. Browser
 * supplies neither a chart, XP, level, entitlement nor an authoritative result. */
export async function verifyAndAward(
  owner: string,
  input: { playId: string; sessionId: string; replay: PlayReplay },
) {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from("verified_play_sessions")
    .select("*")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (sessionError) return databaseFailure(sessionError.code);
  if (!session || session.user_id !== owner || session.play_id !== input.playId)
    return { ok: false as const, code: "auth", retryable: false };
  const { data: revision, error: revisionError } = await supabaseAdmin
    .from("chart_revisions")
    .select("*")
    .eq("digest", session.revision)
    .maybeSingle();
  if (revisionError) return databaseFailure(revisionError.code);
  if (!revision) return { ok: false as const, code: "verification_failed", retryable: false };
  let result: ReturnType<typeof verifyReplay>;
  let digest: string;
  try {
    const chart = chartRevision(revision.chart as unknown as Parameters<typeof chartRevision>[0]);
    if ((await sha256(chart)) !== session.revision || revision.verifier_version !== 1)
      throw new Error("revision_hash");
    result = verifyReplay(
      chart,
      Number(revision.audio_duration),
      Number(session.timing_offset_ms),
      input.replay,
    );
    digest = await sha256(input.replay);
  } catch {
    return { ok: false as const, code: "verification_failed", retryable: false };
  }
  const { data, error } = await supabaseAdmin.rpc("commit_verified_xp", {
    p_session: session.id,
    p_digest: digest,
    p_result: result,
  });
  if (error)
    return error.code === "22023"
      ? { ok: false as const, code: "verification_failed", retryable: false }
      : databaseFailure(error.code);
  return { ok: true as const, outcome: outcomeSchema.parse(data) };
}

function databaseFailure(code: string) {
  const configuration = ["42501", "PGRST202", "42P01"].includes(code);
  return {
    ok: false as const,
    code: configuration ? "configuration" : "database",
    retryable: !configuration,
  };
}
