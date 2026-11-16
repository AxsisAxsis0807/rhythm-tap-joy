import type { CompletedPlay } from "./types";

/** Check both envelopes; stale/tampered top-level flags cannot admit BOTPLAY. */
export function canSaveCompetitiveResult(result: CompletedPlay): boolean {
  return (
    result.competitive !== false &&
    result.configuration?.competitive !== false &&
    result.configuration?.autoplay !== true
  );
}
