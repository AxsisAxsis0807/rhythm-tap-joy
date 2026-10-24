import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const getUpdateCapabilities = createServerFn({ method: "GET" }).handler(async () => {
  const { songSettingsCapabilities } = await import("./songSettings.server");
  const capabilities = await songSettingsCapabilities();
  return {
    revisionsEnabled: capabilities.songTimingRevisionEnabled,
    imageUploadEnabled: capabilities.songBackgroundUploadEnabled,
  };
});
export const createChartRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        songId: z.string().uuid(),
        requestId: z.string().uuid(),
        expectedRevision: z.string().uuid().nullable(),
        expectedVersion: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER - 1)
          .safe(),
        audioPath: z.string().max(500),
        chartPath: z.string().max(500),
        chartType: z.enum(["mania", "fnf"]),
        side: z.enum(["left", "right"]),
        rightsConfirmed: z.literal(true),
        previewAllowed: z.boolean(),
        previewStartMs: z.number().int().nonnegative(),
      })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    if (process.env["PULSE_REVISIONS_ENABLED"] !== "true")
      throw new Error("Revision公開はサーバーの準備完了後に利用できます");
    const { createRevision } = await import("./chartRevision.server");
    return createRevision(context.supabase, context.userId, data);
  });
