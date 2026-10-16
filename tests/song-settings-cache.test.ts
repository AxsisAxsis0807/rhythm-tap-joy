import { expect, it } from "vitest";
import {
  readWaveformCache,
  writeWaveformCache,
  releasePrivateWaveforms,
} from "@/lib/waveformCache";
import { WAVEFORM_VERSION, type WaveformPeaks } from "@/lib/waveform";
const peaks = (bytes = 4): WaveformPeaks => ({
  version: WAVEFORM_VERSION,
  durationMs: (bytes / 4) * 10,
  sampleRate: 48000,
  minMax: new Int16Array(bytes / 2),
});
it("IDB unavailable still caches, isolates owners/hashes, and releases private references", async () => {
  await writeWaveformCache("owner:a", peaks());
  expect(await readWaveformCache("owner:a")).not.toBeNull();
  expect(await readWaveformCache("other:a")).toBeNull();
  expect(await readWaveformCache("owner:b")).toBeNull();
  releasePrivateWaveforms("owner");
  expect(await readWaveformCache("owner:a")).toBeNull();
});
it("memory LRU evicts old peaks at the 32 MiB bound", async () => {
  const bytes = 2880000;
  for (let i = 0; i < 11; i++) await writeWaveformCache("budget:" + i, peaks(bytes));
  await readWaveformCache("budget:0");
  await writeWaveformCache("budget:new", peaks(bytes));
  expect(await readWaveformCache("budget:1")).toBeNull();
  expect(await readWaveformCache("budget:0")).not.toBeNull();
  expect(await readWaveformCache("budget:new")).not.toBeNull();
  releasePrivateWaveforms("budget");
});
