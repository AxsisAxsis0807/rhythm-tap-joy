import { supabase } from "@/integrations/supabase/client";
import { chartRevision, sha256 } from "@/game/replay";
import type { Chart } from "@/game/types";
import { growthResponseSchema, visibilitySchema, type AccountVisibility } from "./xpTypes";
export const XP_CLIENT_ENABLED = import.meta.env["VITE_XP_ENABLED"] === "true";
export async function ownerToken(owner: string) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== owner) throw new Error("auth_owner");
  return data.session.access_token;
}
export async function loadAccountGrowth(owner: string) {
  const token = await ownerToken(owner);
  const { data, error } = await supabase
    .rpc("get_account_growth")
    .setHeader("Authorization", `Bearer ${token}`)
    .abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error(error.code === "42501" ? "auth_owner" : error.message);
  return growthResponseSchema.parse(data);
}
export async function saveAccountVisibility(owner: string, value: AccountVisibility) {
  value = visibilitySchema.parse(value);
  const token = await ownerToken(owner);
  const { data, error } = await supabase
    .rpc("set_account_visibility", {
      p_level: value.levelPublic,
      p_xp: value.xpPublic,
      p_supporter: value.supporterPublic,
    })
    .setHeader("Authorization", `Bearer ${token}`)
    .abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error(error.message);
  return visibilitySchema.parse(data);
}
export async function prepareXpSession(
  owner: string,
  chart: Chart,
  playId: string,
  offset: number,
) {
  try {
    const revision = await sha256(chartRevision(chart)),
      token = await ownerToken(owner);
    const { data, error } = await supabase
      .rpc("begin_verified_play", { p_play_id: playId, p_revision: revision, p_offset: offset })
      .setHeader("Authorization", `Bearer ${token}`)
      .abortSignal(AbortSignal.timeout(3000));
    if (error) throw error;
    const parsed = data as { sessionId?: string; reason?: string };
    if (typeof parsed.sessionId === "string") return { sessionId: parsed.sessionId };
    return { reason: typeof parsed.reason === "string" ? parsed.reason : "session_unavailable" };
  } catch {
    return { reason: "session_unavailable" };
  }
}
