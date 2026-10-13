import type { JudgementWindows } from "./types";

export type PlayStyleId = "mania" | "fnf";
export type JudgementPolicyId = "pulse-mania-v1" | "pulse-fnf-v1";

/** A nanosecond only absorbs subtraction error at documented millisecond boundaries. */
export const TIMING_EPSILON = 1e-9;

export function policyForStyle(style: PlayStyleId): JudgementPolicyId {
  return style === "fnf" ? "pulse-fnf-v1" : "pulse-mania-v1";
}

/** Filter candidates before choosing the nearest; ignored FNF inputs consume nothing. */
export function acceptsCandidate(
  delta: number,
  windows: JudgementWindows,
  policy: JudgementPolicyId,
): boolean {
  return policy !== "pulse-fnf-v1" || delta >= -windows.good - TIMING_EPSILON;
}
