import type { ActionKind } from '../assistant/actions.js';
import type { Evidence } from '../tools/evidence.js';
import type { VerificationReport } from '../verify/verifier.js';

/**
 * An insight is a *detected* finding, not a generated one.
 *
 * The distinction is the whole design. Asking a model to "find something interesting in
 * this data" produces a different answer every run, cannot be tested, and quietly invents
 * trends on quiet weeks because it was asked for a finding and will supply one. Detection
 * is instead deterministic code with explicit thresholds: it either fires or it does not,
 * it fires for a stated reason, and it can be regression-tested against a fixture where the
 * right answer is known.
 *
 * The model's contribution is narration — turning a fired detector into two sentences a
 * general manager will actually read. That is a job models are genuinely good at, and its
 * failure mode is mere awkwardness rather than a fabricated trend.
 */

export type InsightKind =
  | 'churn'
  | 'revenue'
  | 'utilisation'
  | 'membership'
  | 'engagement';

export type InsightSeverity = 'critical' | 'elevated' | 'informational';

export interface SuggestedAction {
  kind: ActionKind;
  label: string;
  args: Record<string, unknown>;
}

export interface Insight {
  /** Stable across runs for the same dataset, so dismissals could persist in a real build. */
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** Short, scannable, and free of uncited figures. */
  headline: string;
  /** Prose with `[[e:id|figure]]` citations. Verified before render, like everything else. */
  narrative: string;
  /** The single most useful next step. */
  recommendation: string;
  evidence: Evidence[];
  verification: VerificationReport;
  /** Which detector fired, named so a reviewer can find it in the source. */
  detector: string;
  detectedAt: string;
  suggestedActions: SuggestedAction[];
}

export interface DetectorContext {
  /** Threshold configuration lives here so tuning is visible and testable, not inline. */
  now: string;
}
