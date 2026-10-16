import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { SongReplacementEditor } from "../RevisionPublisher";
import { SongMetadataFields } from "../SongMetadataFields";
import { getAudioSession, type PreviewOwnerToken } from "@/game/audioSession";
import { useGameSettings } from "@/game/settings";
import type { Chart } from "@/game/types";
import { buildRuntimeNotes } from "@/game/engine";
import { validateCanonicalChart } from "@/lib/chartValidation";
import { ownerTransport } from "@/lib/ownerTransport";
import {
  getSongSettings,
  saveSongSettings,
  getSongSettingsOperation,
  prepareSongSettingsSource,
  resumeSongSettingsSave,
  prepareChartReplacement,
  abandonSongSettingsOperation,
} from "@/lib/songSettings.functions";
import {
  applySongTiming,
  settingsMetadata,
  validateSettingsMetadata,
  type PreparedSongSource,
  type SaveSongSettingsInput,
  type SongSettingsReceipt,
  type SongSettingsRow,
} from "@/lib/songSettingsContract";
import { SongPreviewEditor } from "./SongPreviewEditor";
import { SongBackgroundEditor } from "./SongBackgroundEditor";
import { useSongSettingsDraft } from "./useSongSettingsDraft";

type Loaded = Awaited<ReturnType<typeof getSongSettings>>;
const labels = { preview: "試聴", background: "背景 Beta", metadata: "基本情報" } as const;
export function SongSettingsDialog({
  ownerId,
  songId,
  onClose,
  onSaved,
}: {
  ownerId: string;
  songId: string;
  onClose: () => void;
  onSaved: (row: SongSettingsRow) => void;
}) {
  const { settings } = useGameSettings(),
    dirty = useRef(false),
    [guard, setGuard] = useState(false),
    heading = useRef<HTMLHeadingElement>(null);
  const [viewport, setViewport] = useState({
    height: window.visualViewport?.height ?? window.innerHeight,
    top: window.visualViewport?.offsetTop ?? 0,
  });
  const blocker = useBlocker({
    shouldBlockFn: () => dirty.current,
    enableBeforeUnload: () => dirty.current,
    withResolver: true,
  });
  const guardChange = useCallback((value: boolean) => {
    dirty.current = value;
    setGuard(value);
  }, []);
  const [verifiedOpen, setVerifiedOpen] = useState(false);
  const query = useQuery({
    queryKey: ["song-settings", ownerId, songId],
    queryFn: async () =>
      getSongSettings({ data: { songId }, fetch: await ownerTransport(ownerId) }),
    retry: 1,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (query.isFetchedAfterMount && !query.isFetching && query.data && !query.error)
      setVerifiedOpen(true);
  }, [query.isFetchedAfterMount, query.isFetching, query.data, query.error]);
  useEffect(() => {
    const update = () =>
      setViewport({
        height: window.visualViewport?.height ?? window.innerHeight,
        top: window.visualViewport?.offsetTop ?? 0,
      });
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          showClose={false}
          overlayClassName="bg-black/60"
          className={`flex w-[calc(100%_-_24px)] max-w-[880px] flex-col gap-0 overflow-hidden rounded-2xl border-white/10 bg-[#101522] p-0 text-white shadow-2xl motion-reduce:!animate-none ${settings.reducedMotion ? "!animate-none !transition-none" : ""}`}
          style={{
            maxHeight: Math.min(820, viewport.height - 24),
            top: viewport.top + viewport.height / 2,
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (
              document.getElementById(`song-menu-${songId}`) ??
              document.getElementById(`my-song-${songId}`) ??
              document.getElementById("my-tracks-heading")
            )?.focus();
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <DialogTitle asChild>
                <h2 ref={heading} tabIndex={-1} className="font-bold outline-none">
                  楽曲設定
                </h2>
              </DialogTitle>
              <DialogDescription className="mt-1 break-words text-sm text-white/60">
                {query.data?.song.title ?? "曲を確認中…"}
                {query.data && ` · ${query.data.song.is_published ? "公開中" : "下書き"}`}
              </DialogDescription>
            </div>
            <button
              type="button"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10"
              aria-label="楽曲設定を閉じる"
              onClick={onClose}
            >
              <X className="size-5" />
            </button>
          </header>
          {query.isPending || (!verifiedOpen && !query.error) ? (
            <div role="status" className="min-h-32 p-6">
              所有者と最新の設定を確認中…
            </div>
          ) : query.error ? (
            <div className="p-6">
              <p role="alert">
                設定を取得できませんでした。権限・サーバーの準備状態を確認してください。
              </p>
              <button
                type="button"
                className="mt-3 min-h-11 underline"
                onClick={() => void query.refetch()}
              >
                読み直す
              </button>
            </div>
          ) : (
            query.data && (
              <SettingsForm
                key={`${ownerId}:${songId}`}
                ownerId={ownerId}
                initial={query.data}
                onGuard={guardChange}
                onClose={onClose}
                onSaved={onSaved}
              />
            )
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent className="w-[calc(100%_-_24px)] rounded-2xl border-white/10 bg-[#101522] text-white">
          <AlertDialogTitle>変更を破棄しますか？</AlertDialogTitle>
          <AlertDialogDescription className="text-white/70">
            {guard
              ? "未保存の変更があります。保存中に閉じた場合は、次回開いたときに保存結果を確認します。"
              : "編集を閉じます。"}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>編集に戻る</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                dirty.current = false;
                blocker.proceed?.();
              }}
            >
              変更を破棄して閉じる
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function SettingsForm({
  ownerId,
  initial,
  onGuard,
  onClose,
  onSaved,
}: {
  ownerId: string;
  initial: Loaded;
  onGuard: (value: boolean) => void;
  onClose: () => void;
  onSaved: (row: SongSettingsRow) => void;
}) {
  const { draft, dispatch, dirty } = useSongSettingsDraft(initial.song),
    [section, setSection] = useState<keyof typeof labels>("preview"),
    [source, setSource] = useState<PreparedSongSource | null>(null),
    [chart, setChart] = useState<Chart | null>(null),
    [token, setToken] = useState<PreviewOwnerToken | null>(null),
    [rights, setRights] = useState(false),
    [consent, setConsent] = useState<boolean | null>(null),
    [status, setStatus] = useState("idle"),
    [error, setError] = useState(""),
    [backgroundBusy, setBackgroundBusy] = useState(false),
    [replacementBusy, setReplacementBusy] = useState(false),
    [replacement, setReplacement] = useState(false),
    [confirmation, setConfirmation] = useState(false),
    [latest, setLatest] = useState<Loaded | null>(null),
    [loaded, setLoaded] = useState(initial);
  const alive = useRef(true),
    sourceOperation = useRef<string>(crypto.randomUUID()),
    request = useRef<string | null>(null),
    queryClient = useQueryClient();
  const imageBusy = backgroundBusy || replacementBusy;
  const pendingKey = `pulse-song-save:${ownerId}:${draft.base.id}`;
  const advanced =
    draft.bpm !== undefined ||
    draft.offsetMs !== undefined ||
    (consent !== null && consent !== source?.previewAllowed);
  const needsRevision =
    replacement ||
    advanced ||
    (!draft.base.current_revision_id &&
      draft.metadata.previewStartMs !== draft.base.preview_start_ms);
  const busy = status === "saving" || status === "preparing" || status === "reconciling";
  const errors = validateSettingsMetadata(
    draft.metadata,
    settingsMetadata(draft.base),
    source?.durationMs ?? loaded.revision?.durationMs ?? null,
  );
  const timingValidation = useMemo(() => {
    if (!chart || !source) return { error: "", range: null };
    try {
      const validated = applySongTiming(
        chart,
        source.timingBasis,
        { bpm: draft.bpm, offsetMs: draft.offsetMs },
        source.durationMs,
      );
      const notes = buildRuntimeNotes(validated);
      const start = notes[0]?.time ?? 0,
        end = notes.reduce((last, note) => Math.max(last, note.endTime ?? note.time), 0);
      return {
        error: "",
        range: { startMs: start * 1000, endMs: end * 1000, count: notes.length },
      };
    } catch {
      return {
        error: "変更後のノーツ時刻が音源の範囲外、またはBPMの根拠が不明です。",
        range: null,
      };
    }
  }, [chart, source, draft.bpm, draft.offsetMs]);
  const timingError = timingValidation.error;
  useLayoutEffect(
    () =>
      onGuard(
        dirty ||
          advanced ||
          replacement ||
          imageBusy ||
          status === "saving" ||
          status === "reconciling",
      ),
    [dirty, advanced, replacement, imageBusy, status, onGuard],
  );
  useEffect(() => {
    alive.current = true;
    const session = getAudioSession(),
      lease = session.acquirePreviewOwner(`song-settings:${ownerId}:${initial.song.id}`);
    setToken(lease);
    return () => {
      alive.current = false;
      session.releasePreviewOwner(lease);
      if (!request.current)
        void ownerTransport(ownerId)
          .then((transport) =>
            abandonSongSettingsOperation({
              data: { operationId: sourceOperation.current },
              fetch: transport,
            }),
          )
          .catch(() => {
            /* Expiration is the fallback if account/transport changed. */
          });
    };
  }, [ownerId, initial.song.id]);
  const baseVersion = useRef(draft.base.metadata_version);
  baseVersion.current = draft.base.metadata_version;
  const applyReceipt = useCallback(
    (receipt: SongSettingsReceipt) => {
      if (!alive.current || receipt.song.user_id !== ownerId || receipt.song.id !== initial.song.id)
        return;
      if (BigInt(receipt.version) < BigInt(baseVersion.current)) {
        request.current = null;
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {
          /* Optional storage. */
        }
        setStatus("saved");
        setError("以前の保存を確認しました。現在の新しい設定は保持しています。");
        return;
      }
      dispatch({ type: "reset", row: receipt.song });
      onGuard(false);
      request.current = null;
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        /* Storage may be unavailable. */
      }
      setLoaded((previous) => ({
        ...previous,
        song: receipt.song,
        background:
          previous.background?.assetId === receipt.song.background_asset_id
            ? previous.background
            : null,
      }));
      void (async () => {
        try {
          const latest = await getSongSettings({
            data: { songId: receipt.song.id },
            fetch: await ownerTransport(ownerId),
          });
          if (alive.current)
            setLoaded((previous) =>
              previous.song.metadata_version === receipt.version
                ? { ...previous, background: latest.background }
                : previous,
            );
        } catch {
          /* The committed receipt remains valid even if image signing is temporarily unavailable. */
        }
      })();
      setStatus("saved");
      setError("");
      setSource(null);
      setChart(null);
      setReplacement(false);
      setRights(false);
      setConsent(null);
      sourceOperation.current = crypto.randomUUID();
      onSaved(receipt.song);
      void queryClient.invalidateQueries({
        queryKey: ["song-settings", ownerId, receipt.song.id],
        refetchType: "none",
      });
    },
    [ownerId, initial.song.id, dispatch, onGuard, onSaved, pendingKey, queryClient],
  );
  const reconcile = useCallback(
    async (id: string) => {
      setStatus("reconciling");
      try {
        const operation = await getSongSettingsOperation({
          data: { operationId: id },
          fetch: await ownerTransport(ownerId),
        });
        if (!alive.current) return;
        if (operation?.receipt) {
          applyReceipt(operation.receipt);
          return;
        }
        if (operation?.state === "failed") {
          request.current = null;
          try {
            sessionStorage.removeItem(pendingKey);
          } catch {
            /* Optional storage. */
          }
          setStatus(
            operation.errorCode === "STALE_VERSION" || operation.errorCode === "SOURCE_CHANGED"
              ? "conflict"
              : "error",
          );
          setError(
            "保存されていないことを確認しました。変更内容を保持しています。入力・最新状態を確認してください。",
          );
          return;
        }
        setError(
          "保存結果を確認しています。元の保存を再試行するか、時間をおいて再確認してください。",
        );
      } catch {
        if (alive.current)
          setError("保存結果を確認できませんでした。通信を確認して再試行してください。");
      }
    },
    [ownerId, applyReceipt, pendingKey],
  );
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(pendingKey);
      if (pending) {
        const value: unknown = JSON.parse(pending);
        if (
          typeof value === "object" &&
          value !== null &&
          "id" in value &&
          typeof value.id === "string"
        ) {
          request.current = value.id;
          void reconcileRef.current(value.id);
        }
      }
    } catch {
      /* Do not block editing on unavailable browser storage. */
    }
  }, [pendingKey]);
  const prepare = async () => {
    setStatus("preparing");
    setError("");
    try {
      const prepared = await prepareSongSettingsSource({
        data: {
          songId: draft.base.id,
          operationId: sourceOperation.current,
          expectedVersion: draft.base.metadata_version,
          expectedRevisionId: draft.base.current_revision_id,
        },
        fetch: await ownerTransport(ownerId),
      });
      if (!alive.current) return;
      setSource(prepared);
      setRights(false);
      setConsent(null);
      const response = await fetch(prepared.chartUrl, { redirect: "error" });
      if (!response.ok) throw new Error("譜面の確認情報を取得できませんでした");
      const value = validateCanonicalChart(await response.json(), prepared.durationMs);
      if (alive.current) setChart(value);
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : "音源を準備できませんでした");
    } finally {
      if (alive.current) setStatus("idle");
    }
  };
  const refreshSource = useCallback(async () => {
    const prepared = await (replacement ? prepareChartReplacement : prepareSongSettingsSource)({
      data: {
        songId: initial.song.id,
        operationId: sourceOperation.current,
        expectedVersion: draft.base.metadata_version,
        expectedRevisionId: draft.base.current_revision_id,
      },
      fetch: await ownerTransport(ownerId),
    });
    if (alive.current)
      setSource((current) =>
        current?.operationId === prepared.operationId && current.audioHash === prepared.audioHash
          ? prepared
          : current,
      );
    return prepared;
  }, [
    replacement,
    initial.song.id,
    draft.base.metadata_version,
    draft.base.current_revision_id,
    ownerId,
  ]);
  const save = async () => {
    if (busy || imageBusy || (!dirty && !advanced && !replacement)) return;
    if (
      Object.keys(errors).length ||
      timingError ||
      (needsRevision && (!source || !rights)) ||
      (replacement && consent === null)
    ) {
      setError("入力内容と音源に対する権利確認を確認してください。");
      return;
    }
    setConfirmation(false);
    setStatus("saving");
    setError("");
    request.current ??= crypto.randomUUID();
    const payload: SaveSongSettingsInput = {
      songId: draft.base.id,
      requestId: request.current,
      expectedVersion: draft.base.metadata_version,
      expectedRevisionId: draft.base.current_revision_id,
      metadata: {
        ...draft.metadata,
        title:
          draft.metadata.title === draft.base.title
            ? draft.metadata.title
            : draft.metadata.title.trim(),
      },
      background: draft.background,
      gameplay:
        draft.bpm !== undefined || draft.offsetMs !== undefined
          ? {
              action: "timing",
              sourceOperationId: source!.operationId,
              ...(draft.bpm === undefined ? {} : { bpm: draft.bpm }),
              ...(draft.offsetMs === undefined ? {} : { offsetMs: draft.offsetMs }),
            }
          : replacement
            ? { action: "prepared-replacement", sourceOperationId: source!.operationId }
            : { action: "keep" },
      ...(needsRevision && source
        ? {
            sourceOperationId: source.operationId,
            rightsConfirmation: { confirmed: true, sourceOperationId: source.operationId },
            ...(consent === null
              ? {}
              : { previewConsent: { allowed: consent, sourceOperationId: source.operationId } }),
          }
        : {}),
    };
    try {
      sessionStorage.setItem(
        pendingKey,
        JSON.stringify({ id: request.current, ownerId, songId: draft.base.id }),
      );
    } catch {
      /* The in-memory intent still has the same UUID. */
    }
    try {
      const receipt = await saveSongSettings({
        data: payload,
        fetch: await ownerTransport(ownerId),
      });
      applyReceipt(receipt);
    } catch (reason) {
      if (!alive.current) return;
      const message = reason instanceof Error ? reason.message : "保存できませんでした";
      if (/STALE_VERSION|SOURCE_CHANGED/.test(message)) {
        setStatus("conflict");
        setError("別の更新があります。最新内容と現在の変更を比較してください。");
        request.current = null;
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {
          /* Optional storage. */
        }
      } else if (
        /INVALID_INPUT|NOT_FOUND_OR_FORBIDDEN|SERVER_NOT_READY|ASSET_NOT_READY/.test(message)
      ) {
        setStatus("error");
        setError(message);
        request.current = null;
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {
          /* Optional storage. */
        }
      } else if (request.current) await reconcile(request.current);
    }
  };
  const duration = source?.durationMs;
  return (
    <>
      <nav
        aria-label="楽曲設定の項目"
        className="flex shrink-0 gap-1 border-b border-white/10 p-2 sm:px-5"
      >
        {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-current={section === key ? "page" : undefined}
            onClick={() => setSection(key)}
            className={`min-h-11 flex-1 rounded-xl px-2 text-sm ${section === key ? "bg-cyan-200/15 text-cyan-100" : "text-white/60 hover:bg-white/5"}`}
          >
            {labels[key]}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        <fieldset disabled={busy} className="min-w-0">
          <div hidden={section !== "preview"}>
            {source && token ? (
              <SongPreviewEditor
                ownerId={ownerId}
                source={source}
                startMs={draft.metadata.previewStartMs}
                onChange={(value) =>
                  dispatch({
                    type: "metadata",
                    value: { ...draft.metadata, previewStartMs: value },
                  })
                }
                token={token}
                refreshSource={refreshSource}
                timing={{ bpm: draft.bpm, offsetMs: draft.offsetMs }}
                chart={chart}
              />
            ) : (
              <div>
                <h3 className="font-semibold">18秒の試聴位置を調整</h3>
                <p className="my-3 text-sm text-white/65">
                  音源を検証して波形と所有者専用の試聴を準備します。公開試聴の許可は自動では変更しません。
                </p>
                <button
                  type="button"
                  disabled={!loaded.capabilities.songTimingRevisionEnabled || busy || imageBusy}
                  className="min-h-11 rounded-xl border border-cyan-200/40 px-4 text-cyan-100 disabled:opacity-40"
                  onClick={() => void prepare()}
                >
                  音源と波形を準備
                </button>
                {!loaded.capabilities.songTimingRevisionEnabled && (
                  <p className="mt-3 text-sm text-white/60">
                    音源検証はサーバーの準備完了後に利用できます。
                  </p>
                )}
              </div>
            )}
            {source && (
              <div className="mt-5 border-t border-white/10 pt-4">
                <h3 className="font-semibold">公開選曲での試聴許可</h3>
                <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={consent ?? source.previewAllowed}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  この音源の試聴配信を許可する
                </label>
                <p className="text-xs text-white/50">
                  許可を変更すると、新しい譜面版として保存されます。
                </p>
              </div>
            )}
          </div>
          <div hidden={section !== "background"}>
            <SongBackgroundEditor
              key={draft.base.metadata_version}
              ownerId={ownerId}
              songId={draft.base.id}
              current={loaded.background}
              enabled={loaded.capabilities.songBackgroundUploadEnabled && !replacementBusy}
              value={draft.background}
              onChange={(value) => dispatch({ type: "background", value })}
              onBusy={setBackgroundBusy}
            />
          </div>
          <div hidden={section !== "metadata"}>
            <SongMetadataFields
              hidePreview
              value={{ ...draft.metadata, description: draft.metadata.description ?? "" }}
              onChange={(value) =>
                dispatch({
                  type: "metadata",
                  value: {
                    ...value,
                    description:
                      value.description === "" && draft.base.description === null
                        ? null
                        : value.description,
                  },
                })
              }
            />
            <div className="my-5 border-t border-white/10 pt-4">
              <h3 className="font-semibold">譜面タイミング</h3>
              <p className="my-2 text-sm text-white/65">
                BPM・Offsetを変更すると、新しい譜面版として保存されます。過去の成績と旧版は保持されます。
              </p>
              {source ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="label">
                    {source.timingBasis === "beats" ? "BPM" : "内部タイミング値（BPM編集不可）"}
                    <input
                      className="field"
                      type="number"
                      step="any"
                      min="0"
                      disabled={source.timingBasis !== "beats"}
                      value={draft.bpm ?? source.bpm}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        dispatch({
                          type: "timing",
                          ...(value === source.bpm ? {} : { bpm: value }),
                          ...(draft.offsetMs === undefined ? {} : { offsetMs: draft.offsetMs }),
                        });
                      }}
                    />
                  </label>
                  <label className="label">
                    譜面Offset（ms）
                    <input
                      className="field"
                      type="number"
                      step="1"
                      value={draft.offsetMs ?? source.offset * 1000}
                      onChange={(event) => {
                        const value = Math.round(Number(event.target.value));
                        dispatch({
                          type: "timing",
                          ...(draft.bpm === undefined ? {} : { bpm: draft.bpm }),
                          ...(value === source.offset * 1000 ? {} : { offsetMs: value }),
                        });
                      }}
                    />
                  </label>
                  <p className="text-xs text-white/50 sm:col-span-2">
                    {source.timingBasis === "absolute-seconds"
                      ? "FNF/.osu は秒に正規化済みです。内部値60を原曲BPMとして扱いません。"
                      : source.timingBasis === "unknown"
                        ? "原形式の根拠がないためBPMは読み取り専用です。"
                        : "Nativeのbeat基準を保持しています。"}{" "}
                    Offsetは未変更なら元の精度を維持します。
                  </p>
                </div>
              ) : (
                <p className="text-sm text-white/50">
                  試聴の項目から音源を準備すると確認できます。
                </p>
              )}
              {timingError && (
                <p role="alert" className="text-sm text-rose-200">
                  {timingError}
                </p>
              )}
            </div>
            {loaded.capabilities.songTimingRevisionEnabled && (
              <SongReplacementEditor
                row={draft.base}
                onBusy={setReplacementBusy}
                disabled={backgroundBusy}
                onPrepared={(prepared) => {
                  setSource(prepared);
                  sourceOperation.current = prepared.operationId;
                  setReplacement(true);
                  setRights(false);
                  setConsent(null);
                  void fetch(prepared.chartUrl, { redirect: "error" })
                    .then((response) => response.json())
                    .then((value) => {
                      if (alive.current)
                        setChart(validateCanonicalChart(value, prepared.durationMs));
                    })
                    .catch(() => {
                      if (alive.current) setError("同期確認用の譜面を取得できませんでした");
                    });
                }}
              />
            )}
            <dl className="grid grid-cols-2 gap-2 text-sm text-white/60">
              <dt>ノーツ / レーン</dt>
              <dd>
                {draft.base.note_count} / {draft.base.lane_count}
              </dd>
              <dt>原形式 / 時刻基準</dt>
              <dd>
                {source ? `${source.sourceFormat} / ${source.timingBasis}` : draft.base.chart_type}
              </dd>
              <dt>音源時間</dt>
              <dd>{duration === undefined ? "未検証" : `${(duration / 1000).toFixed(3)}秒`}</dd>
              <dt>版</dt>
              <dd className="break-all text-xs">{draft.base.current_revision_id ?? "旧形式"}</dd>
              <dt>公開状態</dt>
              <dd>{draft.base.is_published ? "公開中" : "下書き"}（設定保存では変更しません）</dd>
              <dt>FNF採点側</dt>
              <dd>{draft.base.chart_type === "fnf" ? (draft.base.fnf_side ?? "共有") : "共有"}</dd>
            </dl>
          </div>
        </fieldset>
        {Object.entries(errors).map(([key, value]) => (
          <p role="alert" className="mt-2 text-sm text-rose-200" key={key}>
            {key}: {value}
          </p>
        ))}
        {error && (
          <p role="alert" className="mt-4 whitespace-pre-wrap text-sm text-rose-200">
            {error}
          </p>
        )}
        {status === "reconciling" && request.current && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => void reconcile(request.current!)}
            >
              保存結果を再確認
            </button>
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => {
                void (async () => {
                  try {
                    applyReceipt(
                      await resumeSongSettingsSave({
                        data: { operationId: request.current! },
                        fetch: await ownerTransport(ownerId),
                      }),
                    );
                  } catch {
                    if (alive.current)
                      setError("保存結果を確認できません。しばらくして再確認してください。");
                  }
                })();
              }}
            >
              同じ保存を再試行
            </button>
          </div>
        )}
        {status === "conflict" && (
          <div className="mt-3">
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() =>
                void (async () => {
                  try {
                    const next = await getSongSettings({
                      data: { songId: draft.base.id },
                      fetch: await ownerTransport(ownerId),
                    });
                    if (alive.current) setLatest(next);
                  } catch {
                    setError("最新内容を取得できませんでした。");
                  }
                })()
              }
            >
              最新内容を読み込んで比較
            </button>
            {latest && (
              <div className="rounded-xl border border-white/10 p-3">
                <p className="text-sm">
                  最新: {latest.song.title} / 自分の変更: {draft.metadata.title}
                </p>
                <p className="my-2 text-xs text-white/60">
                  最新内容で再開すると、未保存の画像・タイミングを含め現在の変更を破棄します。
                </p>
                <button
                  type="button"
                  className="min-h-11 underline"
                  onClick={() => {
                    dispatch({ type: "reset", row: latest.song });
                    setLoaded(latest);
                    setLatest(null);
                    setSource(null);
                    setChart(null);
                    setReplacement(false);
                    setRights(false);
                    setConsent(null);
                    sourceOperation.current = crypto.randomUUID();
                    setStatus("idle");
                    setError("");
                  }}
                >
                  最新内容でやり直す
                </button>
                <button
                  type="button"
                  className="min-h-11 px-3 underline"
                  onClick={() => setLatest(null)}
                >
                  自分の変更に戻る
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="shrink-0 border-t border-white/10 p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6">
        <p role="status" className="mb-2 text-xs text-white/60">
          {status === "saved" && !dirty && !advanced && !replacement
            ? "保存しました"
            : status === "saving"
              ? "保存中…"
              : status === "preparing"
                ? "音源を検証中…"
                : status === "reconciling"
                  ? "保存結果を確認しています"
                  : imageBusy
                    ? "画像を準備中…"
                    : dirty || advanced || replacement
                      ? "未保存の変更があります"
                      : "変更はありません"}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={
              busy ||
              imageBusy ||
              !loaded.capabilities.songSettingsEnabled ||
              (!dirty && !advanced && !replacement) ||
              Object.keys(errors).length > 0 ||
              Boolean(timingError)
            }
            className="min-h-11 flex-1 rounded-xl bg-cyan-200 px-4 font-bold text-[#101522] disabled:opacity-40"
            onClick={() => setConfirmation(true)}
          >
            変更を保存
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl border border-white/20 px-4"
            onClick={onClose}
          >
            キャンセル
          </button>
        </div>
        <a
          className="mt-2 block text-xs text-white/50 underline"
          href="/third-party/song-settings/index.txt"
          target="_blank"
          rel="noopener noreferrer"
        >
          音声・画像ライブラリのライセンス
        </a>
      </footer>
      <AlertDialog open={confirmation} onOpenChange={setConfirmation}>
        <AlertDialogContent className="max-h-[85dvh] w-[calc(100%_-_24px)] overflow-y-auto rounded-2xl border-white/10 bg-[#101522] text-white">
          <AlertDialogTitle>変更内容を確認</AlertDialogTitle>
          <AlertDialogDescription className="text-white/70">
            {draft.metadata.title}{" "}
            の曲情報・試聴位置・背景を一括で保存します。公開状態と過去の成績は維持します。
          </AlertDialogDescription>
          {needsRevision && source && (
            <div className="text-sm">
              <p>
                BPM: {source.bpm} → {draft.bpm ?? source.bpm} / Offset: {source.offset * 1000} →{" "}
                {draft.offsetMs ?? source.offset * 1000} ms
              </p>
              <p className="my-2">新しい譜面版を作成します。XPの承認は引き継ぎません。</p>
              {timingValidation.range && (
                <p>
                  変更後の採点ノーツ: {timingValidation.range.count} /{" "}
                  {timingValidation.range.startMs.toFixed(3)}〜
                  {timingValidation.range.endMs.toFixed(3)} ms
                </p>
              )}
              <p className="my-2 break-all text-xs">
                変更元: {draft.base.current_revision_id ?? "旧形式の譜面"}
              </p>
              {replacement && (
                <label className="label my-3">
                  新しい音源の試聴配信
                  <select
                    className="field"
                    value={consent === null ? "" : consent ? "yes" : "no"}
                    onChange={(event) =>
                      setConsent(event.target.value === "" ? null : event.target.value === "yes")
                    }
                  >
                    <option value="">明示的に選択してください</option>
                    <option value="yes">許可する</option>
                    <option value="no">許可しない</option>
                  </select>
                </label>
              )}
              <label className="flex min-h-11 gap-2">
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(event) => setRights(event.target.checked)}
                />
                この準備済み音源・譜面を配信する権利を確認しました
              </label>
              <p className="break-all text-xs text-white/50">音源: {source.audioHash}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>編集に戻る</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                (needsRevision && (!source || !rights)) || (replacement && consent === null)
              }
              onClick={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              確認して保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
