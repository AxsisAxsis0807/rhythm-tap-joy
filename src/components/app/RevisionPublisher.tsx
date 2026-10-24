import { useNavigate } from "@tanstack/react-router";
import type { SongRow } from "@/lib/chartRepository";
/** Kept for legacy imports; all editing now enters the shared draft and atomic save. */
export function RevisionPublisher({
  song,
}: {
  song: SongRow;
  onPublished: (song: SongRow) => void;
}) {
  const navigate = useNavigate({ from: "/" });
  return (
    <button
      type="button"
      className="mt-5 min-h-11 rounded-xl border border-cyan-200/30 px-4 text-cyan-100"
      onClick={() =>
        void navigate({
          search: { songSettings: song.id },
          state: (previous) => ({ ...previous, songSettingsInternal: true }),
        })
      }
    >
      楽曲設定で音源・譜面を変更
    </button>
  );
}
export { SongReplacementEditor } from "./song-settings/SongReplacementEditor";
