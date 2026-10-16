import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getAudioSession, type PreviewOwnerToken } from "@/game/audioSession";
import { buildRuntimeNotes } from "@/game/engine";
import type { Chart } from "@/game/types";
import {
  applySongTiming,
  previewInterval,
  type PreparedSongSource,
} from "@/lib/songSettingsContract";
import { waveformCacheKey, waveformColumns, type WaveformPeaks } from "@/lib/waveform";
import {
  readWaveformCache,
  writeWaveformCache,
  releasePrivateWaveforms,
} from "@/lib/waveformCache";
import { formatSongTime } from "@/lib/songTime";
function WaveformView({
  peaks,
  start,
  end,
  selection,
  previewEnd,
  headRef,
  onStart,
  onDragStart,
}: {
  peaks: WaveformPeaks;
  start: number;
  end: number;
  selection: number;
  previewEnd: number;
  headRef: React.RefObject<HTMLDivElement | null>;
  onStart: (value: number | null, final: boolean) => void;
  onDragStart: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    active = useRef<{ id: number; x: number; y: number; value: number; cancelled: boolean } | null>(
      null,
    ),
    frame = useRef(0);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const width = Math.max(1, element.clientWidth),
        ratio = window.devicePixelRatio || 1;
      element.width = Math.round(width * ratio);
      element.height = Math.round(80 * ratio);
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, element.width, element.height);
      ctx.strokeStyle = "#72d9ed";
      ctx.lineWidth = 1;
      const columns = waveformColumns(peaks, start, end, element.width);
      ctx.beginPath();
      for (let x = 0; x < element.width; x++) {
        ctx.moveTo(x, 40 * ratio - (columns[x * 2]! / 32767) * 35 * ratio);
        ctx.lineTo(x, 40 * ratio - (columns[x * 2 + 1]! / 32767) * 35 * ratio);
      }
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [peaks, start, end]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const locate = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(
      peaks.durationMs - 1,
      Math.max(0, Math.round(start + ((end - start) * (event.clientX - rect.left)) / rect.width)),
    );
  };
  return (
    <div
      className="relative my-2 overflow-hidden rounded-xl border border-white/15 bg-black/25 [touch-action:pan-y_pinch-zoom]"
      style={{ height: 82 }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        active.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          value: locate(event),
          cancelled: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragStart();
      }}
      onPointerMove={(event) => {
        const pointer = active.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        if (
          Math.abs(event.clientY - pointer.y) > 8 &&
          Math.abs(event.clientY - pointer.y) > Math.abs(event.clientX - pointer.x)
        ) {
          pointer.cancelled = true;
          onStart(null, false);
          return;
        }
        pointer.value = locate(event);
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          if (!pointer.cancelled) onStart(pointer.value, false);
        });
      }}
      onPointerUp={(event) => {
        const pointer = active.current;
        active.current = null;
        cancelAnimationFrame(frame.current);
        if (pointer?.id === event.pointerId && !pointer.cancelled) onStart(locate(event), true);
        else onStart(null, false);
      }}
      onPointerCancel={() => {
        active.current = null;
        cancelAnimationFrame(frame.current);
        onStart(null, false);
      }}
      onLostPointerCapture={() => {
        if (active.current) {
          active.current = null;
          cancelAnimationFrame(frame.current);
          onStart(null, false);
        }
      }}
    >
      <canvas ref={canvas} className="h-20 w-full" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 border-l-2 border-cyan-100 bg-cyan-100/10"
        style={{
          left: `${((selection - start) / (end - start)) * 100}%`,
          width: `${((previewEnd - selection) / (end - start)) * 100}%`,
        }}
      />
      <div
        ref={headRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 hidden w-px bg-amber-200"
      />
    </div>
  );
}
export function SongPreviewEditor({
  ownerId,
  source,
  startMs,
  onChange,
  token,
  refreshSource,
  timing,
  chart,
}: {
  ownerId: string;
  source: PreparedSongSource;
  startMs: number | null;
  onChange: (value: number | null) => void;
  token: PreviewOwnerToken;
  refreshSource: () => Promise<PreparedSongSource>;
  timing: { bpm?: number | undefined; offsetMs?: number | undefined };
  chart: Chart | null;
}) {
  const session = getAudioSession(),
    status = useSyncExternalStore(
      session.subscribe,
      session.getSnapshot,
      session.getServerSnapshot,
    );
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null),
    [error, setError] = useState(""),
    [generated, setGenerated] = useState(0),
    [retry, setRetry] = useState(0),
    [drag, setDrag] = useState<number | null>(null),
    [compare, setCompare] = useState<"before" | "after">("after");
  const overviewHead = useRef<HTMLDivElement>(null),
    zoomHead = useRef<HTMLDivElement>(null),
    clock = useRef<HTMLSpanElement>(null),
    pulse = useRef<HTMLSpanElement>(null);
  const start = drag ?? startMs ?? 0,
    end = Math.min(start + 18000, source.durationMs),
    zoomStart = Math.max(0, start - 2000),
    zoomEnd = Math.min(source.durationMs, start + 20000);
  useEffect(() => {
    session.selectPreview(
      {
        selectionId: `song-settings:${ownerId}:${source.operationId}`,
        purpose: "owner-preview",
        assetId: source.audioHash,
        audioHash: source.audioHash,
        permissionAudioHash: source.audioHash,
        allowed: true,
        previewStartMs: startMs,
        durationMs: source.durationMs,
        url: source.audioUrl,
        expiresAt: source.expiresAt,
        resolveUrl: async () => {
          const next = await refreshSource();
          if (next.audioHash !== source.audioHash) throw new Error("SOURCE_CHANGED");
          return { url: next.audioUrl, expiresAt: next.expiresAt };
        },
      },
      { ownerToken: token },
    );
  }, [
    session,
    token,
    source.operationId,
    source.audioHash,
    source.durationMs,
    source.audioUrl,
    source.expiresAt,
    ownerId,
    refreshSource,
    startMs,
  ]);
  useEffect(() => {
    session.updatePreviewSegment(token, startMs);
  }, [session, token, startMs]);
  useEffect(() => {
    let cancelled = false;
    const worker = new Worker(new URL("../../../workers/waveform.worker.ts", import.meta.url), {
      type: "module",
    });
    const key = waveformCacheKey(ownerId, source.audioHash),
      id = crypto.randomUUID();
    setPeaks(null);
    setError("");
    setGenerated(0);
    worker.onmessage = (
      event: MessageEvent<{
        id: string;
        type: string;
        generatedMs?: number;
        peaks?: WaveformPeaks;
        code?: string;
      }>,
    ) => {
      const value = event.data;
      if (cancelled || value.id !== id) return;
      if (value.type === "progress") setGenerated(value.generatedMs ?? 0);
      if (value.type === "ready" && value.peaks) {
        setPeaks(value.peaks);
        void writeWaveformCache(key, value.peaks);
      }
      if (value.type === "error") setError(value.code ?? "WAVEFORM_ERROR");
    };
    worker.onerror = () => {
      if (!cancelled) setError("波形の処理に失敗しました");
    };
    void readWaveformCache(key).then((cached) => {
      if (cancelled) return;
      if (cached && Math.abs(cached.durationMs - source.durationMs) <= 20) setPeaks(cached);
      else
        worker.postMessage({
          id,
          url: source.audioUrl,
          hash: source.audioHash,
          durationMs: source.durationMs,
        });
    });
    return () => {
      cancelled = true;
      worker.postMessage({ cancel: true });
      worker.terminate();
      releasePrivateWaveforms(ownerId);
    };
  }, [ownerId, source.audioHash, source.audioUrl, source.durationMs, retry]);
  const notes = useMemo(() => {
    if (!chart) return [];
    try {
      const value =
        compare === "after"
          ? applySongTiming(
              chart,
              source.timingBasis,
              { bpm: timing.bpm, offsetMs: timing.offsetMs },
              source.durationMs,
            )
          : chart;
      return buildRuntimeNotes(value)
        .map((note) => note.time * 1000)
        .filter((time) => time >= start && time < end)
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }, [
    chart,
    compare,
    source.timingBasis,
    source.durationMs,
    timing.bpm,
    timing.offsetMs,
    start,
    end,
  ]);
  useEffect(() => {
    if (status.status !== "playing") {
      for (const node of [overviewHead.current, zoomHead.current])
        if (node) node.style.display = "none";
      return;
    }
    let frame = 0;
    const update = () => {
      const position = session.getPlaybackPosition(token);
      if (position !== null) {
        for (const [node, from, to] of [
          [overviewHead.current, 0, source.durationMs],
          [zoomHead.current, zoomStart, zoomEnd],
        ] as const)
          if (node) {
            node.style.display = "block";
            node.style.left = `${((position - from) / (to - from)) * 100}%`;
          }
        if (clock.current) clock.current.textContent = formatSongTime(position);
        if (pulse.current)
          pulse.current.style.opacity = notes.some((note) => Math.abs(note - position) < 70)
            ? "1"
            : "0.2";
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [status.status, session, token, source.durationMs, zoomStart, zoomEnd, notes]);
  const invalid = start < 0 || start >= source.durationMs || !Number.isSafeInteger(start);
  const setPosition = (value: number) =>
    onChange(Math.min(source.durationMs - 1, Math.max(0, value)));
  const onWaveform = (value: number | null, final: boolean) => {
    if (final && value !== null) {
      setDrag(null);
      onChange(value);
    } else setDrag(value);
  };
  return (
    <section aria-label="試聴開始位置">
      <p className="text-sm text-white/65">
        試聴は18秒固定です。保存予定の開始位置と再生位置は別に調整できます。
      </p>
      <p className="my-3 font-mono text-sm">
        {formatSongTime(start)} → {formatSongTime(end)}{" "}
        {end - start < 18000 && <span>（終端まで {((end - start) / 1000).toFixed(3)}秒）</span>}
      </p>
      {peaks ? (
        <>
          <WaveformView
            peaks={peaks}
            start={0}
            end={source.durationMs}
            selection={start}
            previewEnd={end}
            headRef={overviewHead}
            onStart={onWaveform}
            onDragStart={() => session.pause(token)}
          />
          <WaveformView
            peaks={peaks}
            start={zoomStart}
            end={zoomEnd}
            selection={start}
            previewEnd={end}
            headRef={zoomHead}
            onStart={onWaveform}
            onDragStart={() => session.pause(token)}
          />
        </>
      ) : error ? (
        <div role="alert" className="my-3 rounded-xl border border-rose-300/30 p-3 text-sm">
          波形を生成できませんでした: {error}
          <button
            type="button"
            className="ml-2 min-h-11 underline"
            onClick={() =>
              void refreshSource()
                .then(() => setRetry((value) => value + 1))
                .catch(() => setError("音源を準備し直してください。"))
            }
          >
            再試行
          </button>
        </div>
      ) : (
        <p role="status" className="my-5 text-sm">
          波形を生成中… {formatSongTime(generated)} まで解析済み
        </p>
      )}
      <label className="label">
        開始位置（ドラッグなしで調整）
        <input
          type="range"
          min={0}
          max={source.durationMs - 1}
          step={1}
          value={startMs ?? 0}
          aria-valuetext={formatSongTime(startMs ?? 0)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
      <label className="label mt-3">
        開始位置（秒）
        <input
          className="field"
          type="number"
          step="0.001"
          min="0"
          value={startMs === null ? "" : startMs / 1000}
          placeholder="未設定（既定0秒）"
          onChange={(event) =>
            onChange(
              event.target.value === "" ? null : Math.round(Number(event.target.value) * 1000),
            )
          }
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {[-1000, -100, -10, 10, 100, 1000].map((step) => (
          <button
            key={step}
            type="button"
            className="min-h-11 rounded-lg border border-white/20 px-3 text-sm"
            onClick={() => setPosition((startMs ?? 0) + step)}
          >
            {step > 0 ? "+" : ""}
            {step}ms
          </button>
        ))}
        <button
          type="button"
          className="min-h-11 px-2 text-sm underline"
          onClick={() => onChange(null)}
        >
          既定の位置へ戻す
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={invalid}
          className="min-h-11 rounded-xl bg-cyan-200 px-4 font-semibold text-[#101522] disabled:opacity-40"
          onClick={() => {
            void session.unlock();
            session.replay(token);
          }}
        >
          試聴
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl border border-white/20 px-4"
          onClick={() => session.pause(token)}
        >
          停止
        </button>
        <span ref={clock} className="font-mono text-xs">
          {formatSongTime(startMs ?? 0)}
        </span>
      </div>
      <label className="label mt-3">
        再生位置（保存値は変更しません）
        <input
          type="range"
          min={Math.min(start, source.durationMs - 1)}
          max={Math.max(start, end - 1)}
          step={1}
          defaultValue={start}
          onChange={(event) => session.seekPreview(token, Number(event.target.value))}
        />
      </label>
      {chart && (
        <div className="mt-3 flex min-h-11 items-center gap-3">
          <label className="label flex-1">
            タイミングの同期確認
            <select
              className="field"
              value={compare}
              onChange={(event) => setCompare(event.target.value === "before" ? "before" : "after")}
            >
              <option value="before">変更前</option>
              <option value="after">変更後</option>
            </select>
          </label>
          <span
            ref={pulse}
            aria-hidden="true"
            className="size-5 rounded-full bg-cyan-200"
            style={{ opacity: 0.2 }}
          />
        </div>
      )}
      {invalid && (
        <p role="alert" className="text-sm text-rose-200">
          開始位置を音源の範囲内で指定してください。
        </p>
      )}
      {status.message && (
        <p role="status" className="mt-2 text-sm">
          {status.message}
          <button
            type="button"
            className="min-h-11 px-2 underline"
            onClick={() => session.retry(token)}
          >
            再試聴
          </button>
        </p>
      )}
    </section>
  );
}
