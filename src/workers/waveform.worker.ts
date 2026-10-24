/// <reference lib="webworker" />
import { analyzeAudioStream } from "@/lib/audioAnalysis";
import { signedAudioRanges } from "@/lib/audioRange";
const scope = self as unknown as DedicatedWorkerGlobalScope;
let current: AbortController | null = null;
scope.onmessage = (
  event: MessageEvent<
    { id: string; url: string; hash: string; durationMs: number } | { cancel: true }
  >,
) => {
  current?.abort();
  if ("cancel" in event.data) return;
  const input = event.data,
    controller = new AbortController();
  current = controller;
  void (async () => {
    const response = await fetch(input.url, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });
    if (!response.ok || !response.body) throw new Error("AUDIO_UNAVAILABLE");
    const result = await analyzeAudioStream(
      response.body,
      controller.signal,
      (generatedMs) => {
        if (current === controller)
          scope.postMessage({ id: input.id, type: "progress", generatedMs });
      },
      async (size) => signedAudioRanges(input.url, size, controller.signal),
    );
    if (
      result.audioHash !== input.hash ||
      Math.abs(result.waveform.durationMs - input.durationMs) > 20
    )
      throw new Error("WAVEFORM_SOURCE_MISMATCH");
    if (current === controller)
      scope.postMessage({ id: input.id, type: "ready", peaks: result.waveform }, [
        result.waveform.minMax.buffer,
      ]);
  })().catch((error: unknown) => {
    if (current === controller && !controller.signal.aborted)
      scope.postMessage({
        id: input.id,
        type: "error",
        code: error instanceof Error ? error.message : "WAVEFORM_ERROR",
      });
  });
};
