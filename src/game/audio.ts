import { inputTime } from "./input";
/**
 * Audio clock built on the Web Audio API.
 * The song position is derived from AudioContext.currentTime (sample-accurate),
 * never from requestAnimationFrame counting, so notes stay in sync.
 */
export class AudioClock {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private startOffset = 0;
  private playing = false;
  private gain: GainNode | null = null;
  private rate = 1;
  private generation = 0;
  private loadController: AbortController | null = null;
  private readonly ownsContext: boolean;

  constructor(private readonly context?: AudioContext | (() => AudioContext)) {
    this.ownsContext = !context;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying() {
    return this.playing;
  }

  async load(url: string): Promise<void> {
    const generation = ++this.generation;
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx ??= typeof this.context === "function" ? this.context() : (this.context ?? new Ctx());
    if (!this.gain) {
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    const ctx = this.ctx;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Audio download failed (${res.status})`);
    const bytes = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    if (generation !== this.generation || this.ctx !== ctx) {
      throw new DOMException("Audio load cancelled", "AbortError");
    }
    this.buffer = buffer;
  }

  /** Start playback; `delay` seconds of lead-in before time 0 of the song. */
  async start(delay = 0, offset = 0, playbackRate = this.rate): Promise<void> {
    if (!this.ctx || !this.buffer) throw new Error("Audio not loaded");
    this.stop();
    const generation = this.generation;
    const ctx = this.ctx;
    await ctx.resume();
    if (generation !== this.generation || this.ctx !== ctx) {
      throw new DOMException("Audio start cancelled", "AbortError");
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = playbackRate;
    src.connect(this.gain!);
    src.start(this.ctx.currentTime + delay, Math.max(0, offset));
    this.source = src;
    this.startedAt = this.ctx.currentTime + delay;
    this.startOffset = Math.max(0, offset);
    this.rate = playbackRate;
    this.playing = true;
    src.onended = () => {
      if (this.source === src) this.playing = false;
    };
  }

  async pause(): Promise<number> {
    const position = this.now();
    this.stop();
    return position;
  }

  async resume(position: number, delay = 0): Promise<void> {
    await this.start(delay, position, this.rate);
  }

  setVolume(value: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, value));
  }

  playHit(volume: number): void {
    if (!this.ctx || volume <= 0) return;
    const oscillator = this.ctx.createOscillator();
    const hitGain = this.ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 920;
    hitGain.gain.setValueAtTime(Math.min(0.18, volume * 0.18), this.ctx.currentTime);
    hitGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.045);
    oscillator.connect(hitGain).connect(this.ctx.destination);
    oscillator.start();
    oscillator.stop(this.ctx.currentTime + 0.05);
  }

  stop(): void {
    this.generation += 1;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  /** Current song time in seconds (negative during the lead-in). */
  now(): number {
    if (!this.ctx) return 0;
    return (this.ctx.currentTime - this.startedAt) * this.rate + this.startOffset;
  }

  /** Map the DOM edge time to the existing audio timeline, independent of paint delay. */
  nowAt(stamp?: number): number {
    const now = performance.now();
    return this.now() - ((now - inputTime(stamp, now)) / 1000) * this.rate;
  }

  dispose(): void {
    this.stop();
    this.loadController?.abort();
    this.loadController = null;
    this.gain?.disconnect();
    this.gain = null;
    this.buffer = null;
    if (this.ownsContext) void this.ctx?.close();
    this.ctx = null;
  }
}
