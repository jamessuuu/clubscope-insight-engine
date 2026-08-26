import type { VerificationReport } from './types';

/**
 * Figures the verifier refused, keyed so the renderer can strike exactly the right one.
 *
 * Keying on `evidenceId|written` rather than on evidence id alone matters: one evidence
 * record can legitimately be cited twice in a sentence at different precisions, and only the
 * citation that actually failed should be struck through. Blocking both would overstate the
 * catch, and a verifier demo that overstates its catches has lost the argument.
 *
 * Lives in its own module, free of any core import, so both the server pages and the
 * `'use client'` assistant panel can use the one implementation.
 */
export function blockedKeysOf(report: VerificationReport): Set<string> {
  const keys = new Set<string>();
  for (const check of report.checks) {
    if (check.outcome === 'match') continue;
    if (check.evidenceId) keys.add(`${check.evidenceId}|${check.written}`);
  }
  return keys;
}
