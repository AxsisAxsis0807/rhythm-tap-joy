export type PreviewStatus =
  "idle" | "loading" | "ready" | "playing" | "paused" | "blocked" | "error" | "unavailable";

export interface PreviewSource {
  purpose?: "public-preview" | "owner-preview";
  /** Selection identity is distinct from the stable, shared audio asset identity. */
  selectionId: string;
  assetId: string;
  audioHash?: string;
  permissionAudioHash?: string;
  allowed: boolean;
  previewStartMs?: number | null;
  url?: string;
  expiresAt?: number | undefined;
  resolveUrl?: (signal: AbortSignal, refresh: boolean) => Promise<PreviewUrl>;
}

export interface PreviewUrl {
  url: string;
  /** Unix milliseconds, not AudioContext time. */
  expiresAt?: number | undefined;
}

export interface PreviewState {
  status: PreviewStatus;
  message: string | null;
  retryable: boolean;
}

export interface GameplayLease {
  ready: Promise<void>;
  isCurrent: () => boolean;
  release: () => void;
}

export class PreviewError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: "missing" | "expired" | "network" | "codec" | "position",
  ) {
    super(message);
    this.name = "PreviewError";
  }
}

interface MediaRecord {
  assetKey: string;
  element: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  gain: GainNode;
  url: PreviewUrl | null;
  pendingPlay: boolean;
}

const initialState: PreviewState = { status: "idle", message: null, retryable: false };
export const PREVIEW_DURATION_MS = 18000;
export type PreviewOwnerToken = symbol;
const abortError = () => new DOMException("Preview cancelled", "AbortError");
const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const assetKey = (source: PreviewSource) => `${source.assetId}:${source.audioHash ?? ""}`;
const selectionKey = (source: PreviewSource) =>
  `${source.selectionId}:${assetKey(source)}:${source.previewStartMs ?? 0}`;

/** One context, separate gains, and one owner for every asynchronous preview operation. */
export class AudioSessionController {
  private context: AudioContext | null = null;
  private media: MediaRecord | null = null;
  private source: PreviewSource | null = null;
  private selection = "";
  private state: PreviewState = initialState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private request: AbortController | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private ending: ReturnType<typeof setTimeout> | null = null;
  private lease = 0;
  private activeLease: number | null = null;
  private volume = 0.8 * 0.7 * 0.5;
  private manuallyPaused = false;
  private segmentStart = 0;
  private segmentEnd = 0;
  private position: number | null = null;
  private lifecycleAttached = false;
  private previewOwner: PreviewOwnerToken | null = null;
  private preciseSeek = false;

  constructor(
    private readonly createContext: () => AudioContext = () => {
      const AudioContextConstructor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      return new AudioContextConstructor();
    },
    private readonly createElement: () => HTMLAudioElement = () => new Audio(),
  ) {}

  getContext(): AudioContext {
    this.context ??= this.createContext();
    return this.context;
  }

