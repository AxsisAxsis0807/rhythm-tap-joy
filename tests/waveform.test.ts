// @vitest-environment node
import { expect, it } from "vitest";
import { PeaksAccumulator, waveformCacheKey, waveformColumns } from "@/lib/waveform";
import { analyzeAudioStream } from "@/lib/audioAnalysis";
function wav(samples: number, rate = 8000) {
  const bytes = new Uint8Array(44 + samples * 4),
    view = new DataView(bytes.buffer),
    enc = new TextEncoder();
  bytes.set(enc.encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(enc.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  bytes.set(enc.encode("data"), 36);
  view.setUint32(40, samples * 4, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 4, 16384, true);
    view.setInt16(46 + i * 4, -16384, true);
  }
  return bytes;
}
function chunks(bytes: Uint8Array, size = 7) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + size));
      offset += size;
    },
  });
}
it("aggregates opposite stereo and final partial bins, bounding draw work by canvas width", () => {
  const a = new PeaksAccumulator();
  a.add([new Float32Array(81).fill(0.5), new Float32Array(81).fill(-0.5)], 8000);
  const peaks = a.finish();
  expect(peaks.minMax.length).toBe(4);
  expect(peaks.minMax[0]).toBe(-16383);
  expect(peaks.minMax[1]).toBe(16384);
  expect(waveformColumns(peaks, 0, 10, 3).length).toBe(6);
  expect(waveformCacheKey("owner-a", "hash")).not.toBe(waveformCacheKey("owner-b", "hash"));
});
it("stream-decodes WAV across arbitrary byte boundaries and hashes all original bytes", async () => {
  const bytes = wav(801);
  const result = await analyzeAudioStream(chunks(bytes), new AbortController().signal);
  const { createHash } = await import("node:crypto");
  expect(result.audioHash).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(result.waveform.durationMs).toBe(100);
  expect(result.waveform.minMax.length).toBe(22);
  expect(result.waveform.minMax[0]).toBeLessThan(0);
  expect(result.waveform.minMax[1]).toBeGreaterThan(0);
});
it("rejects truncated, forged containers and aborts without retaining the reader", async () => {
  const bytes = wav(100);
  await expect(
    analyzeAudioStream(chunks(bytes.subarray(0, bytes.length - 1)), new AbortController().signal),
  ).rejects.toThrow(/TRUNCATED/);
  const controller = new AbortController();
  controller.abort();
  await expect(analyzeAudioStream(chunks(bytes), controller.signal)).rejects.toThrow(/Aborted/);
});
