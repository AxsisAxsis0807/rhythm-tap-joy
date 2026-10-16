import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertManagedPath } from "./chartValidation";
/** Only server-resolved managed paths are accepted by callers. Never accept a browser URL. */
export async function openStorageObject(bucket: string, path: string, signal?: AbortSignal) {
  assertManagedPath(path);
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data) throw new Error("ASSET_UNAVAILABLE");
  const response = await fetch(data.signedUrl, {
    redirect: "error",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok || !response.body) throw new Error("ASSET_UNAVAILABLE");
  return response;
}
export async function readBoundedStorage(
  bucket: string,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const response = await openStorageObject(bucket, path, signal);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      received += item.value.byteLength;
      if (received > maxBytes) throw new Error("ASSET_TOO_LARGE");
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function sniffAudioStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < 12) {
      const item = await reader.read();
      if (item.done) throw new Error("AUDIO_TRUNCATED");
      parts.push(item.value);
      length += item.value.length;
    }
    const prefix = new Uint8Array(12);
    let offset = 0;
    for (const part of parts) {
      const count = Math.min(part.length, 12 - offset);
      prefix.set(part.subarray(0, count), offset);
      offset += count;
      if (offset === 12) break;
    }
    const ascii = new TextDecoder().decode(prefix);
    const mime =
      ascii.startsWith("RIFF") && ascii.slice(8) === "WAVE"
        ? "audio/wav"
        : ascii.startsWith("OggS")
          ? "audio/ogg"
          : ascii.startsWith("ID3") || (prefix[0] === 255 && (prefix[1]! & 224) === 224)
            ? "audio/mpeg"
            : ascii.slice(4, 8) === "ftyp"
              ? "audio/mp4"
              : prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3
                ? "audio/webm"
                : null;
    if (!mime) throw new Error("UNSUPPORTED_AUDIO_FORMAT");
    return {
      mime,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
        },
        async pull(controller) {
          try {
            const item = await reader.read();
            if (item.done) {
              controller.close();
              reader.releaseLock();
            } else controller.enqueue(item.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason).catch(() => {});
          reader.releaseLock();
        },
      }),
    };
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    reader.releaseLock();
    throw error;
  }
}
