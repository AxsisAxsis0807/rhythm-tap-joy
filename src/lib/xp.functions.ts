import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { replaySchema } from "@/game/replay";
const input = z
  .object({
    ownerId: z.string().uuid(),
    playId: z.string().uuid(),
    sessionId: z.string().uuid(),
    replay: replaySchema,
  })
  .strict();
export const submitXpReplay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    if (data.ownerId !== context.userId)
      return { ok: false as const, code: "auth", retryable: false };
    const { verifyAndAward } = await import("./xp.server");
    return verifyAndAward(context.userId, data);
  });
