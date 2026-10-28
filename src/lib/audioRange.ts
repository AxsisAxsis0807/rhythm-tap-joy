import { MAX_AUDIO_BYTES } from "./waveform";
export type AudioRangeSource = {
  size: number;
  read: (start: number, end: number) => Promise<Uint8Array>;
};
/** A signed immutable URL only; callers derive it from an authorized source operation. */
export function signedAudioRanges(
  url: string,
  size: number,
  signal: AbortSignal,
): AudioRangeSource {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_AUDIO_BYTES)
    throw new Error("AUDIO_TOO_LARGE");
  return {
    size,
    async read(start, end) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > size ||
        end - start > 8 * 1024 * 1024
      )
        throw new Error("AUDIO_RANGE_INVALID");
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end - 1}` },
        signal,
        redirect: "error",
        credentials: "omit",
      });
      if (
        response.status !== 206 ||
        response.headers.get("Content-Range") !== `bytes ${start}-${end - 1}/${size}` ||
        !response.body
      )
        throw new Error("AUDIO_RANGE_UNAVAILABLE");
      const bytes = new Uint8Array(end - start),
        reader = response.body.getReader();
      let received = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          if (received + item.value.length > bytes.length) throw new Error("AUDIO_RANGE_INVALID");
          bytes.set(item.value, received);
          received += item.value.length;
        }
        if (received !== bytes.length) throw new Error("AUDIO_TRUNCATED");
        return bytes;
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
  };
}
