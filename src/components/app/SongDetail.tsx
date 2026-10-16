import { useEffect, useMemo, useState } from "react";
import { Music2, Pause, Play, RotateCcw } from "lucide-react";
import type { SongEntry } from "@/components/menu/MusicSelect";
import type { PlayStyleId } from "@/game/types";
import { ModePicker } from "@/components/game/ModePicker";
import { useGameSettings } from "@/game/settings";
import { resolvePlayStyle } from "@/game/styleSelection";
import { getSongPreview } from "@/lib/chartRepository";
import { useAudioPreview } from "@/hooks/useAudioPreview";
import { getAudioSession } from "@/game/audioSession";

export function SongDetail({
  song,
  explicitStyle,
  explicitSelection = false,
  onStyleChange,
  onStart,
}: {
  song: SongEntry;
  explicitStyle?: PlayStyleId | undefined;
  explicitSelection?: boolean;
  onStyleChange: (style: PlayStyleId) => void;
  onStart: (style: PlayStyleId) => Promise<void>;
}) {
  const { settings, setSettings, loaded } = useGameSettings();
  const [previewAsset, setPreviewAsset] =
    useState<Awaited<ReturnType<typeof getSongPreview>>>(null);
  const [previewError, setPreviewError] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setPreviewAsset(null);
    setPreviewError("");
    if (song.source)
      void getSongPreview(song.source)
        .then((asset) => {
          if (!cancelled) setPreviewAsset(asset);
        })
        .catch((reason: unknown) => {
          if (!cancelled)
            setPreviewError(
              reason instanceof Error ? reason.message : "試聴情報を取得できませんでした",
            );
        });
    return () => {
      cancelled = true;
    };
  }, [song.source]);
  const source = useMemo(
    () =>
      previewAsset
        ? {
            selectionId: song.id,
            assetId: previewAsset.assetId,
            url: previewAsset.url,
            expiresAt: previewAsset.expiresAt,
            resolveUrl: previewAsset.resolveUrl,
            audioHash: previewAsset.audioHash,
            permissionAudioHash: previewAsset.permissionAudioHash,
            allowed: true,
            previewStartMs: previewAsset.startMs,
          }
        : null,
    [previewAsset, song.id],
  );
  const preview = useAudioPreview(source, {
    autoPreview: settings.autoPreview,
    masterVolume: settings.masterVolume,
    menuVolume: settings.menuVolume,
    previewVolume: settings.previewVolume,
    explicitSelection,
  });
  const style = resolvePlayStyle(
    explicitStyle,
    song.recommendedPlayStyle,
    settings.lastPlayedStyle,
  );
  const row = song.source;
  const playable = Boolean(
    song.chart || (row?.audio_path && row.chart_path) || row?.current_revision_id,
  );
  const begin = () => {
    if (starting) return;
    setStarting(true);
    setError("");
    getAudioSession().stopPreview();
    void getAudioSession()
      .unlock()
      .then(() => onStart(style))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "再生を開始できませんでした");
      })
      .finally(() => setStarting(false));
  };
  return (
    <section
      aria-label={`${song.title} の曲詳細`}
      className="min-w-0 rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/10 to-violet-400/10 p-5 sm:p-6"
    >
      <div
        aria-hidden="true"
        className="flex h-36 items-center justify-center rounded-2xl bg-black/20 sm:h-44"
      >
        <Music2 className="size-16 text-cyan-200/70" />
      </div>
      <h2 className="mt-5 break-words text-2xl font-bold">{song.title}</h2>
      <p className="mt-1 break-words text-white/60">{song.artist}</p>
      {row?.chart_author && <p className="mt-1 text-xs text-white/60">譜面: {row.chart_author}</p>}
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        {[
          ["難易度", song.chart?.difficultyName ?? row?.difficulty_name ?? "—"],
          ["BPM", song.chart?.bpm ?? row?.bpm ?? "—"],
          ["NOTES", song.chart?.notes.length ?? row?.note_count ?? "—"],
        ].map(([name, value]) => (
          <div key={name} className="rounded-xl bg-black/20 p-2">
            <dt className="text-white/50">{name}</dt>
            <dd className="mt-1 break-words text-cyan-100">{value}</dd>
          </div>
        ))}
      </dl>
      {song.description && (
        <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/70">
          {song.description}
        </p>
      )}
      <div className="my-5 rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="text-xs tracking-widest text-cyan-100">PREVIEW</p>
        <label className="mt-2 flex min-h-11 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.autoPreview}
            onChange={(event) =>
              setSettings((current) => ({ ...current, autoPreview: event.target.checked }))
            }
          />
          自動試聴
        </label>
        <label className="flex min-h-11 items-center gap-3 text-xs">
          試聴音量
          <input
            aria-label="試聴音量"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.previewVolume}
            onChange={(event) =>
              setSettings((current) => ({ ...current, previewVolume: Number(event.target.value) }))
            }
            className="min-h-11 min-w-0 flex-1 accent-cyan-200"
          />
        </label>
        {source ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                preview.state.status === "playing" ? preview.pause() : void preview.play()
              }
              className="flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-3 text-sm"
            >
              {preview.state.status === "playing" ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {preview.state.status === "playing" ? "停止" : "試聴する"}
            </button>
            <button
              type="button"
              onClick={() => void preview.replay()}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm"
            >
              <RotateCcw className="size-4" />
              もう一度
            </button>
            {preview.state.retryable && (
              <button
                type="button"
                onClick={() => void preview.retry()}
                className="min-h-11 px-3 text-sm underline"
              >
                再取得
              </button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-white/60">この曲は現在試聴できません。</p>
        )}
        <p role="status" className="mt-2 text-xs text-white/60">
          {previewError || preview.state.message}
        </p>
      </div>
      <p className="mb-3 text-xs text-white/70">
        Recommended:{" "}
        <strong className="text-cyan-100">
          {song.recommendedPlayStyle === "fnf"
            ? "FNF"
            : song.recommendedPlayStyle === "mania"
              ? "OSU!MANIA"
              : "指定なし"}
        </strong>
      </p>
      <ModePicker value={style} onChange={onStyleChange} />
      {style === "mania" && (
        <label className="mt-3 flex min-h-11 items-center justify-between gap-3 text-sm text-white/70">
          表示スキン
          <select
            value={settings.maniaSkin}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                maniaSkin: event.target.value === "classic" ? "classic" : "standard",
              }))
            }
            className="min-h-11 rounded-lg border border-white/20 bg-[#111521] px-3"
          >
            <option value="standard">標準</option>
            <option value="classic">CLASSIC</option>
          </select>
        </label>
      )}
      {style === "mania" && settings.maniaSkin === "classic" && (
        <p className="mt-1 text-xs text-cyan-100">CLASSIC スキン · mania 判定</p>
      )}
      <button
        type="button"
        disabled={!playable || !loaded || starting}
        onClick={begin}
        className="mt-4 min-h-12 w-full rounded-xl bg-cyan-200 px-4 py-3 font-display font-bold tracking-widest text-[#0b101a] disabled:opacity-40"
      >
        {starting ? "LOADING…" : "START"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-200">
          {error}
        </p>
      )}
    </section>
  );
}
