import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  beginSchema,
  growthSchema,
  receiptSchema,
  replaySchema,
  runSchema,
  canonicalJson,
  sha256,
  toJson,
} from "./xpContract";
import { XP_RULES } from "./xpRules";

export const getOwnProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_own_xp_progress");
    if (error?.code === "PGRST202")
      return { enabled: false, growth: null, rules: XP_RULES, boostEnabled: false as const };
    if (error) throw new Error(error.message);
    const result = z.object({ enabled: z.boolean(), growth: growthSchema.nullable() }).parse(data);
    return { ...result, rules: XP_RULES, boostEnabled: false as const };
  });
export const getPublicProgress = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("get_public_xp_progress", {
      p_user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return result === null ? null : growthSchema.parse(result);
  });
export const getXpReceipt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ playId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("get_xp_receipt", {
      p_play_id: data.playId,
    });
    if (error) throw new Error(error.message);
    return result === null ? null : receiptSchema.parse(result);
  });
export const beginPlay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        requestNonce: z.string().uuid(),
        revisionId: z.string().uuid(),
        configuration: runSchema,
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    if (process.env["PULSE_XP_ENABLED"] !== "true")
      return { enabled: false, sessionId: null, expiresAt: null, reason: "XP受付は現在準備中です" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("begin_verified_play", {
      p_user_id: context.userId,
      p_nonce: data.requestNonce,
      p_revision_id: data.revisionId,
      p_side:
        data.configuration.scoringSide === "shared" ? "single" : data.configuration.scoringSide,
      p_configuration: data.configuration,
    });
    if (error) throw new Error(error.message);
    return beginSchema.parse(result);
  });
export const finishPlay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => {
    // The proxy must additionally limit decompressed HTTP bodies before deserialization.
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 8 * 1024 * 1024)
      throw new Error("XP evidence exceeds 8 MiB");
    return z.object({ sessionId: z.string().uuid(), evidence: replaySchema }).parse(data);
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = await sha256(new TextEncoder().encode(canonicalJson(data.evidence)));
    const { data: result, error } = await supabaseAdmin.rpc("accept_play_evidence", {
      p_user_id: context.userId,
      p_session_id: data.sessionId,
      p_hash: hash,
      p_payload: toJson(data.evidence),
    });
    if (error) throw new Error(`${error.code}: ${error.message}`);
    // Evidence is now durable. A worker failure leaves pending status and a retryable job.
    if (process.env["PULSE_XP_ENABLED"] === "true") {
      const { verifyAcceptedSession } = await import("./xpWorker.server");
      try {
        await verifyAcceptedSession(data.sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Verification worker failed";
        const { error: jobError } = await supabaseAdmin
          .from("verification_jobs")
          .update({
            status: "retry",
            last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("session_id", data.sessionId)
          .neq("status", "completed");
        if (jobError) throw new Error("Evidence saved; verification retry could not be scheduled");
      }
      const { data: receipt, error: receiptError } = await context.supabase.rpc("get_xp_receipt", {
        p_play_id: data.sessionId,
      });
      if (receiptError) throw new Error(receiptError.message);
      if (receipt) return receiptSchema.parse(receipt);
    }
    return receiptSchema.parse(result);
  });
