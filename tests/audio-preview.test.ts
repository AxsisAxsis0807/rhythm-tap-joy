import { afterEach, it, expect, vi } from "vitest";
import { AudioSessionController, type PreviewSource } from "@/game/audioSession";
class Media extends EventTarget {
  currentTime = 0;
  duration = 60;
  readyState = 1;
  seeking = false;
  src = "";
  preload = "";
  crossOrigin = "";
  loop = false;
  error = null;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
}
const controllers: AudioSessionController[] = [];
afterEach(async () => {
  for (const c of controllers) await c.dispose();
  controllers.length = 0;
  vi.useRealTimers();
});
function setup() {
  const media: Media[] = [];
  const gains: {
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const context = {
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    state: "running",
    destination: {},
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createGain: vi.fn(() => {
      const g = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    }),
  };
  const controller = new AudioSessionController(
    () => context as unknown as AudioContext,
    () => {
      const m = new Media();
      media.push(m);
      return m as unknown as HTMLAudioElement;
    },
  );
  controllers.push(controller);
  return { controller, context, media, gains };
}
const source = (id: string): PreviewSource => ({
  selectionId: id,
  assetId: id,
  url: `/${id}.ogg`,
  allowed: true,
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
it("only the latest asset plays when earlier signing completes last", async () => {
  const { controller, media } = setup();
  let resolve!: (x: { url: string }) => void;
  controller.selectPreview({
    ...source("a"),
    resolveUrl: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  controller.play();
  await settle();
  controller.selectPreview(source("b"));
  controller.play();
  await settle();
  controller.selectPreview(source("c"));
  controller.play();
  await settle();
  resolve({ url: "/late-a.ogg" });
  await settle();
  expect(media[0]?.play).not.toHaveBeenCalled();
  expect(media.at(-1)?.src).toBe("/c.ogg");
  expect(controller.getSnapshot().status).toBe("playing");
});
it("START invalidates pending play promises; old completion cannot pause next media", async () => {
  const { controller, media, gains } = setup();
  controller.selectPreview(source("a"));
  controller.play();
  await settle();
  controller.pause();
  let finish!: () => void;
  media[0]!.play.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  controller.play();
  await settle();
  const lease = controller.beginGameplay();
  await lease.ready;
  finish();
  await settle();
  expect(controller.getSnapshot().status).not.toBe("playing");
  expect(gains.every((g) => g.gain.value === 0)).toBe(true);
  lease.release();
  controller.selectPreview(source("c"));
  controller.play();
  await settle();
  expect(media.at(-1)?.src).toBe("/c.ogg");
});
it("manual pause survives metadata refresh; gain uses all three controls and reuses one source", async () => {
  const { controller, context, gains } = setup();
  controller.selectPreview(source("same"));
  controller.setPreviewVolume(0.8, 0.5, 0.25);
  controller.play();
  await settle();
  expect(gains[0]?.gain.value).toBeCloseTo(0.1);
  controller.pause();
  controller.selectPreview({ ...source("same") }, { autoPlay: true, userGesture: true });
  await settle();
  expect(controller.getSnapshot().status).toBe("paused");
  controller.play();
  await settle();
  expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
});
it("18-second preview stops without looping, and no permission creates no context", async () => {
  vi.useFakeTimers();
  const { controller, context, media } = setup();
  controller.selectPreview(
    { ...source("denied"), allowed: false },
    { autoPlay: true, userGesture: true },
  );
  expect(context.resume).not.toHaveBeenCalled();
  controller.selectPreview(source("allowed"));
  controller.play();
  await settle();
  media[0]!.currentTime = 18;
  await vi.advanceTimersByTimeAsync(18000);
  expect(controller.getSnapshot().status).toBe("ready");
  expect(media[0]?.loop).toBe(false);
});

it("buffering wall time does not consume the preview interval", async () => {
  vi.useFakeTimers();
  const { controller, media } = setup();
  controller.selectPreview(source("buffering"));
  controller.play();
  await settle();
  await vi.advanceTimersByTimeAsync(20000);
  expect(controller.getSnapshot().status).toBe("playing");
  media[0]!.currentTime = 18;
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().status).toBe("ready");
});
it("an editor lease rejects stale cleanup and applies a 1ms seek without reloading audio", async () => {
  const { controller, media, context } = setup();
  const first = controller.acquirePreviewOwner("first");
  const token = controller.acquirePreviewOwner("second");
  controller.selectPreview(source("editor"), { ownerToken: token });
  controller.play(token);
  await settle();
  controller.stopPreview();
  controller.releasePreviewOwner(first);
  controller.selectPreview(null);
  expect(controller.getSnapshot().status).toBe("playing");
  controller.updatePreviewSegment(token, 1);
  controller.play(token);
  await settle();
  expect(media[0]!.currentTime).toBe(0.001);
  expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
  expect(media[0]!.load).toHaveBeenCalledTimes(1);
  controller.releasePreviewOwner(token);
  expect(controller.getSnapshot().status).toBe("idle");
});
