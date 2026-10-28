import { useEffect, useRef, useState } from "react";
import { reserveSongBackground, verifySongBackground } from "@/lib/songSettings.functions";
import { ownerTransport } from "@/lib/ownerTransport";
import { prepareBackgroundFile } from "@/lib/songBackgroundImage";
import { putWithProgress } from "@/lib/uploadProgress";
import type { SaveSongSettingsInput } from "@/lib/songSettingsContract";
export type BackgroundAsset = {
  assetId: string;
  hash: string;
  url: string;
  expiresAt: number;
  width: number;
  height: number;
};
export function SongBackgroundEditor({
  ownerId,
  songId,
  current,
  value,
  onChange,
  enabled,
  onBusy,
}: {
  ownerId: string;
  songId: string;
  current: BackgroundAsset | null;
  value: SaveSongSettingsInput["background"];
  onChange: (value: SaveSongSettingsInput["background"]) => void;
  enabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [local, setLocal] = useState<string | null>(null),
    [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0);
  const generation = useRef(0),
    abort = useRef<AbortController | null>(null),
    xhr = useRef<XMLHttpRequest | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    pending = useRef<File | null>(null),
    reservation = useRef<string | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
      xhr.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (local) URL.revokeObjectURL(local);
    },
    [local],
  );
  const upload = async (file: File, retry = false) => {
    abort.current?.abort();
    xhr.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const attempt = ++generation.current;
    setError("");
    setProgress(0);
    onBusy(true);
    try {
      setPhase("画像を処理中");
      const prepared =
        retry && pending.current
          ? pending.current
          : await prepareBackgroundFile(file, controller.signal);
      if (attempt !== generation.current) return;
      pending.current = prepared;
      reservation.current =
        retry && reservation.current ? reservation.current : crypto.randomUUID();
      setLocal(URL.createObjectURL(prepared));
      setPhase("転送中");
      const transport = await ownerTransport(ownerId);
      if (retry) {
        try {
          const verified = await verifySongBackground({
            data: { songId, reservationId: reservation.current },
            fetch: transport,
          });
          if (attempt !== generation.current) return;
          onChange({ action: "replace", assetId: verified.assetId });
          setPhase("保存準備完了（未保存）");
          return;
        } catch {
          if (controller.signal.aborted || attempt !== generation.current) return;
        }
      }
      const upload = await reserveSongBackground({
        data: {
          songId,
          reservationId: reservation.current,
          mime:
            prepared.type === "image/png"
              ? "image/png"
              : prepared.type === "image/jpeg"
                ? "image/jpeg"
                : "image/webp",
          expectedBytes: prepared.size,
        },
        fetch: transport,
      });
      if (attempt !== generation.current) return;
      try {
        await putWithProgress(
          upload.url,
          prepared,
          (bytes) => {
            if (attempt === generation.current)
              setProgress(Math.round((bytes / prepared.size) * 100));
          },
          xhr,
          { upsert: false, signal: controller.signal },
        );
      } catch (reason) {
        if (!retry)
          throw reason; /* Insert-only retry may find a complete staging object; verify it instead of overwriting. */
      }
      if (attempt !== generation.current) return;
      setPhase("サーバーで検証中");
      const verified = await verifySongBackground({
        data: { songId, reservationId: reservation.current },
        fetch: transport,
      });
      if (attempt !== generation.current) return;
      onChange({ action: "replace", assetId: verified.assetId });
      setPhase("保存準備完了（未保存）");
    } catch (reason) {
      if (attempt === generation.current && !controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "画像を準備できませんでした");
        setPhase("失敗（旧背景は保持されています）");
      }
    } finally {
      if (attempt === generation.current) onBusy(false);
    }
  };
  const cancel = () => {
    generation.current++;
    abort.current?.abort();
    xhr.current?.abort();
    onBusy(false);
    setLocal(null);
    setPhase("");
    setError("");
    pending.current = null;
    reservation.current = null;
    onChange({ action: "keep" });
    if (fileInput.current) fileInput.current.value = "";
  };
  const url = value.action === "remove" ? null : (local ?? current?.url);
  return (
    <section aria-label="背景 Beta">
      <h2 className="font-semibold">
        背景 <span className="rounded bg-cyan-200/15 px-2 py-1 text-xs text-cyan-100">Beta</span>
      </h2>
      <p className="my-3 text-sm text-white/60">
        背景設定は将来のChart Editorへ移動予定です。JPEG・PNG・静止WebPを選択できます。
      </p>
      {url ? (
        <img
          src={url}
          alt="背景のプレビュー"
          className="aspect-video w-full rounded-xl border border-white/10 object-cover"
          onLoad={(event) => {
            event.currentTarget.style.visibility = "visible";
          }}
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
            setError("背景を表示できませんでした。読み直してください。");
          }}
        />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-xl bg-white/5 text-sm text-white/50">
          {value.action === "remove"
            ? "背景を削除する予定です（未保存）"
            : "画像なし · 標準背景を使用"}
        </div>
      )}
      <label className="label mt-4">
        画像を選択
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={!enabled}
          className="field"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {!enabled && (
        <p className="mt-2 text-sm text-white/60">
          背景の変更はサーバーの準備完了後に利用できます。
        </p>
      )}
      <div className="my-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-lg border border-white/20 px-3"
          onClick={cancel}
        >
          選択を取り消す
        </button>
        <button
          type="button"
          disabled={!enabled}
          className="min-h-11 rounded-lg border border-white/20 px-3 disabled:opacity-40"
          onClick={() => {
            cancel();
            onChange({ action: "remove" });
          }}
        >
          背景を削除
        </button>
      </div>
      {phase && (
        <p role="status" className="text-sm">
          {phase}
          {phase === "転送中" ? ` ${progress}%` : ""}
        </p>
      )}
      {phase === "転送中" && (
        <progress max={100} value={progress} aria-label="背景画像の転送進捗" className="w-full" />
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-200">
          {error}
          {pending.current && (
            <button
              type="button"
              className="min-h-11 px-2 underline"
              onClick={() => void upload(pending.current!, true)}
            >
              同じ画像を再試行
            </button>
          )}
        </p>
      )}
    </section>
  );
}
