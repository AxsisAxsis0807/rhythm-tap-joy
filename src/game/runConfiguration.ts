import { DEFAULT_SCORE_RULES, DEFAULT_WINDOWS } from "./config";
import { policyForStyle } from "./judgementPolicy";
import type { JudgementPolicyId, PlayStyleId } from "./judgementPolicy";
import type { VisualModeId } from "./modes";
import type { Chart, JudgementWindows, ScoreRules } from "./types";

export const CHART_PARSER_VERSION = "pulse-chart-v1";
export const SCORE_RULES_VERSION = "pulse-score-v1";
export const INPUT_POLICY_VERSION = "pulse-input-v1";

export interface RunOptions {
  playStyle?: PlayStyleId;
  visualMode?: VisualModeId;
  revisionId?: string | null;
  chartParserVersion?: string;
  timingOffsetMs?: number;
  practice?: boolean;
  autoplay?: boolean;
  assist?: boolean;
  rate?: number;
  competitive?: boolean;
  windows?: JudgementWindows;
  scoreRules?: ScoreRules;
}

/** One immutable interpretation of a run, retained through RESULT and RETRY. */
export interface RunConfiguration {
  readonly songId: string;
  readonly revisionId: string | null;
  readonly scoringSide: "left" | "right" | "shared";
  readonly playStyle: PlayStyleId;
  readonly visualMode: VisualModeId;
  readonly judgementPolicyId: JudgementPolicyId;
  readonly judgementPolicyVersion: 1;
  readonly chartParserVersion: string;
  readonly scoreRulesVersion: typeof SCORE_RULES_VERSION;
  readonly inputPolicyVersion: typeof INPUT_POLICY_VERSION;
  /** XP rule version is held in the server session snapshot; this client field grants no eligibility. */
  readonly xpRuleVersion: null;
  readonly timingOffsetMs: number;
  readonly practice: boolean;
  readonly autoplay: boolean;
  readonly assist: boolean;
  readonly rate: number;
  readonly competitive: boolean;
  readonly windows: Readonly<JudgementWindows>;
  readonly scoreRules: Readonly<ScoreRules>;
}

export function createRunConfiguration(chart: Chart, options: RunOptions = {}): RunConfiguration {
  const playStyle = options.playStyle ?? "mania";
  const timingOffsetMs = options.timingOffsetMs ?? 0;
  const rate = options.rate ?? 1;
  if (!Number.isFinite(timingOffsetMs) || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Invalid run timing configuration");
  }
  const scoreRules = options.scoreRules ?? DEFAULT_SCORE_RULES;
  return Object.freeze({
    songId: chart.id,
    revisionId: options.revisionId ?? chart.revisionId ?? null,
    scoringSide: chart.fnf?.playerSide ?? "shared",
    playStyle,
    visualMode: options.visualMode ?? playStyle,
    judgementPolicyId: policyForStyle(playStyle),
    judgementPolicyVersion: 1,
    chartParserVersion:
      options.chartParserVersion ?? chart.chartParserVersion ?? CHART_PARSER_VERSION,
    scoreRulesVersion: SCORE_RULES_VERSION,
    inputPolicyVersion: INPUT_POLICY_VERSION,
    xpRuleVersion: null,
    timingOffsetMs,
    practice: options.practice === true,
    autoplay: options.autoplay === true,
    assist: options.assist === true,
    rate,
    competitive:
      options.competitive !== false &&
      !options.practice &&
      !options.autoplay &&
      !options.assist &&
      rate === 1,
    windows: Object.freeze({ ...(options.windows ?? DEFAULT_WINDOWS) }),
    scoreRules: Object.freeze({ ...scoreRules, base: Object.freeze({ ...scoreRules.base }) }),
  });
}
