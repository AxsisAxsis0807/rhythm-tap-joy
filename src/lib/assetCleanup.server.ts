import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { settingsDatabase } from "./songSettingsDatabase";
const jobSchema = z.object({
  id: z.string().uuid(),
  bucket_id: z.enum(["asset-staging", "profile-card-images", "chart-revision-assets", "songs"]),
  path: z.string(),
  attempts: z.number().int(),
});
/** Called only from an authenticated operations endpoint. All paths come from SQL claims. */
export async function runAssetCleanup() {
  const worker = crypto.randomUUID(),
    db = settingsDatabase(supabaseAdmin);
  const claimed = await db.rpc("claim_song_asset_cleanup", { p_worker: worker, p_limit: 8 });
  if (claimed.error) throw new Error("CLEANUP_CLAIM_FAILED");
  const jobs = z.array(jobSchema).parse(claimed.data);
  let removed = 0,
    failed = 0;
  for (const job of jobs) {
    let failure: string | null = null;
    try {
      const result = await supabaseAdmin.storage.from(job.bucket_id).remove([job.path]);
      if (result.error && String(result.error.status) !== "404")
        failure = `STORAGE_${result.error.status ?? "ERROR"}`;
    } catch {
      failure = "STORAGE_TRANSPORT";
    }
    const result = await db.rpc("finish_song_asset_cleanup", {
      p_worker: worker,
      p_job: job.id,
      p_error: failure,
    });
    if (result.error) throw new Error("CLEANUP_RECEIPT_FAILED");
    if (failure) failed++;
    else removed++;
  }
  return { claimed: jobs.length, removed, failed };
}
export async function validCleanupCredential(header: string | null) {
  const secret = process.env["PULSE_CLEANUP_TOKEN"];
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const hash = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [expected, actual] = await Promise.all([hash(secret), hash(header.slice(7))]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ actual[i]!;
  return difference === 0;
}
