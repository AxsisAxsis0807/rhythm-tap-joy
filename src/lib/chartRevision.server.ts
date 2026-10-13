import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { audioMetadata } from "./audioMetadata";
import { parseChartByType } from "@/game/chartFile";
import {
  assertManagedPath,
  validateCanonicalChart,
  validateRevisionSource,
  MAX_CHART_BYTES,
} from "./chartValidation";
import { sha256 } from "./xpContract";
import { CHART_PARSER_VERSION } from "@/game/runConfiguration";
export async function createRevision(
  actor: string,
  input: {
    songId: string;
    requestId: string;
    expectedRevision: string | null;
    expectedVersion: number;
    audioPath: string;
    chartPath: string;
    chartType: "mania" | "fnf";
    side: "left" | "right";
    rightsConfirmed: true;
    previewAllowed: boolean;
    previewStartMs: number;
  },
) {
  const { data: song, error } = await supabaseAdmin
    .from("songs")
    .select("*")
    .eq("id", input.songId)
    .eq("user_id", actor)
    .single();
  if (error || !song) throw new Error("譜面の所有者のみ変更できます");
  const prefix = `${actor}/${song.id}/revisions/${input.requestId}/`;
  if (!input.audioPath.startsWith(prefix) || !input.chartPath.startsWith(prefix))
    throw new Error("このRevisionのアップロードパスが必要です");
  assertManagedPath(input.audioPath, actor);
  assertManagedPath(input.chartPath, actor);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("chart_revisions")
    .select("*")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (song.current_revision_id === input.requestId && existing?.song_id === song.id) return song;
  if (
    song.metadata_version !== input.expectedVersion ||
    song.current_revision_id !== input.expectedRevision
  )
    throw new Error("409: 譜面が更新されています。最新内容を確認してください");
  const download = async (path: string, max: number) => {
    const { data, error } = await supabaseAdmin.storage.from("songs").download(path);
    if (error || !data) throw new Error(error?.message ?? "アップロードを取得できませんでした");
    if (data.size > max) throw new Error("ファイルサイズが上限を超えています");
    return new Uint8Array(await data.arrayBuffer());
  };
  const [chartBytes, audioBytes] = await Promise.all([
    download(input.chartPath, MAX_CHART_BYTES),
    download(input.audioPath, 100 * 1024 * 1024),
  ]);
  const { durationMs, mime } = audioMetadata(audioBytes);
  const text = new TextDecoder().decode(chartBytes);
  validateRevisionSource(text);
  const parsed = parseChartByType(text, input.chartType, input.side);
  const chart = validateCanonicalChart(
    {
      id: song.id,
      title: song.title,
      artist: song.artist,
      difficultyName: song.difficulty_name,
      audioUrl: "",
      bpm: parsed.bpm,
      offset: parsed.offset,
      laneCount: parsed.laneCount,
      notes: parsed.notes,
      ...(parsed.fnf ? { fnf: parsed.fnf } : {}),
    },
    durationMs,
  );
  if (input.previewStartMs >= durationMs)
    throw new Error("試聴開始位置を新しい音源の範囲内で指定してください");
  const canonical = new TextEncoder().encode(JSON.stringify(chart));
  const chartHash = await sha256(canonical),
    audioHash = await sha256(audioBytes);
  if (
    existing &&
    (existing.song_id !== song.id ||
      existing.chart_hash !== chartHash ||
      existing.audio_hash !== audioHash ||
      existing.preview_allowed !== input.previewAllowed)
  )
    throw new Error("409: 同じRevision IDに異なる内容を保存できません");
  const chartPath = `${song.id}/${input.requestId}/chart.json`,
    audioPath = `${song.id}/${input.requestId}/audio`;
  if (!existing) {
    // A failed pointer CAS retains both the old revision and the new immutable snapshot.
    const write = async (path: string, bytes: Uint8Array, mime: string, hash: string) => {
      const { error } = await supabaseAdmin.storage
        .from("chart-revision-assets")
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (error) {
        const { data: prior, error: readError } = await supabaseAdmin.storage
          .from("chart-revision-assets")
          .download(path);
        if (readError || !prior || (await sha256(await prior.arrayBuffer())) !== hash)
          throw new Error(error.message);
      }
    };
    await write(chartPath, canonical, "application/json", chartHash);
    await write(audioPath, audioBytes, mime, audioHash);
    const { data: latest, error: latestError } = await supabaseAdmin
      .from("chart_revisions")
      .select("revision_number")
      .eq("chart_key", song.id)
      .order("revision_number", { ascending: false })
      .limit(1);
    if (latestError) throw new Error(latestError.message);
    const { error: insertError } = await supabaseAdmin.from("chart_revisions").insert({
      id: input.requestId,
      song_id: song.id,
      chart_key: song.id,
      revision_number: (latest?.[0]?.revision_number ?? 0) + 1,
      chart_path: chartPath,
      audio_path: audioPath,
      chart_hash: chartHash,
      audio_hash: audioHash,
      parser_version: CHART_PARSER_VERSION,
      duration_ms: durationMs,
      note_count: chart.notes.length,
      lane_count: 4,
      fnf_side: chart.fnf?.playerSide ?? null,
      rights_confirmed_by: actor,
      preview_allowed: input.previewAllowed,
    });
    if (insertError)
      throw new Error(
        insertError.code === "23505"
          ? "409: Revision作成が競合しました。再読み込みしてください。"
          : insertError.message,
      );
  }
  const { data: published, error: publishError } = await supabaseAdmin.rpc(
    "publish_chart_revision",
    {
      p_actor: actor,
      p_song_id: song.id,
      p_revision_id: input.requestId,
      p_expected_revision: input.expectedRevision,
      p_expected_version: input.expectedVersion,
      p_preview_start_ms: input.previewStartMs,
    },
  );
  if (publishError)
    throw new Error(
      publishError.code === "40001"
        ? "409: 更新が競合しました。元のRevisionは保持されています。"
        : publishError.message,
    );
  return published;
}
