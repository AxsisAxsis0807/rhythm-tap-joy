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

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying() {
    return this.playing;
  }

  async load(url: string): Promise<void> {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx ??= new Ctx();
    const res = await fetch(url);
    const bytes = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(bytes);
  }

  /** Start playback; `delay` seconds of lead-in before time 0 of the song. */
  async start(delay = 0): Promise<void> {
    if (!this.ctx || !this.buffer) throw new Error("Audio not loaded");
    await this.ctx.resume();
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    src.start(this.ctx.currentTime + delay);
    this.source = src;
    this.startedAt = this.ctx.currentTime + delay;
    this.startOffset = 0;
    this.playing = true;
    src.onended = () => {
      this.playing = false;
    };
  }

  stop(): void {
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
    return this.ctx.currentTime - this.startedAt + this.startOffset;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
