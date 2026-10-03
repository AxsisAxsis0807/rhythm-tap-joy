import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Music2, Pause, Play, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "songs";

export interface UploadJob {
  songId: string;
  userId: string;
  title: string;
  subtitle: string;
  cover: File | null;
  files: [string, File][];
  row: Record<string, unknown>;
}

type Status = "uploading" | "paused" | "done" | "error";

export interface UploadTaskState {
  job: UploadJob;
  status: Status;
  /** Bytes sent across all files. */
  sent: number;
  total: number;
  fileIndex: number;
  error?: string;
}

/** PUT a file to a signed upload URL with progress + abort support. */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (loaded: number) => void,
  xhrRef: { current: XMLHttpRequest | null },
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`${file.name}: ${xhr.status} ${xhr.responseText.slice(0, 120)}`));
    xhr.onerror = () => reject(new Error(`${file.name}: 通信エラー`));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    xhr.send(file);
  });
}

export function useUploadTask(onDone: () => void) {
  const [task, setTask] = useState<UploadTaskState | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const runningRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const run = useCallback(async (job: UploadJob, fromIndex: number) => {
    if (runningRef.current) return;
    runningRef.current = true;
    const sizes = job.files.map(([, f]) => f.size);
    const total = sizes.reduce((a, b) => a + b, 0);
    const before = (i: number) => sizes.slice(0, i).reduce((a, b) => a + b, 0);
    setTask({ job, status: "uploading", sent: before(fromIndex), total, fileIndex: fromIndex });
    try {
      for (let i = fromIndex; i < job.files.length; i++) {
        const [field, file] = job.files[i]!;
        const path = `${job.userId}/${job.songId}/${field}-${file.name}`;
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (error || !data) throw new Error(`${file.name}: ${error?.message ?? "URL取得失敗"}`);
        setTask((t) => t && { ...t, fileIndex: i, sent: before(i) });
        await putWithProgress(
          data.signedUrl,
          file,
          (loaded) => setTask((t) => t && { ...t, sent: before(i) + loaded }),
          xhrRef,
        );
        job.row[field] = path;
      }
      const { error } = await supabase.from("songs").insert(job.row as never);
      if (error) throw new Error(error.message);
      setTask((t) => t && { ...t, status: "done", sent: total, fileIndex: job.files.length });
      onDoneRef.current();
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      setTask((t) =>
        t && {
          ...t,
          status: aborted ? "paused" : "error",
          sent: before(t.fileIndex),
          error: aborted ? undefined : e instanceof Error ? e.message : "アップロード失敗",
        },
      );
    } finally {
      xhrRef.current = null;
      runningRef.current = false;
    }
  }, []);

  const start = useCallback((job: UploadJob) => void run(job, 0), [run]);
  const pause = useCallback(() => xhrRef.current?.abort(), []);
  const resume = useCallback(() => {
    if (task && (task.status === "paused" || task.status === "error")) void run(task.job, task.fileIndex);
  }, [task, run]);
  const dismiss = useCallback(() => {
    xhrRef.current?.abort();
    setTask(null);
  }, []);

  return { task, start, pause, resume, dismiss, busy: task?.status === "uploading" || task?.status === "paused" };
}

export function UploadMiniBar({
  task,
  onPause,
  onResume,
  onDismiss,
}: {
  task: UploadTaskState;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!task.job.cover) return;
    const url = URL.createObjectURL(task.job.cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [task.job.cover]);
  const pct = task.total ? Math.min(100, Math.round((task.sent / task.total) * 100)) : 0;
  const count = task.job.files.length;
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  const status =
    task.status === "done"
      ? "アップロード完了・公開できます"
      : task.status === "paused"
        ? `一時停止中 · ${pct}%`
        : task.status === "error"
          ? `失敗: ${task.error ?? ""}`
          : `アップロード中 ${Math.min(task.fileIndex + 1, count)}/${count} · ${pct}% (${mb(task.sent)}/${mb(task.total)}MB)`;
  return (
    <div className="fixed inset-x-2 bottom-20 z-40 mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#2a2f45]/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3 p-2.5">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-violet-400/20">
          {coverUrl ? <img src={coverUrl} alt="" className="size-full object-cover" /> : <Music2 className="size-5 text-cyan-100" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{task.job.title}</p>
          <p className={`truncate text-xs ${task.status === "error" ? "text-rose-300" : "text-white/55"}`}>{status}</p>
        </div>
        {task.status === "done" ? (
          <>
            <span className="flex size-9 items-center justify-center rounded-full bg-emerald-400">
              <Check className="size-5 text-[#0b101a]" />
            </span>
            <button type="button" aria-label="閉じる" onClick={onDismiss} className="p-2 text-white/60">
              <X className="size-5" />
            </button>
          </>
        ) : (
          <>
            {task.status === "uploading" ? (
              <button type="button" aria-label="停止" onClick={onPause} className="p-2">
                <Pause className="size-6 fill-current" />
              </button>
            ) : (
              <button type="button" aria-label="再開" onClick={onResume} className="p-2">
                <Play className="size-6 fill-current" />
              </button>
            )}
            {task.status !== "uploading" && (
              <button type="button" aria-label="中止" onClick={onDismiss} className="p-2 text-white/60">
                <X className="size-5" />
              </button>
            )}
          </>
        )}
      </div>
      <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-white/15">
        <div className="h-full bg-white transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
