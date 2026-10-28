import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { settingsDatabase } from "./songSettingsDatabase";
import { SongSettingsError, songSettingsCapabilities } from "./songSettings.server";
import { IMAGE_TRANSFER_LIMIT } from "./imageValidation";
import { readBoundedStorage } from "./boundedStorage.server";
import { sha256 } from "./xpContract";
import { assertManagedPath } from "./chartValidation";
const db = () => settingsDatabase(supabaseAdmin);
async function ownerSong(actor: string, songId: string) {
  const { data, error } = await supabaseAdmin
    .from("songs")
    .select("id")
    .eq("id", songId)
    .eq("user_id", actor)
    .single();
  if (error || !data) throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
}
async function gate(actor: string, songId: string) {
  await ownerSong(actor, songId);
  if (!(await songSettingsCapabilities()).songBackgroundUploadEnabled)
    throw new SongSettingsError("SERVER_NOT_READY");
}
export async function reserveBackground(
  actor: string,
  input: {
    songId: string;
    reservationId: string;
    mime: "image/jpeg" | "image/png" | "image/webp";
    expectedBytes: number;
  },
) {
  await gate(actor, input.songId);
  const { data, error } = await db().rpc("reserve_song_background", {
    p_actor: actor,
    p_song_id: input.songId,
    p_id: input.reservationId,
    p_mime_type: input.mime,
    p_expected_bytes: input.expectedBytes,
  });
  if (error)
    throw new SongSettingsError(error.code === "55000" ? "SERVER_NOT_READY" : "INVALID_INPUT");
  const reservation = z
    .object({ path: z.string(), state: z.literal("reserved"), expires_at: z.string() })
    .parse(data);
  const signed = await supabaseAdmin.storage
    .from("asset-staging")
    .createSignedUploadUrl(reservation.path, { upsert: false });
  if (signed.error || !signed.data) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  return {
    reservationId: input.reservationId,
    url: signed.data.signedUrl,
    expiresAt: reservation.expires_at,
  };
}
async function signedAsset(asset: {
  id: string;
  content_hash: string;
  path: string;
  width: number;
  height: number;
}) {
  const { data, error } = await supabaseAdmin.storage
    .from("profile-card-images")
    .createSignedUrl(asset.path, 600);
  if (error || !data) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  return {
    assetId: asset.id,
    hash: asset.content_hash,
    url: data.signedUrl,
    expiresAt: Date.now() + 600000,
    width: asset.width,
    height: asset.height,
  };
}
export async function verifyBackground(actor: string, songId: string, reservationId: string) {
  await gate(actor, songId);
  const { data: r, error } = await db()
    .from("image_reservations")
    .select("*")
    .eq("id", reservationId)
    .eq("owner_id", actor)
    .eq("target_id", songId)
    .eq("purpose", "chart-background")
    .single();
  if (error || !r) throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
  if (Date.parse(r.expires_at) <= Date.now() || !["reserved", "verified"].includes(r.state))
    throw new SongSettingsError("ASSET_NOT_READY");
  const { data: existing, error: existingError } = await db()
    .from("image_assets")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();
  if (existingError) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  if (
    existing &&
    (existing.deleting ||
      existing.deleted_at ||
      existing.owner_id !== actor ||
      existing.target_id !== songId)
  )
    throw new SongSettingsError("ASSET_NOT_READY");
  if (existing && r.state === "verified") return signedAsset(existing);
  const stage = await readBoundedStorage(
    "asset-staging",
    r.path,
    IMAGE_TRANSFER_LIMIT,
    AbortSignal.timeout(30000),
  );
  if (stage.byteLength !== r.expected_bytes) throw new SongSettingsError("INVALID_INPUT");
  const { canonicalizeBackground } = await import("./imageProcessor.server");
  const canonical = await canonicalizeBackground(stage);
  const path = `${actor}/${reservationId}/master`;
  const { error: jobError } = await db()
    .from("asset_cleanup_jobs")
    .upsert(
      { bucket_id: "profile-card-images", path, asset_id: reservationId },
      { onConflict: "bucket_id,path", ignoreDuplicates: true },
    );
  if (jobError) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  await supabaseAdmin.storage.from("profile-card-images").upload(path, canonical.bytes, {
    contentType: canonical.mime,
    upsert: false,
    cacheControl: "600",
  });
  const previous = await readBoundedStorage("profile-card-images", path, IMAGE_TRANSFER_LIMIT);
  if ((await sha256(previous)) !== canonical.contentHash)
    throw new SongSettingsError("ASSET_NOT_READY");
  if (existing && existing.content_hash !== canonical.contentHash)
    throw new SongSettingsError("ASSET_NOT_READY");
  if (!existing) {
    const { error: insertError } = await db().from("image_assets").insert({
      id: reservationId,
      owner_id: actor,
      purpose: "chart-background",
      target_id: songId,
      path,
      content_hash: canonical.contentHash,
      mime_type: canonical.mime,
      width: canonical.width,
      height: canonical.height,
      byte_size: canonical.bytes.byteLength,
    });
    if (insertError && insertError.code !== "23505")
      throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  }
  const verified = await db()
    .from("image_reservations")
    .update({ state: "verified" })
    .eq("id", reservationId)
    .eq("owner_id", actor)
    .eq("target_id", songId)
    .gt("expires_at", new Date().toISOString())
    .in("state", ["reserved", "verified"])
    .select("id")
    .single();
  if (verified.error || !verified.data) throw new SongSettingsError("ASSET_NOT_READY");
  const result = await db()
    .from("image_assets")
    .select("*")
    .eq("id", reservationId)
    .eq("content_hash", canonical.contentHash)
    .eq("deleting", false)
    .is("deleted_at", null)
    .single();
  if (result.error || !result.data) throw new SongSettingsError("ASSET_NOT_READY");
  return signedAsset(result.data);
}
/** Public callers pass null. An authenticated owner projection may pass its verified actor. */
export async function readSongBackground(songId: string, actor: string | null = null) {
  const { data: song, error } = await db()
    .from("songs")
    .select("id,user_id,is_published,background_asset_id,background_path")
    .eq("id", songId)
    .single();
  if (error || !song || (!song.is_published && song.user_id !== actor)) return null;
  if (!song.background_asset_id) {
    if (!song.background_path) return null;
    try {
      const path = assertManagedPath(song.background_path, song.user_id);
      const bytes = await readBoundedStorage(
        "songs",
        path,
        IMAGE_TRANSFER_LIMIT,
        AbortSignal.timeout(30000),
      );
      const { canonicalizeBackground } = await import("./imageProcessor.server");
      const canonical = await canonicalizeBackground(bytes);
      // A read-only legacy projection freezes validated pixels. It neither trusts
      // an arbitrary URL nor writes an asset while write gates are disabled.
      let encoded = "";
      for (let i = 0; i < canonical.bytes.length; i += 8192)
        encoded += String.fromCharCode(...canonical.bytes.subarray(i, i + 8192));
      return {
        assetId: `legacy:${song.id}`,
        hash: canonical.contentHash,
        url: `data:image/jpeg;base64,${btoa(encoded)}`,
        expiresAt: Date.now() + 86400000,
        width: canonical.width,
        height: canonical.height,
      };
    } catch {
      return null;
    }
  }
  const { data: asset, error: assetError } = await db()
    .from("image_assets")
    .select("*")
    .eq("id", song.background_asset_id)
    .eq("owner_id", song.user_id)
    .eq("purpose", "chart-background")
    .eq("target_id", song.id)
    .eq("deleting", false)
    .is("deleted_at", null)
    .single();
  if (assetError || !asset) return null;
  return signedAsset(asset);
}
