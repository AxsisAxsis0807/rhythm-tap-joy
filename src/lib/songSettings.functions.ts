import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { saveSongSettingsSchema, songSettingsIdentitySchema } from "./songSettingsContract";
export const getSongSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => songSettingsIdentitySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { readSongSettings, songSettingsCapabilities } = await import("./songSettings.server");
    const { readSongBackground } = await import("./imageAssets.server");
    const song = await readSongSettings(context.supabase, context.userId, data.songId);
    const revision = song.current_revision_id
      ? await context.supabase
          .from("chart_revisions")
          .select("duration_ms")
          .eq("id", song.current_revision_id)
          .eq("song_id", song.id)
          .single()
      : null;
    return {
      song,
      capabilities: await songSettingsCapabilities(),
      background: await readSongBackground(data.songId, context.userId),
      revision: revision?.data ? { durationMs: revision.data.duration_ms } : null,
    };
  });
export const saveSongSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => saveSongSettingsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { saveSettings } = await import("./songSettings.server");
    return saveSettings(context.supabase, context.userId, data);
  });
export const getSongSettingsOperation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ operationId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { readSettingsOperation } = await import("./songSettings.server");
    return readSettingsOperation(context.userId, data.operationId);
  });
export const verifySongBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ songId: z.string().uuid(), reservationId: z.string().uuid() }).strict().parse(data),
  )
  .handler(async ({ data, context }) => {
    const { verifyBackground } = await import("./imageAssets.server");
    return verifyBackground(context.userId, data.songId, data.reservationId);
  });
export const reserveSongBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        songId: z.string().uuid(),
        reservationId: z.string().uuid(),
        mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
        expectedBytes: z.number().int().min(1).max(3145728),
      })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { reserveBackground } = await import("./imageAssets.server");
    return reserveBackground(context.userId, data);
  });
export const getSongBackground = createServerFn({ method: "GET" })
  .inputValidator((data) => songSettingsIdentitySchema.parse(data))
  .handler(async ({ data }) => {
    const { readSongBackground } = await import("./imageAssets.server");
    return readSongBackground(data.songId);
  });
export const prepareSongSettingsSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(async (data) =>
    (await import("./songSettingsContract")).prepareSongSourceSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    const { prepareSongSource } = await import("./songSource.server");
    return prepareSongSource(context.supabase, context.userId, data);
  });
export const abandonSongSettingsOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ operationId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { settingsDatabase } = await import("./songSettingsDatabase");
    const result = await settingsDatabase(supabaseAdmin).rpc("abandon_song_settings_operation", {
      p_actor: context.userId,
      p_id: data.operationId,
    });
    if (result.error) throw new Error("RETRYABLE_TRANSPORT");
    return { abandoned: true };
  });
export const resumeSongSettingsSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ operationId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { settingsDatabase } = await import("./songSettingsDatabase");
    const { saveSettings } = await import("./songSettings.server");
    const result = await settingsDatabase(supabaseAdmin).rpc("get_owner_song_operation", {
      p_actor: context.userId,
      p_id: data.operationId,
    });
    if (result.error || !result.data) throw new Error("NOT_FOUND_OR_FORBIDDEN");
    const intent = z
      .object({ kind: z.literal("save"), candidate: z.object({ payload: saveSongSettingsSchema }) })
      .parse(result.data);
    return saveSettings(context.supabase, context.userId, intent.candidate.payload);
  });
export const reserveChartReplacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(async (data) =>
    (await import("./songSettingsContract")).reserveReplacementSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    const { reserveReplacement } = await import("./chartReplacement.server");
    return reserveReplacement(context.supabase, context.userId, data);
  });
export const prepareChartReplacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(async (data) =>
    (await import("./songSettingsContract")).prepareSongSourceSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    const { prepareReplacement } = await import("./chartReplacement.server");
    return prepareReplacement(context.supabase, context.userId, data);
  });
