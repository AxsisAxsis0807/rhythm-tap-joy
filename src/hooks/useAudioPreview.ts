import { useEffect, useSyncExternalStore } from "react";
import { getAudioSession, type PreviewSource } from "@/game/audioSession";

export interface AudioPreviewOptions {
  autoPreview: boolean;
  masterVolume: number;
  menuVolume: number;
  previewVolume: number;
  /** True only when a user selected this song, after the event handler called unlock(). */
  explicitSelection?: boolean;
}

export function useAudioPreview(source: PreviewSource | null, options: AudioPreviewOptions) {
  const controller = getAudioSession();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useEffect(() => {
    controller.selectPreview(source, {
      autoPlay: options.autoPreview,
      userGesture: options.explicitSelection === true,
    });
  }, [controller, source, options.autoPreview, options.explicitSelection]);
  useEffect(() => {
    controller.setPreviewVolume(options.masterVolume, options.menuVolume, options.previewVolume);
  }, [controller, options.masterVolume, options.menuVolume, options.previewVolume]);
  useEffect(() => () => controller.stopPreview(), [controller]);
  return {
    state,
    play: controller.play,
    pause: controller.pause,
    replay: controller.replay,
    retry: controller.retry,
  };
}
