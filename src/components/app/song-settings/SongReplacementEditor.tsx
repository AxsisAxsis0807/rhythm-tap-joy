import { useEffect, useRef, useState } from "react";
import { reserveChartReplacement, prepareChartReplacement } from "@/lib/songSettings.functions";
import { ownerTransport } from "@/lib/ownerTransport";
import { putWithProgress } from "@/lib/uploadProgress";
import type { PreparedSongSource, SongSettingsRow } from "@/lib/songSettingsContract";
export function SongReplacementEditor({
  row,
  onPrepared,
  onBusy,
  disabled = false,
}: {
  row: SongSettingsRow;
  onPrepared: (source: PreparedSongSource) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [audio, setAudio] = useState<File | null>(null),
    [chart, setChart] = useState<File | null>(null),
    [type, setType] = useState<"mania" | "fnf">(row.chart_type === "fnf" ? "fnf" : "mania"),
    [side, setSide] = useState<"left" | "right">(row.fnf_side === "left" ? "left" : "right"),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [error, setError] = useState("");
  const operation = useRef(crypto.randomUUID()),
    controller = useRef<AbortController | null>(null),
    xhr = useRef<XMLHttpRequest | null>(null),
    alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      controller.current?.abort();
      xhr.current?.abort();
    },
    [],
  );
  const reset = () => {
    operation.current = crypto.randomUUID();
    setError("");
    setPhase("");
  };
  const prepare = async () => {
    if (!audio || !chart || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const transport = await ownerTransport(row.user_id);
      const identity = {
        songId: row.id,
        operationId: operation.current,
        expectedVersion: row.metadata_version,
        expectedRevisionId: row.current_revision_id,
      };
      const mime: "audio/wav" | "audio/ogg" | "audio/mpeg" | "audio/mp4" | "audio/webm" =
        audio.type.includes("ogg")
          ? "audio/ogg"
          : audio.type.includes("wav")
            ? "audio/wav"
            : audio.type.includes("mp4") || audio.name.toLowerCase().endsWith(".m4a")
              ? "audio/mp4"
              : audio.type.includes("webm")
                ? "audio/webm"
                : "audio/mpeg";
      const urls = await reserveChartReplacement({
        data: {
          ...identity,
          audioBytes: audio.size,
          chartBytes: chart.size,
          audioMime: mime,
          chartType: type,
          side,
        },
        fetch: transport,
      });
      if (!urls.prepared) {
        for (const [index, file] of [
          new File([audio], audio.name, { type: mime }),
          new File([chart], chart.name, { type: "application/json" }),
        ].entries()) {
          setPhase(index === 0 ? "音源を転送中" : "譜面を転送中");
          try {
            await putWithProgress(
              index === 0 ? urls.audioUrl : urls.chartUrl,
              file,
              (bytes) => {
                if (alive.current)
                  setPhase(
                    `${index === 0 ? "音源" : "譜面"}を転送中 ${Math.round((bytes / file.size) * 100)}%`,
                  );
              },
              xhr,
              { upsert: false, signal: controller.current.signal },
            );
          } catch (reason) {
            if (controller.current.signal.aborted)
              throw reason; /* Exact-path retry is validated server-side; completed objects are never overwritten. */
          }
        }
      }
      setPhase("サーバーで音源・譜面を検証中");
      const prepared = await prepareChartReplacement({ data: identity, fetch: transport });
      if (alive.current) {
        onPrepared(prepared);
        setPhase("差し替え準備完了（未保存）");
      }
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : "差し替えを準備できませんでした");
    } finally {
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  return (
    <details className="mt-5 rounded-xl border border-white/15 p-3">
      <summary className="cursor-pointer py-2 font-semibold">音源・譜面を差し替える</summary>
      <p className="my-2 text-sm text-white/60">
        ファイルの準備では公開状態は変わりません。ほかの変更と一緒に「変更を保存」で確定します。
      </p>
      <fieldset disabled={busy || disabled} className="space-y-3">
        <label className="label">
          新しい音源（100MiB以内）
          <input
            type="file"
            accept=".wav,.ogg,.opus,.mp3,.m4a,.webm"
            className="field"
            onChange={(e) => {
              setAudio(e.target.files?.[0] ?? null);
              reset();
            }}
          />
        </label>
        <label className="label">
          新しい譜面（8MiB以内）
          <input
            type="file"
            accept=".json,.osu"
            className="field"
            onChange={(e) => {
              setChart(e.target.files?.[0] ?? null);
              reset();
            }}
          />
        </label>
        <label className="label">
          譜面形式
          <select
            className="field"
            value={type}
            onChange={(e) => {
              setType(e.target.value === "fnf" ? "fnf" : "mania");
              reset();
            }}
          >
            <option value="mania">Native / osu!mania</option>
            <option value="fnf">FNF</option>
          </select>
        </label>
        {type === "fnf" && (
          <label className="label">
            採点側
            <select
              className="field"
              value={side}
              onChange={(e) => {
                setSide(e.target.value === "left" ? "left" : "right");
                reset();
              }}
            >
              <option value="left">LEFT</option>
              <option value="right">RIGHT</option>
            </select>
          </label>
        )}
        <button
          type="button"
          className="min-h-11 rounded-lg border border-cyan-200/30 px-3 disabled:opacity-40"
          disabled={!audio || !chart || audio.size > 104857600 || chart.size > 8388608}
          onClick={() => void prepare()}
        >
          差し替えファイルを準備
        </button>
      </fieldset>
      {phase && (
        <p role="status" className="mt-2 text-sm">
          {phase}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-200">
          {error}
        </p>
      )}
    </details>
  );
}
