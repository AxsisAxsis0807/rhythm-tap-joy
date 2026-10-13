import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canonicalJson, sha256, toJson } from "./xpContract";
import { validateCanonicalChart, MAX_CHART_BYTES } from "./chartValidation";
import { verifyReplay } from "./playVerifier";
import { z } from "zod";

/** Durable jobs may retry this entrypoint. Awarding remains transactionally idempotent. */
export async function verifyAcceptedSession(sessionId: string) {
  const [{ data: session, error: sessionError }, { data: evidence, error: evidenceError }] =
    await Promise.all([
      supabaseAdmin.from("play_sessions").select("*").eq("id", sessionId).single(),
      supabaseAdmin.from("play_evidence").select("*").eq("session_id", sessionId).single(),
    ]);
  if (sessionError || evidenceError || !session || !evidence)
    throw new Error("Accepted session/evidence unavailable");
  if (session.status !== "accepted") return;
  const revision = z
    .object({
      id: z.string().uuid(),
      chart_path: z.string(),
      chart_hash: z.string(),
      duration_ms: z.number().int(),
      parser_version: z.string(),
    })
    .parse(z.object({ revision: z.unknown() }).parse(session.catalog_snapshot).revision);
  const { data: blob, error } = await supabaseAdmin.storage
    .from("chart-revision-assets")
    .download(revision.chart_path);
  if (error || !blob) throw new Error("Canonical chart unavailable");
  if (blob.size > MAX_CHART_BYTES) throw new Error("Canonical chart exceeds bounds");
  const bytes = await blob.arrayBuffer();
  if ((await sha256(bytes)) !== revision.chart_hash)
    throw new Error("Canonical chart hash mismatch");
  if (
    (await sha256(new TextEncoder().encode(canonicalJson(evidence.payload)))) !==
    evidence.payload_hash
  )
    throw new Error("Evidence hash mismatch");
  const chart = {
    ...validateCanonicalChart(JSON.parse(new TextDecoder().decode(bytes)), revision.duration_ms),
    revisionId: revision.id,
    chartParserVersion: revision.parser_version,
  };
  let result;
  try {
    result = verifyReplay(
      chart,
      revision.duration_ms,
      evidence.payload,
      Date.parse(session.accepted_at!) - Date.parse(session.issued_at),
    );
  } catch (error) {
    result = {
      eligible: false,
      countedMs: 0,
      reason: error instanceof Error ? error.message.slice(0, 300) : "replay_invalid",
    };
  }
  const { error: finalError } = await supabaseAdmin.rpc("finalize_verified_play", {
    p_session_id: session.id,
    p_hash: evidence.payload_hash,
    p_result: toJson(result),
  });
  if (finalError) throw new Error(finalError.message);
}
