import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { SongEntry } from "@/components/menu/MusicSelect";
import type { SongMetadataForm } from "@/components/app/SongMetadataFields";
import type { Chart } from "@/game/types";
import { parseChartByType } from "@/game/chartFile";
import { assertManagedPath, MAX_CHART_BYTES, validateCanonicalChart } from "./chartValidation";

export type SongRow = Omit<Database["public"]["Tables"]["songs"]["Row"], "metadata_version"> & {
  metadata_version: number | string;
  background_asset_id?: string | null;
};
export function legacyMetadataVersion(value: number | string): number {
  const version = typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0)
    throw new Error("旧APIで安全に保存できないversionです。最新の楽曲設定を使用してください。");
  return version;
}
export function normalizeSong(row: SongRow): SongRow {
  return {
    ...row,
    description: row.description ?? null,
    recommended_play_style:
      row.recommended_play_style !== undefined
        ? row.recommended_play_style
        : row.mode_id === "mania" || row.mode_id === "fnf"
          ? row.mode_id
          : null,
    preview_start_ms: row.preview_start_ms ?? null,
    metadata_version: row.metadata_version ?? 0,
    current_revision_id: row.current_revision_id ?? null,
  };
}
export async function listPublicSongs() {
  const { data, error } = await supabase
    .from("songs")
    .select("*")
    .eq("is_published", true)
    .order("published_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeSong);
}
export function songToEntry(value: SongRow): SongEntry {
  const row = normalizeSong(value);
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    source: row,
    description: row.description ?? "",
    recommendedPlayStyle: row.recommended_play_style,
    previewStartMs: row.preview_start_ms,
  };
}
async function signed(bucket: string, path: string) {
  assertManagedPath(path);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? "音源URLを発行できませんでした");
  return data.signedUrl;
}
export async function loadPlayableChart(value: SongRow): Promise<Chart> {
  const row = normalizeSong(value);
  if (row.current_revision_id) {
    const { data: revision, error } = await supabase
      .from("chart_revisions")
      .select("*")
      .eq("id", row.current_revision_id)
      .single();
    if (error || !revision || revision.song_id !== row.id)
      throw new Error(error?.message ?? "Revisionを読み込めませんでした");
    const { data: blob, error: downloadError } = await supabase.storage
      .from("chart-revision-assets")
      .download(assertManagedPath(revision.chart_path));
    if (downloadError || !blob)
      throw new Error(downloadError?.message ?? "譜面を取得できませんでした");
    if (blob.size > MAX_CHART_BYTES) throw new Error("譜面ファイルが上限を超えています");
    const chart = validateCanonicalChart(JSON.parse(await blob.text()), revision.duration_ms);
    return {
      ...chart,
      title: row.title,
      artist: row.artist,
      difficultyName: row.difficulty_name,
      audioUrl: await signed("chart-revision-assets", revision.audio_path),
      revisionId: revision.id,
      chartParserVersion: revision.parser_version,
    };
  }
  if (!row.audio_path || !row.chart_path) throw new Error("音源・譜面ファイルがありません");
  const { data: blob, error } = await supabase.storage
    .from("songs")
    .download(assertManagedPath(row.chart_path, row.user_id));
  if (error || !blob) throw new Error(error?.message ?? "譜面を取得できませんでした");
  if (blob.size > MAX_CHART_BYTES) throw new Error("譜面ファイルが上限を超えています");
  const parsed = parseChartByType(
    await blob.text(),
    row.chart_type === "fnf" ? "fnf" : "mania",
    row.fnf_side === "left" ? "left" : "right",
  );
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    difficultyName: row.difficulty_name,
    audioUrl: await signed("songs", assertManagedPath(row.audio_path, row.user_id)),
    bpm: parsed.bpm,
    offset: parsed.offset,
    laneCount: parsed.laneCount,
    notes: parsed.notes,
    ...(parsed.fnf ? { fnf: parsed.fnf } : {}),
  };
}
export async function getSongPreview(value: SongRow) {
  const row = normalizeSong(value);
  if (!row.current_revision_id) return null; // Neither official nor old publication establishes permission.
  const { data: r, error } = await supabase
    .from("chart_revisions")
    .select("*")
    .eq("id", row.current_revision_id)
    .single();
  if (error) throw new Error(error.message);
  if (!r || !r.preview_allowed) return null;
  return {
    assetId: r.audio_hash,
    audioHash: r.audio_hash,
    permissionAudioHash: r.audio_hash,
    startMs: row.preview_start_ms ?? 0,
    durationMs: r.duration_ms,
    url: await signed("chart-revision-assets", r.audio_path),
    expiresAt: Date.now() + 3_600_000,
    resolveUrl: async () => ({
      url: await signed("chart-revision-assets", r.audio_path),
      expiresAt: Date.now() + 3_600_000,
    }),
  };
}
export async function updateSongMetadata(input: {
  songId: string;
  expectedMetadataVersion: number | string;
  expectedRevisionId: string | null;
  metadata: SongMetadataForm;
}) {
  const m = input.metadata;
  const { data, error } = await supabase.rpc("update_chart_metadata", {
    p_song_id: input.songId,
    p_expected_version: legacyMetadataVersion(input.expectedMetadataVersion),
    p_expected_revision: input.expectedRevisionId,
    p_title: m.title,
    p_artist: m.artist,
    p_chart_author: m.chartAuthor,
    p_difficulty_name: m.difficultyName,
    p_description: m.description,
    p_recommended_play_style: m.recommendedPlayStyle,
    p_preview_start_ms: m.previewStartMs,
  });
  if (error)
    throw new Error(
      error.code === "40001"
        ? "409: 別の更新が保存されています。キャンセルして最新の内容を確認してから保存してください。"
        : error.code === "PGRST202"
          ? "曲情報の編集にはサーバーのアップデートが必要です。"
          : error.message,
    );
  return normalizeSong(data);
}
