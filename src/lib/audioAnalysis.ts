import { sha256 } from "@noble/hashes/sha2.js";
import { PeaksAccumulator, MAX_AUDIO_BYTES } from "./waveform";
import type { AudioRangeSource } from "./audioRange";
import { OggStreamValidator, Mp3StreamValidator } from "./audioContainerValidation";
type Decoded = { channelData: Float32Array[]; sampleRate: number; errors: unknown[] };
type StreamingDecoder = {
  ready: Promise<void>;
  decode: (bytes: Uint8Array) => Decoded | Promise<Decoded>;
  flush?: () => Promise<Decoded>;
  free: () => void;
};
export type AudioAnalysisResult = Awaited<ReturnType<typeof analyzeAudioStream>>;
/** A bounded sequential reader. It never retains a file-sized encoded or PCM buffer. */
class StreamReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Uint8Array = new Uint8Array(0);
  private count = 0;
  readonly hash = sha256.create();
  constructor(
    stream: ReadableStream<Uint8Array>,
    private signal: AbortSignal,
  ) {
    this.reader = stream.getReader();
    signal.addEventListener("abort", this.cancel, { once: true });
  }
  private cancel = () => {
    void this.reader.cancel(this.signal.reason).catch(() => {});
  };
  async read(max = 32768): Promise<Uint8Array | null> {
    if (this.signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (!this.pending.length) {
      const item = await this.reader.read();
      if (item.done) return null;
      this.count += item.value.byteLength;
      if (this.count > MAX_AUDIO_BYTES) throw new Error("AUDIO_TOO_LARGE");
      this.hash.update(item.value);
      this.pending = item.value;
    }
    const part = this.pending.subarray(0, max);
    this.pending = this.pending.subarray(part.length);
    return part;
  }
  async exact(length: number) {
    if (length > 65536) throw new Error("AUDIO_HEADER_TOO_LARGE");
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = await this.read(length - offset);
      if (!chunk) throw new Error("AUDIO_TRUNCATED");
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  async skip(length: number) {
    while (length > 0) {
      const part = await this.read(Math.min(length, 32768));
      if (!part) throw new Error("AUDIO_TRUNCATED");
      length -= part.length;
    }
  }
  get bytesRead() {
    return this.count;
  }
  async close() {
    this.signal.removeEventListener("abort", this.cancel);
    await this.reader.cancel().catch(() => {});
    this.reader.releaseLock();
  }
}
const ascii = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export async function analyzeAudioStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onProgress?: (durationMs: number) => void,
  getRanges?: (bytes: number) => Promise<AudioRangeSource>,
) {
  const reader = new StreamReader(stream, signal),
    peaks = new PeaksAccumulator();
  let decoder: StreamingDecoder | undefined;
  let mime = "",
    format: "wav" | "mp3" | "ogg-vorbis" | "ogg-opus" | "mp4-aac" | "webm-opus";
  let lastProgress = 0;
  const progress = () => {
    if (performance.now() - lastProgress > 250) {
      lastProgress = performance.now();
      onProgress?.(peaks.durationMs);
    }
  };
  try {
    const prefix = await reader.exact(12);
    if (
      ascii(prefix.subarray(4, 8)) === "ftyp" ||
      (prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3)
    ) {
      if (!getRanges) throw new Error("AUDIO_RANGE_SOURCE_REQUIRED");
      const kind = ascii(prefix.subarray(4, 8)) === "ftyp" ? "mp4" : "webm";
      // Finish the encoded hash/upload before demuxing immutable snapshot ranges.
      // MP4 moov-at-end needs no file-sized cache or full PCM allocation.
      while (await reader.read()) {
        if (signal.aborted) throw signal.reason;
      }
      const ranges = await getRanges(reader.bytesRead);
      if (ranges.size !== reader.bytesRead) throw new Error("AUDIO_SOURCE_MISMATCH");
      const { analyzeContainerAudio } = await import("./containerAudio");
      await analyzeContainerAudio(ranges, kind, peaks, signal, progress);
      format = kind === "mp4" ? "mp4-aac" : "webm-opus";
      mime = kind === "mp4" ? "audio/mp4" : "audio/webm";
    } else if (
      ascii(prefix.subarray(0, 4)) === "RIFF" &&
      ascii(prefix.subarray(8, 12)) === "WAVE"
    ) {
      format = "wav";
      mime = "audio/wav";
      const expected = new DataView(prefix.buffer).getUint32(4, true) + 8;
      if (expected > MAX_AUDIO_BYTES) throw new Error("AUDIO_TOO_LARGE");
      let position = 12,
        codec = 0,
        channels = 0,
        rate = 0,
        bits = 0,
        align = 0,
        data = false;
      while (position < expected) {
        const chunk = await reader.exact(8),
          view = new DataView(chunk.buffer);
        const kind = ascii(chunk.subarray(0, 4)),
          size = view.getUint32(4, true);
        position += 8;
        if (position + size + (size % 2) > expected) throw new Error("AUDIO_TRUNCATED");
        if (kind === "fmt ") {
          if (codec || size < 16 || size > 4096) throw new Error("UNSUPPORTED_AUDIO_FORMAT");
          const bytes = await reader.exact(size),
            v = new DataView(bytes.buffer);
          codec = v.getUint16(0, true);
          channels = v.getUint16(2, true);
          rate = v.getUint32(4, true);
          align = v.getUint16(12, true);
          bits = v.getUint16(14, true);
          if (
            ![1, 3].includes(codec) ||
            ![8, 16, 24, 32].includes(bits) ||
            (codec === 3 && bits !== 32) ||
            channels < 1 ||
            channels > 8 ||
            rate < 8000 ||
            rate > 192000 ||
            align !== (channels * bits) / 8 ||
            v.getUint32(8, true) !== rate * align
          )
            throw new Error("UNSUPPORTED_AUDIO_FORMAT");
        } else if (kind === "data") {
          if (!codec || size % align) throw new Error("AUDIO_DECODE_INVALID");
          data = true;
          for (let remaining = size; remaining > 0;) {
            const bytes = await reader.exact(
              Math.min(remaining, Math.floor(32768 / align) * align),
            );
            remaining -= bytes.length;
            const v = new DataView(bytes.buffer),
              frames = bytes.length / align;
            const pcm = Array.from({ length: channels }, () => new Float32Array(frames));
            for (let frame = 0; frame < frames; frame++)
              for (let channel = 0; channel < channels; channel++) {
                const offset = frame * align + (channel * bits) / 8;
                pcm[channel]![frame] =
                  codec === 3
                    ? v.getFloat32(offset, true)
                    : bits === 8
                      ? (v.getUint8(offset) - 128) / 128
                      : bits === 16
                        ? v.getInt16(offset, true) / 32768
                        : bits === 24
                          ? (v.getUint8(offset) |
                              (v.getUint8(offset + 1) << 8) |
                              (v.getInt8(offset + 2) << 16)) /
                            8388608
                          : v.getInt32(offset, true) / 2147483648;
              }
            peaks.add(pcm, rate);
            progress();
          }
        } else await reader.skip(size);
        if (size % 2) await reader.skip(1);
        position += size + (size % 2);
      }
      if (!data || (await reader.read())) throw new Error("AUDIO_CONTAINER_MISMATCH");
    } else {
      let initial = prefix;
      if (ascii(prefix.subarray(0, 4)) === "OggS") {
        const rest = await reader.exact(64);
        initial = new Uint8Array(76);
        initial.set(prefix);
        initial.set(rest, 12);
        const signature = ascii(initial);
        if (signature.includes("OpusHead")) {
          const { OggOpusDecoder } = await import("ogg-opus-decoder");
          decoder = new OggOpusDecoder();
          format = "ogg-opus";
        } else if (signature.includes("vorbis")) {
          const { OggVorbisDecoder } = await import("./codecs/oggVorbis");
          decoder = new OggVorbisDecoder();
          format = "ogg-vorbis";
        } else throw new Error("UNSUPPORTED_AUDIO_FORMAT");
        mime = "audio/ogg";
      } else if (
        ascii(prefix.subarray(0, 3)) === "ID3" ||
        (prefix[0] === 255 && (prefix[1]! & 224) === 224)
      ) {
        const { MPEGDecoder } = await import("mpg123-decoder");
        decoder = new MPEGDecoder({ enableGapless: true });
        format = "mp3";
        mime = "audio/mpeg";
      } else throw new Error("UNSUPPORTED_AUDIO_FORMAT");
      const container = format === "mp3" ? new Mp3StreamValidator() : new OggStreamValidator();
      await decoder.ready;
      const consume = (value: Decoded) => {
        if (value.errors.length) throw new Error("AUDIO_DECODE_INVALID");
        if (value.channelData[0]?.length) peaks.add(value.channelData, value.sampleRate);
        progress();
      };
      container.push(initial);
      consume(await decoder.decode(initial));
      for (;;) {
        const bytes = await reader.read();
        if (!bytes) break;
        container.push(bytes);
        consume(await decoder.decode(bytes));
      }
      if (decoder.flush) consume(await decoder.flush());
      const containerDuration = container.finish();
      if (
        typeof containerDuration === "number" &&
        Math.abs(containerDuration - peaks.durationMs) > 1
      )
        throw new Error("AUDIO_DURATION_MISMATCH");
    }
    const waveform = peaks.finish();
    return {
      waveform,
      format,
      mime,
      bytes: reader.bytesRead,
      audioHash: [...reader.hash.digest()].map((x) => x.toString(16).padStart(2, "0")).join(""),
    };
  } finally {
    decoder?.free();
    await reader.close();
  }
}
