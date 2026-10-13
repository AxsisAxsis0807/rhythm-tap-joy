import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_CARD_CROP,
  validCardCrop,
  type CardPreferences,
  type CardPreferencePatch,
} from "./accountGrowth";
export async function getOwnCardPreferences(userId: string): Promise<CardPreferences> {
  const { data: p, error } = await supabase
    .from("profile_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  let cardImage: CardPreferences["cardImage"] = null;
  if (p?.background_asset_id) {
    const { data: a, error: assetError } = await supabase
      .from("image_assets")
      .select("*")
      .eq("id", p.background_asset_id)
      .eq("owner_id", userId)
      .eq("purpose", "profile-card")
      .eq("target_id", userId)
      .single();
    if (assetError) throw new Error(assetError.message);
    const { data: s, error: signError } = await supabase.storage
      .from("profile-card-images")
      .createSignedUrl(a.path, 600);
    if (signError) throw new Error(signError.message);
    cardImage = { assetId: a.id, url: s.signedUrl };
  }
  return {
    version: p?.metadata_version ?? 0,
    levelPublic: p?.level_public ?? true,
    crop: p ? { x: p.crop_x, y: p.crop_y, zoom: p.crop_zoom } : DEFAULT_CARD_CROP,
    cardImage,
    imageUploadEnabled: false,
  };
}
export async function saveOwnCardPreferences(
  ownerId: string,
  current: CardPreferences,
  patch: CardPreferencePatch,
) {
  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession();
  if (authError || session?.user.id !== ownerId)
    throw new Error("アカウントが変更されました。設定を開き直してください。");
  const crop = patch.crop ?? current.crop;
  if (!validCardCrop(crop)) throw new Error("画像の位置が範囲外です");
  const { error } = await supabase
    .rpc("save_profile_preferences", {
      p_expected_version: patch.expectedVersion,
      p_level_public: patch.levelPublic ?? current.levelPublic,
      p_crop_x: crop.x,
      p_crop_y: crop.y,
      p_crop_zoom: crop.zoom,
      p_remove_image: patch.removeImage ?? false,
    })
    .setHeader("Authorization", `Bearer ${session.access_token}`);
  if (error)
    throw new Error(
      error.code === "40001"
        ? "409: 別の端末で更新されています。閉じて最新の設定を確認してください。"
        : error.message,
    );
}
