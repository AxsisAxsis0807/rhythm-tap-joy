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

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying() {
    return this.playing;
  }

  async load(url: string): Promise<void> {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx ??= new Ctx();
    this.gain ??= this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    const res = await fetch(url);
    const bytes = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(bytes);
  }

  /** Start playback; `delay` seconds of lead-in before time 0 of the song. */
  async start(delay = 0, offset = 0, playbackRate = this.rate): Promise<void> {
    if (!this.ctx || !this.buffer) throw new Error("Audio not loaded");
    await this.ctx.resume();
    this.stop();
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
      this.playing = false;
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

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
