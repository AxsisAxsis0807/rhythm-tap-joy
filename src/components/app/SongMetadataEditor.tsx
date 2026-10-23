import { RevisionPublisher } from "./RevisionPublisher";
import { useState } from "react";
import { updateSongMetadata, type SongRow } from "@/lib/chartRepository";
import { SongMetadataFields, type SongMetadataForm } from "./SongMetadataFields";

export function SongMetadataEditor({
  song,
  onSaved,
  onCancel,
}: {
  song: SongRow;
  onSaved: (song: SongRow) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<SongMetadataForm>({
    title: song.title,
    artist: song.artist,
    chartAuthor: song.chart_author,
    difficultyName: song.difficulty_name,
    description: song.description ?? "",
    recommendedPlayStyle:
      song.recommended_play_style === "mania" || song.recommended_play_style === "fnf"
        ? song.recommended_play_style
        : null,
    previewStartMs: song.preview_start_ms,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await updateSongMetadata({
        songId: song.id,
        expectedMetadataVersion: song.metadata_version,
        expectedRevisionId: song.current_revision_id,
        metadata: value,
      });
      onSaved(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 md:px-8">
      <h1 className="my-5 text-2xl font-bold">譜面を編集</h1>
      <form
        onSubmit={(event) => void save(event)}
        className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"
      >
        <SongMetadataFields value={value} onChange={setValue} />
        <p className="mt-5 text-xs leading-relaxed text-white/60">
          曲情報の変更は、既存のプレイ結果や累計スコアを維持します。
        </p>
        {error && (
          <p role="alert" className="mt-4 whitespace-pre-wrap text-sm text-rose-200">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl bg-cyan-200 px-4 py-3 font-bold text-[#0b101a] disabled:opacity-50"
          >
            {busy ? "保存中…" : "変更を保存"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-xl border border-white/20 px-4"
          >
            キャンセル
          </button>
        </div>
      </form>
      <RevisionPublisher song={song} onPublished={onSaved} />
    </main>
  );
}
