// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { setAacModule } from "@/lib/codecs/aacDecoder";
setAacModule(new WebAssembly.Module(readFileSync("src/lib/codecs/aac.wasm")));
import { analyzeAudioStream } from "@/lib/audioAnalysis";
const fixture = (extension: string) =>
  new Uint8Array(readFileSync(`tests/fixtures/song-settings/impulse.${extension}`));
const stream = (bytes: Uint8Array) => {
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (pos >= bytes.length) c.close();
      else {
        c.enqueue(bytes.subarray(pos, pos + 257));
        pos += 257;
      }
    },
  });
};
for (const extension of ["wav", "mp3", "ogg", "opus", "m4a", "webm"])
  it(`streaming ${extension} retains the known impulse and codec delay/preskip`, async () => {
    const bytes = fixture(extension);
    const result = await analyzeAudioStream(
      stream(bytes),
      new AbortController().signal,
      undefined,
      async () => ({ size: bytes.length, read: async (start, end) => bytes.slice(start, end) }),
    );
    expect(result.waveform.durationMs).toBeGreaterThanOrEqual(1120);
    expect(result.waveform.durationMs).toBeLessThanOrEqual(1130);
    let strongest = 0;
    for (let i = 0; i < result.waveform.minMax.length / 2; i++)
      if (result.waveform.minMax[i * 2 + 1]! > result.waveform.minMax[strongest * 2 + 1]!)
        strongest = i;
    expect(strongest * 10).toBeGreaterThanOrEqual(490);
    expect(strongest * 10).toBeLessThanOrEqual(510);
  });
