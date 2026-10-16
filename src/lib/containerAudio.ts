import { CustomSource, Input, MP4, MATROSKA, WEBM, EncodedPacketSink } from "mediabunny";
import { PeaksAccumulator, MAX_AUDIO_BYTES } from "./waveform";
import type { AudioRangeSource } from "./audioRange";
import { createAacDecoder } from "./codecs/aacDecoder";
import { webmOpusTiming } from "./webmOpusTiming";
export async function analyzeContainerAudio(
  source: AudioRangeSource,
  kind: "mp4" | "webm",
  peaks: PeaksAccumulator,
  signal: AbortSignal,
  progress: () => void,
) {
  if (source.size > MAX_AUDIO_BYTES) throw new Error("AUDIO_TOO_LARGE");
  const input = new Input({
    source: new CustomSource({
      getSize: () => source.size,
      read: source.read,
      maxCacheSize: 4 * 1024 * 1024,
      prefetchProfile: "none",
      handleUnhandledError: () => {},
    }),
    formats: [MP4, MATROSKA, WEBM],
  });
  let free: (() => void) | undefined;
  try {
    const tracks = await input.getAudioTracks();
    if (tracks.length !== 1) throw new Error("UNSUPPORTED_AUDIO_FORMAT");
    const track = tracks[0]!,
      config = await track.getDecoderConfig();
    if (!config || config.numberOfChannels > 8 || config.sampleRate > 192000)
      throw new Error("UNSUPPORTED_AUDIO_FORMAT");
    const packets = new EncodedPacketSink(track);
    let decode: (bytes: Uint8Array) => {
        channelData: Float32Array[];
        sampleRate: number;
        errors: unknown[];
      },
      webmPadding = 0,
      position = 0;
    if (kind === "mp4" && (await track.getCodec()) === "aac") {
      if (!config.description) throw new Error("AAC_CONFIGURATION_MISSING");
      const description = ArrayBuffer.isView(config.description)
        ? new Uint8Array(
            config.description.buffer,
            config.description.byteOffset,
            config.description.byteLength,
          )
        : new Uint8Array(config.description);
      const decoder = await createAacDecoder(description);
      decode = decoder.decode;
      free = decoder.free;
    } else if (kind === "webm" && (await track.getCodec()) === "opus") {
      const timing = await webmOpusTiming(source, signal);
      if (!config.description) throw new Error("OPUS_CONFIGURATION_MISSING");
      const d = ArrayBuffer.isView(config.description)
        ? new Uint8Array(
            config.description.buffer,
            config.description.byteOffset,
            config.description.byteLength,
          )
        : new Uint8Array(config.description);
      if (
        d.length < 19 ||
        new TextDecoder().decode(d.subarray(0, 8)) !== "OpusHead" ||
        d[18] !== 0 ||
        config.numberOfChannels > 2
      )
        throw new Error("UNSUPPORTED_OPUS_MAPPING");
      const preSkip = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(10, true);
      if (Math.abs((timing.delayNs / 1e9) * 48000 - preSkip) > 1)
        throw new Error("OPUS_DELAY_MISMATCH");
      webmPadding = Math.round((timing.paddingNs / 1e9) * 48000);
      const { OpusDecoder } = await import("opus-decoder"),
        decoder = new OpusDecoder({ channels: config.numberOfChannels, preSkip });
      await decoder.ready;
      decode = decoder.decodeFrame;
      free = decoder.free;
    } else throw new Error("UNSUPPORTED_AUDIO_FORMAT");
    let pending: { channelData: Float32Array[]; sampleRate: number } | null = null;
    for await (const packet of packets.packets()) {
      if (signal.aborted) throw signal.reason;
      if (packet.data.length > 1048576) throw new Error("AUDIO_PACKET_TOO_LARGE");
      const pcm = decode(packet.data);
      if (pcm.errors.length) throw new Error("AUDIO_DECODE_INVALID");
      if (kind === "webm") {
        if (pending) peaks.add(pending.channelData, pending.sampleRate);
        pending = pcm;
      } else {
        const timestamp = Math.round(packet.timestamp * pcm.sampleRate),
          frames = Math.min(
            pcm.channelData[0]!.length,
            Math.round(packet.duration * pcm.sampleRate),
          );
        if (frames < 0 || !Number.isSafeInteger(timestamp))
          throw new Error("AUDIO_TIMESTAMP_INVALID");
        const skip = Math.max(0, position - timestamp);
        if (timestamp > position) {
          if (timestamp - position > pcm.sampleRate * 2) throw new Error("AUDIO_TIMESTAMP_GAP");
          peaks.add(
            Array.from(
              { length: config.numberOfChannels },
              () => new Float32Array(timestamp - position),
            ),
            pcm.sampleRate,
          );
          position = timestamp;
        }
        if (frames > skip) {
          peaks.add(
            pcm.channelData.map((channel) => channel.subarray(skip, frames)),
            pcm.sampleRate,
          );
          position += frames - skip;
        }
      }
      progress();
    }
    if (pending) {
      const count = pending.channelData[0]!.length - webmPadding;
      if (count < 0) throw new Error("OPUS_PADDING_INVALID");
      peaks.add(
        pending.channelData.map((channel) => channel.subarray(0, count)),
        pending.sampleRate,
      );
    }
  } finally {
    free?.();
    input.dispose();
  }
}
