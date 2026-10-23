/** PUT a file to a signed upload URL with progress + abort support. */
export function putWithProgress(
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
