/** PUT a file to a signed upload URL with progress + abort support. */
export function putWithProgress(
  url: string,
  file: File,
  onProgress: (loaded: number) => void,
  xhrRef: { current: XMLHttpRequest | null },
  options: { upsert?: boolean; signal?: AbortSignal } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", String(options.upsert ?? true));
    const abort = () => xhr.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => {
      options.signal?.removeEventListener("abort", abort);
      if (xhrRef.current === xhr) xhrRef.current = null;
    };
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`${file.name}: アップロード失敗 (${xhr.status})`));
    xhr.onerror = () => reject(new Error(`${file.name}: 通信エラー`));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    if (options.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    xhr.send(file);
  });
}
