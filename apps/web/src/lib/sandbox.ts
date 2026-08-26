import { once } from './once';
import type { Evidence } from '@clubscope/core/tools';
import { evidenceFrom, recentWindow } from './club';
import { usd } from './format';

/**
 * Evidence for the live verifier sandbox.
 *
 * The sandbox lets a visitor rewrite a figure inside a real citation and watch the gate
 * refuse it. For that to prove anything, the citation has to point at evidence the verifier
 * will genuinely recompute — so this builds a small, fixed set of real tool calls and the
 * route handler verifies against exactly those. A mocked evidence map would make the demo a
 * puppet show.
 */
export const sandboxEvidence = once((): Evidence[] => {
  const { from, to } = recentWindow();
  return [
    evidenceFrom('revenue_total', { from, to }),
    evidenceFrom('dues_at_risk', { band: 'elevated' }),
    evidenceFrom('churn_cohort_size', { band: 'elevated' }),
    evidenceFrom('member_count', { status: 'active' }),
  ];
});

export const sandboxEvidenceMap = once(
  (): Map<string, Evidence> => new Map(sandboxEvidence().map((e) => [e.id, e])),
);

/**
 * Money written at a precision that round-trips.
 *
 * The verifier accepts a figure when the true value lies inside the interval that rounds to
 * it, so a whole-dollar total may be written whole and a fractional one may not. Formatting
 * to the value's own precision keeps the starter narrative honest instead of relying on the
 * dataset happening to hold integers.
 */
function exact(value: number): string {
  return Number.isInteger(value) ? usd(value) : usd(value, 2);
}

function scalar(evidence: Evidence): number {
  return evidence.value.kind === 'scalar' ? evidence.value.n : 0;
}

/**
 * The starter narrative, generated from live evidence so it passes when the page loads.
 * Editing a figure is what breaks it, which is the entire point.
 *
 * Written without a single digit outside a citation, and that constraint is the verifier's
 * doing rather than a stylistic choice: bare numerals in prose are reported as undeclared
 * and fail the whole narrative. A date range spelled `2026-06-03` would contribute three of
 * them. The rule is strict on purpose — a permissive exemption list for "obviously harmless"
 * numbers is exactly how a fabricated figure eventually walks through uncited.
 */
export const sandboxNarrative = once((): string => {
  const [revenue, dues] = sandboxEvidence();
  return (
    `Across the club's most recent quarter, total revenue came to ` +
    `[[e:${revenue.id}|${exact(scalar(revenue))}]] across every category, while ` +
    `[[e:${dues.id}|${exact(scalar(dues))}]] of annual dues sits with members the churn ` +
    `model scores elevated or worse.`
  );
});

/** Shown beside the sandbox so a visitor knows which ids are live. */
export const sandboxCatalogue = once(() =>
  sandboxEvidence().map((e) => ({
    id: e.id,
    tool: e.tool,
    version: e.toolVersion,
    value: e.value.kind === 'scalar' ? e.value.n : null,
    unit: e.unit,
  })),
);
