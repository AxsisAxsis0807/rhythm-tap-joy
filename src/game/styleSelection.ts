import type { PlayStyleId } from "./types";

export function resolvePlayStyle(
  explicit: PlayStyleId | undefined,
  recommended: PlayStyleId | null | undefined,
  lastPlayed: PlayStyleId | null,
): PlayStyleId {
  return explicit ?? recommended ?? lastPlayed ?? "mania";
}
