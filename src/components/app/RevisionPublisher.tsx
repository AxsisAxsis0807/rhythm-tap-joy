import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createChartRevision, getUpdateCapabilities } from "@/lib/chart.functions";
import { ownerTransport } from "@/lib/ownerTransport";
import type { SongRow } from "@/lib/chartRepository";
import { putWithProgress } from "@/lib/uploadProgress";
export function RevisionPublisher({
  song,
  onPublished,
}: {
  song: SongRow;
  onPublished: (song: SongRow) => void;
}) {
  const capabilities = useQuery({
    queryKey: ["update-capabilities"],
    queryFn: () => getUpdateCapabilities(),
    staleTime: 60000,
    retry: 1,
  });
  const [open, setOpen] = useState(false),
    [audio, setAudio] = useState<File | null>(null),
    [chart, setChart] = useState<File | null>(null);
  const [type, setType] = useState<"mania" | "fnf">(song.chart_type === "fnf" ? "fnf" : "mania"),
    [side, setSide] = useState<"left" | "right">(song.fnf_side === "left" ? "left" : "right");
  const [rights, setRights] = useState(false),
    [preview, setPreview] = useState(false),
    [position, setPosition] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0);
  const request = useRef<string | null>(null),
    xhr = useRef<XMLHttpRequest | null>(null);
  const publish = async () => {
    if (!audio || !chart || !rights || busy) return;
    setBusy(true);
    setError("");
    try {
      if (audio.size > 100 * 1024 * 1024 || chart.size > 8 * 1024 * 1024)
        throw new Error("音源100MiB、譜面8MiB以内で指定してください");
      request.current ??= crypto.randomUUID();
      const prefix = `${song.user_id}/${song.id}/revisions/${request.current}`;
      for (const [index, file] of [audio, chart].entries()) {
        const path = `${prefix}/${index === 0 ? "audio" : "chart"}`;
        const { data, error } = await supabase.storage
          .from("songs")
          .createSignedUploadUrl(path, { upsert: true });
        if (error || !data) throw new Error(error?.message ?? "アップロードを開始できませんでした");
        await putWithProgress(
          data.signedUrl,
          file,
          (bytes) => setProgress(Math.round((index + bytes / file.size) * 50)),
          xhr,
        );
      }
      const transport = await ownerTransport(song.user_id);
      const updated = await createChartRevision({
        data: {
          songId: song.id,
          requestId: request.current,
          expectedRevision: song.current_revision_id,
          expectedVersion: song.metadata_version,
          audioPath: `${prefix}/audio`,
          chartPath: `${prefix}/chart`,
          chartType: type,
          side,
          rightsConfirmed: true,
          previewAllowed: preview,
          previewStartMs: Math.round(position * 1000),
        },
        fetch: transport,
      });
      onPublished(updated);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Revisionを公開できませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-5 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <h2 className="font-semibold">音源・譜面の変更</h2>
      <p className="mt-2 text-sm text-white/65">
        新しいRevisionを作成します。公開中の旧版と過去の成績は保持され、新版のXP承認は引き継がれません。
      </p>
      {!capabilities.data?.revisionsEnabled ? (
        <p className="mt-3 text-xs text-white/65">
          Revision公開は準備中です。曲情報の編集は上のフォームで保存できます。
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-3 min-h-11 rounded-xl border border-cyan-200/30 px-4 text-cyan-100"
        >
          新しいRevisionを作成
        </button>
      )}
      {capabilities.error && (
        <p role="alert" className="text-sm text-rose-200">
          更新機能の状態を取得できませんでした。
        </p>
      )}
      {open && (
        <div className="mt-4 space-y-3">
          <label className="label">
            譜面形式
            <select
              disabled={busy}
              className="field"
              value={type}
              onChange={(e) => setType(e.target.value === "fnf" ? "fnf" : "mania")}
            >
              <option value="mania">osu!mania / Native</option>
              <option value="fnf">FNF</option>
            </select>
          </label>
          {type === "fnf" && (
            <label className="label">
              採点サイド
              <select
                disabled={busy}
                className="field"
                value={side}
                onChange={(e) => setSide(e.target.value === "left" ? "left" : "right")}
              >
                <option value="left">LEFT</option>
                <option value="right">RIGHT</option>
              </select>
            </label>
          )}
          <label className="label">
            新しい音源（PCM WAV / OGG）
            <input
              type="file"
              disabled={busy}
              accept=".wav,.ogg,audio/wav,audio/ogg"
              onChange={(e) => {
                setAudio(e.target.files?.[0] ?? null);
                request.current = null;
                setRights(false);
                setPreview(false);
                setPosition(0);
              }}
              className="field"
            />
          </label>
          <label className="label">
            新しい譜面（.osu / JSON）
            <input
              type="file"
              disabled={busy}
              accept=".osu,.json"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setChart(file);
                request.current = null;
                if (file && type === "mania")
                  void file.text().then((text) => {
                    const m = text.match(/^PreviewTime:\s*(-?\d+)\s*$/m);
                    if (m && Number(m[1]) >= 0) setPosition(Number(m[1]) / 1000);
                  });
              }}
              className="field"
            />
          </label>
          <label className="label">
            新音源の試聴開始位置（秒）
            <input
              className="field"
              type="number"
              min={0}
              step={0.001}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            この音源・譜面と使用画像を配信する権利を確認しました
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={preview}
              onChange={(e) => setPreview(e.target.checked)}
            />
            新しい音源の試聴配信を許可します
          </label>
          {busy && (
            <progress
              max={100}
              value={progress}
              aria-label="Revisionアップロード進捗"
              className="w-full"
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-200">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !audio || !chart || !rights}
            onClick={() => void publish()}
            className="min-h-11 rounded-xl bg-cyan-200 px-4 font-bold text-[#0b101a] disabled:opacity-50"
          >
            {busy ? "検証・公開中…" : "検証してRevisionを公開"}
          </button>
        </div>
      )}
    </section>
  );
}