  /** Call directly from a user gesture, before the caller's first await. */
  unlock(): Promise<void> {
    try {
      return this.getContext().resume();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  getSnapshot = (): PreviewState => this.state;
  getServerSnapshot = (): PreviewState => initialState;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(status: PreviewStatus, message: string | null = null, retryable = false) {
    this.state = { status, message, retryable };
    this.listeners.forEach((listener) => listener());
  }

  private attachLifecycle() {
    if (this.lifecycleAttached || typeof window === "undefined") return;
    this.lifecycleAttached = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
  }

  private onVisibility = () => {
    if (document.hidden) this.stopPreview(this.previewOwner ?? undefined);
  };
  private onPageHide = () => this.stopPreview(this.previewOwner ?? undefined);

  acquirePreviewOwner(ownerKey: string): PreviewOwnerToken {
    this.stopPreview(this.previewOwner ?? undefined);
    const token = Symbol(ownerKey);
    this.previewOwner = token;
    return token;
  }

  releasePreviewOwner(token: PreviewOwnerToken): void {
    if (this.previewOwner !== token) return;
    this.stopPreview(token);
    this.source = null;
    this.selection = "";
    this.previewOwner = null;
    this.publish("idle");
  }

  private ownsPreview(token?: PreviewOwnerToken): boolean {
    return this.previewOwner === null ? token === undefined : token === this.previewOwner;
  }

  updatePreviewSegment(token: PreviewOwnerToken, startMs: number | null): void {
    if (!this.ownsPreview(token) || !this.source) return;
    if (startMs !== null && (!Number.isSafeInteger(startMs) || startMs < 0))
      throw new PreviewError("Invalid preview position", false, "position");
    this.pause(token);
    this.source = { ...this.source, previewStartMs: startMs };
    this.selection = selectionKey(this.source);
    this.position = null;
    this.preciseSeek = true;
  }

  seekPreview(token: PreviewOwnerToken, timeMs: number): void {
    if (!this.ownsPreview(token) || !this.source) return;
    const start = this.source.previewStartMs ?? 0;
    const end = Math.min(
      start + PREVIEW_DURATION_MS,
      (this.media?.element.duration ?? Infinity) * 1000,
    );
    if (!Number.isFinite(timeMs) || timeMs < start || timeMs >= end)
      throw new PreviewError("Seek is outside preview interval", false, "position");
    const playing = this.state.status === "playing";
    this.pause(token);
    this.position = timeMs / 1000;
    this.preciseSeek = true;
    if (playing) this.play(token);
  }

  getPlaybackPosition(token: PreviewOwnerToken): number | null {
    if (!this.ownsPreview(token)) return null;
    return this.state.status === "playing" && this.media
      ? this.media.element.currentTime * 1000
      : this.position === null
        ? null
        : this.position * 1000;
  }

  setPreviewVolume(master: number, menu: number, preview: number): void {
    this.volume = unit(master) * unit(menu) * unit(preview);
    if (this.media && this.state.status === "playing") this.media.gain.gain.value = this.volume;
  }

  /** A metadata refresh with the same selection never overrides a manual pause. */
  selectPreview(
    source: PreviewSource | null,
    {
      autoPlay = false,
      userGesture = false,
      ownerToken,
    }: {
      autoPlay?: boolean;
      userGesture?: boolean;
      ownerToken?: PreviewOwnerToken;
    } = {},
  ): void {
    if (!this.ownsPreview(ownerToken)) return;
    this.attachLifecycle();
    const key = source ? selectionKey(source) : "";
    const changed = key !== this.selection;
    this.source = source;
    if (
      !source ||
      !source.allowed ||
      (source.audioHash && source.permissionAudioHash !== source.audioHash)
    ) {
      this.invalidate();
      this.selection = key;
      this.publish(
        source ? "unavailable" : "idle",
        source ? "試聴の利用許可が確認されていません。" : null,
      );
      return;
    }
    if (!changed) return;
    this.invalidate();
    this.selection = key;
    this.manuallyPaused = false;
    this.position = null;
    if (this.media?.assetKey !== assetKey(source)) this.removeMedia();
    this.publish("ready");
    // An explicit selection is required; rendering the initial list alone is silent.
    if (autoPlay && userGesture && this.activeLease === null) {
      const generation = this.generation;
      void this.unlock().catch((error: unknown) => {
        if (generation === this.generation) this.fail(error);
      });
      this.debounce = setTimeout(() => {
        this.debounce = null;
        if (generation === this.generation && !this.manuallyPaused) this.startPreview(false);
      }, 200);
    }
  }

  play = (token?: PreviewOwnerToken): void => {
    if (!this.ownsPreview(token)) return;
    if (!this.source || this.state.status === "unavailable" || this.activeLease !== null) return;
    this.manuallyPaused = false;
    this.startPreview(false);
  };

  replay = (token?: PreviewOwnerToken): void => {
    if (!this.ownsPreview(token)) return;
    this.position = null;
    this.preciseSeek = true;
    this.play(token);
  };

  retry = (token?: PreviewOwnerToken): void => {
    if (this.state.retryable || this.state.status === "blocked") this.play(token);
  };

  pause = (token?: PreviewOwnerToken): void => {
    if (!this.ownsPreview(token)) return;
    if (this.media && this.state.status === "playing")
      this.position = this.media.element.currentTime;
    this.manuallyPaused = true;
    this.invalidate();
    if (this.source && this.state.status !== "unavailable") this.publish("paused");
  };

  stopPreview = (token?: PreviewOwnerToken): void => {
    if (!this.ownsPreview(token)) return;
    this.manuallyPaused = true;
    this.position = null;
    this.invalidate();
    if (this.source && this.state.status !== "unavailable") this.publish("paused");
  };

  beginGameplay(): GameplayLease {
    this.stopPreview(this.previewOwner ?? undefined);
    this.previewOwner = null;
    const id = ++this.lease;
    this.activeLease = id;
    // A real AudioClock load has created the context. Keeping this lazy also supports SSR.
    const ready = this.context ? this.unlock() : Promise.resolve();
    return {
      ready,
      isCurrent: () => this.activeLease === id,
      release: () => {
        if (this.activeLease === id) this.activeLease = null;
      },
    };
  }

  private invalidate() {
    this.generation += 1;
    this.request?.abort();
    this.request = null;
    if (this.debounce) clearTimeout(this.debounce);
    if (this.ending) clearTimeout(this.ending);
    this.debounce = null;
    this.ending = null;
    if (this.media) {
      this.media.gain.gain.value = 0;
      this.media.element.pause();
      this.media.element.onended = null;
      this.media.element.ontimeupdate = null;
      this.media.element.onerror = null;
      // A pending play promise owns this element until it settles. Never reuse it
      // for a new generation, whose audio an old callback could otherwise stop.
      if (this.media.pendingPlay) this.removeMedia();
    }
  }

  private removeMedia() {
    if (!this.media) return;
    const media = this.media;
    this.media = null;
    media.gain.gain.value = 0;
    media.element.pause();
    media.element.onended = null;
    media.element.ontimeupdate = null;
    media.element.onerror = null;
    media.node.disconnect();
    media.gain.disconnect();
    media.element.removeAttribute("src");
    media.element.load();
  }

  private startPreview(refresh: boolean) {
    const source = this.source;
    if (!source || !source.allowed || this.activeLease !== null || document.hidden) return;
    // resume is invoked before asynchronous URL resolution and media loading.
    const unlocking = this.unlock();
    this.invalidate();
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    this.publish("loading");
    void this.runPreview(source, generation, request.signal, unlocking, refresh).catch(
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.invalidate();
        this.fail(error);
      },
    );
  }

  private current(generation: number, media?: MediaRecord) {
    return (
      generation === this.generation &&
      this.activeLease === null &&
      (!media || media === this.media)
    );
  }

  private async runPreview(
    source: PreviewSource,
    generation: number,
    signal: AbortSignal,
    unlocking: Promise<void>,
    refresh: boolean,
  ) {
    await unlocking;
    if (!this.current(generation)) return;
    let media = this.media;
    if (!media) {
      const context = this.getContext();
      const element = this.createElement();
      element.preload = "metadata";
      element.crossOrigin = "anonymous";
      element.loop = false;
      const node = context.createMediaElementSource(element);
      const gain = context.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(context.destination);
      media = { assetKey: assetKey(source), element, node, gain, url: null, pendingPlay: false };
      this.media = media;
    }
    const expired = (media.url?.expiresAt ?? source.expiresAt ?? Infinity) <= Date.now() + 30_000;
    let signed = media.url;
    if (!signed || expired || refresh) {
      if (source.resolveUrl) signed = await source.resolveUrl(signal, expired || refresh);
      else if (source.url && !expired) signed = { url: source.url, expiresAt: source.expiresAt };
      else
        throw new PreviewError(
          "音源URLの有効期限が切れています。曲を再読み込みしてください。",
          true,
          "expired",
        );
    }
    if (!this.current(generation, media)) return;
    if (!signed?.url) throw new PreviewError("試聴音源がありません。", false, "missing");
    const { element } = media;
    if (media.url?.url !== signed.url) {
      media.url = signed;
      element.src = signed.url;
      element.load();
    }
    try {
      await this.waitForMedia(
        media,
        "loadedmetadata",
        () => element.readyState >= 1,
        generation,
        signal,
      );
      if (!this.current(generation, media)) return;
      const start = (source.previewStartMs ?? 0) / 1000;
      if (
        !Number.isFinite(start) ||
        start < 0 ||
        !Number.isFinite(element.duration) ||
        start >= element.duration
      ) {
        throw new PreviewError(
          "試聴開始位置が音源の範囲外です。作者による再設定が必要です。",
          false,
          "position",
        );
      }
      this.segmentStart = start;
      this.segmentEnd = Math.min(start + PREVIEW_DURATION_MS / 1000, element.duration);
      const position =
        this.position !== null && this.position >= start && this.position < this.segmentEnd
          ? this.position
          : start;
      if (this.preciseSeek || Math.abs(element.currentTime - position) > 0.02) {
        this.preciseSeek = false;
        element.currentTime = position;
        await this.waitForMedia(media, "seeked", () => !element.seeking, generation, signal);
      }
      if (!this.current(generation, media)) return;
      media.pendingPlay = true;
      await element.play();
      media.pendingPlay = false;
      if (!this.current(generation, media)) {
        if (this.media !== media) element.pause();
        return;
      }
      media.gain.gain.value = this.volume;
      this.publish("playing");
      const finish = () => {
        if (!this.current(generation, media)) return;
        this.position = null;
        this.invalidate();
        this.publish("ready");
      };
      element.onended = finish;
      element.ontimeupdate = () => {
        if (this.current(generation, media) && element.currentTime >= this.segmentEnd) finish();
      };
      element.onerror = () => {
        if (!this.current(generation, media)) return;
        const error = this.mediaError(element);
        if (error.retryable && source.resolveUrl && !refresh) this.startPreview(true);
        else {
          this.invalidate();
          this.fail(error);
        }
      };
      // A timer only wakes the controller: stalled/buffering time is not audio time.
      const checkEnd = () => {
        if (!this.current(generation, media)) return;
        const remaining = this.segmentEnd - element.currentTime;
        if (remaining <= 0 || element.ended) finish();
        else this.ending = setTimeout(checkEnd, Math.max(20, Math.min(1000, remaining * 1000)));
      };
      this.ending = setTimeout(
        checkEnd,
        Math.max(20, Math.min(1000, (this.segmentEnd - element.currentTime) * 1000)),
      );
    } catch (error) {
      media.pendingPlay = false;
      if (!this.current(generation, media)) {
        if (this.media !== media) element.pause();
        return;
      }
      if (error instanceof PreviewError && error.retryable && source.resolveUrl && !refresh) {
        this.startPreview(true);
        return;
      }
      throw error;
    }
  }

  private waitForMedia(
    media: MediaRecord,
    event: "loadedmetadata" | "seeked",
    complete: () => boolean,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (complete()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        media.element.removeEventListener(event, ready);
        media.element.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
      };
      const ready = () => {
        cleanup();
        if (this.current(generation, media)) resolve();
        else reject(abortError());
      };
      const failed = () => {
        cleanup();
        reject(this.mediaError(media.element));
      };
      const aborted = () => {
        cleanup();
        reject(abortError());
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new PreviewError(
            "音源の読み込みがタイムアウトしました。再試聴できます。",
            true,
            "network",
          ),
        );
      }, 15_000);
      media.element.addEventListener(event, ready, { once: true });
      media.element.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }

  private mediaError(element: HTMLAudioElement): PreviewError {
    if (element.error?.code === 3 || element.error?.code === 4) {
      return new PreviewError(
        "この音源形式を再生できないか、配信元へのアクセスが許可されていません。",
        false,
        "codec",
      );
    }
    // Browsers deliberately do not expose HTTP status or distinguish CORS from network errors here.
    return new PreviewError(
      "音源を取得できませんでした。回線・配信設定を確認して再試聴してください。",
      true,
      "network",
    );
  }

  private fail(error: unknown) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      this.publish("blocked", "タップして試聴", true);
    } else if (error instanceof PreviewError) {
      this.publish("error", error.message, error.retryable);
    } else {
      this.publish(
        "error",
        error instanceof Error ? error.message : "試聴を開始できませんでした。",
        true,
      );
    }
  }

  /** Only the application session owner closes this context; AudioClock does not. */
  async dispose(): Promise<void> {
    this.invalidate();
    this.removeMedia();
    if (this.lifecycleAttached) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("pagehide", this.onPageHide);
      this.lifecycleAttached = false;
    }
    this.activeLease = null;
    this.previewOwner = null;
    this.source = null;
    this.selection = "";
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") await context.close();
    this.publish("idle");
  }
}

let session: AudioSessionController | null = null;
export function getAudioSession(): AudioSessionController {
  session ??= new AudioSessionController();
  return session;
}
