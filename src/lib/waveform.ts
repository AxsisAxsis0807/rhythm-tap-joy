export const WAVEFORM_VERSION = "pulse-peaks-10ms-v1";
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_MS = 7200000;
export type WaveformPeaks = {
  version: typeof WAVEFORM_VERSION;
  durationMs: number;
  sampleRate: number;
  minMax: Int16Array;
};
/** All channels contribute independently; opposite-phase stereo never cancels. */
export class PeaksAccumulator {
  private peaks = new Int16Array((MAX_AUDIO_MS / 10) * 2);
  private samples = 0;
  private rate = 0;
  private currentBin = -1;
  add(channels: Float32Array[], sampleRate: number) {
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 192000 ||
      (this.rate && this.rate !== sampleRate) ||
      !channels.length ||
      channels.length > 8
    )
      throw new Error("UNSUPPORTED_AUDIO_FORMAT");
    const frames = channels[0]!.length;
    if (channels.some((channel) => channel.length !== frames))
      throw new Error("AUDIO_DECODE_MISMATCH");
    this.rate = sampleRate;
    if (((this.samples + frames) * 1000) / sampleRate > MAX_AUDIO_MS)
      throw new Error("AUDIO_TOO_LONG");
    for (let i = 0; i < frames; i++) {
      const bin = Math.floor(((this.samples + i) * 100) / sampleRate) * 2;
      if (bin !== this.currentBin) {
        this.peaks[bin] = 32767;
        this.peaks[bin + 1] = -32768;
        this.currentBin = bin;
      }
      for (const channel of channels) {
        const sample = channel[i]!;
        if (!Number.isFinite(sample)) throw new Error("AUDIO_DECODE_INVALID");
        const value = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
        this.peaks[bin] = Math.min(this.peaks[bin]!, value);
        this.peaks[bin + 1] = Math.max(this.peaks[bin + 1]!, value);
      }
    }
    this.samples += frames;
  }
  get durationMs() {
    return this.rate ? Math.floor((this.samples * 1000) / this.rate) : 0;
  }
  finish(): WaveformPeaks {
    if (!this.durationMs) throw new Error("AUDIO_EMPTY");
    return {
      version: WAVEFORM_VERSION,
      durationMs: this.durationMs,
      sampleRate: this.rate,
      minMax: this.peaks.slice(0, Math.ceil((this.samples * 100) / this.rate) * 2),
    };
  }
}
export function waveformCacheKey(scope: string, hash: string) {
  return `${scope}:${hash}:${WAVEFORM_VERSION}`;
}
/** Draw work is bounded by physical canvas width, including overview levels. */
export function waveformColumns(
  peaks: WaveformPeaks,
  startMs: number,
  endMs: number,
  width: number,
) {
  const columns = new Int16Array(Math.max(0, Math.floor(width)) * 2);
  for (let x = 0; x < columns.length / 2; x++) {
    const first = Math.max(
      0,
      Math.floor((startMs + ((endMs - startMs) * x) / (columns.length / 2)) / 10),
    );
    const last = Math.min(
      peaks.minMax.length / 2,
      Math.ceil((startMs + ((endMs - startMs) * (x + 1)) / (columns.length / 2)) / 10),
    );
    if (last > first) {
      columns[x * 2] = 32767;
      columns[x * 2 + 1] = -32768;
    }
    for (let i = first; i < last; i++) {
      columns[x * 2] = Math.min(columns[x * 2]!, peaks.minMax[i * 2]!);
      columns[x * 2 + 1] = Math.max(columns[x * 2 + 1]!, peaks.minMax[i * 2 + 1]!);
    }
  }
  return columns;
}
