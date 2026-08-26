'use client';

import { useState } from 'react';
import { SectionLabel } from '@/components/SectionLabel';
import { cx, num } from '@/lib/format';
import type { VerificationReport } from '@/lib/types';

export interface SandboxEvidenceRow {
  id: string;
  tool: string;
  version: string;
  value: number | null;
  unit: string;
}

const OUTCOME_COPY: Record<string, string> = {
  match: 'recomputed and matched',
  mismatch: 'blocked: the narrative and the source disagree',
  'unknown-evidence': 'blocked: cites an evidence id no tool ever produced',
  'recompute-failed': 'blocked: the tool could not be re-executed',
  'unsupported-shape': 'blocked: the citation payload is not a parseable figure',
  undeclared: 'blocked: a figure appears in prose with no citation',
};

/**
 * The verifier, with the safety off.
 *
 * Everything else on this page is the system marking its own homework. This is the one place
 * a visitor gets to attack it: change any digit inside a real citation, press Verify, and
 * watch the same gate that guards the insight feed refuse the sentence. It runs against the
 * live evidence records listed beneath it, so there is no rigged path where a "wrong" number
 * is detected by string comparison against a stored answer — the tool is genuinely re-run.
 */
export function VerifierSandbox({
  initialNarrative,
  evidence,
}: {
  initialNarrative: string;
  evidence: readonly SandboxEvidenceRow[];
}) {
  const [narrative, setNarrative] = useState(initialNarrative);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ narrative }),
      });
      if (!response.ok) {
        setError(`The verifier endpoint returned ${response.status}.`);
        return;
      }
      const data = (await response.json()) as { report: VerificationReport };
      setReport(data.report);
    } catch {
      setError('Could not reach the verifier endpoint.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <label
          htmlFor="sandbox-narrative"
          className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted"
        >
          Narrative with citations
        </label>
        <textarea
          id="sandbox-narrative"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-describedby="sandbox-help"
          className="mt-2 w-full rounded-club border border-rule bg-surface p-4 font-mono text-[12.5px] leading-relaxed text-ink"
        />
        <p id="sandbox-help" className="mt-2 text-[12px] leading-relaxed text-muted">
          Citations are written{' '}
          <code className="font-mono text-[11.5px] text-ink">[[e:evidenceId|figure]]</code>. Change
          the figure inside one — a digit, a magnitude, anything — and press Verify. Numbers
          typed outside a citation are caught too, as undeclared.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void verify()}
            disabled={busy}
            className="rounded-md border border-champagne bg-champagne px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-champagne-hover disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => {
              setNarrative(initialNarrative);
              setReport(null);
              setError(null);
            }}
            className="rounded-md border border-rule bg-surface px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:border-ink/25 hover:text-ink"
          >
            Reset
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-[13px] text-negative">
            {error}
          </p>
        ) : null}

        <div aria-live="polite" className="mt-6">
          {report === null ? (
            <p className="text-[13px] text-faint">
              No verdict yet. Press Verify to run the gate over this sentence.
            </p>
          ) : (
            <div
              className={cx(
                'rounded-club border p-5',
                report.status === 'verified'
                  ? 'border-risk-low/45 bg-risk-low/6'
                  : 'border-negative/45 bg-negative/6',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p
                  className={cx(
                    'text-[15px] font-semibold uppercase tracking-[0.09em]',
                    report.status === 'verified' ? 'text-risk-low' : 'text-negative',
                  )}
                >
                  {report.status === 'verified' ? 'Verified' : 'Blocked'}
                </p>
                <p className="tnum text-[12px] text-muted">
                  {num(report.recomputedCount)} recomputation
                  {report.recomputedCount === 1 ? '' : 's'} &middot; {report.durationMs}ms &middot;{' '}
                  {num(report.groundedRate * 100, 0)}% grounded
                </p>
              </div>

              {report.checks.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">
                  Nothing numeric to check. A sentence with no figures passes trivially, which is
                  the correct behaviour and not a very interesting one.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {report.checks.map((check, i) => (
                    <li
                      key={`${check.written}-${i}`}
                      className="border-l-2 pl-3"
                      style={{
                        borderColor:
                          check.outcome === 'match'
                            ? 'var(--color-risk-low)'
                            : 'var(--color-negative)',
                      }}
                    >
                      <p className="text-[13px] text-ink">
                        <span
                          className={cx(
                            'tnum font-semibold',
                            check.outcome === 'match' ? '' : 'line-through decoration-negative',
                          )}
                        >
                          {check.written}
                        </span>
                        <span className="ml-2 text-muted">
                          {OUTCOME_COPY[check.outcome] ?? check.outcome}
                        </span>
                      </p>
                      {check.detail ? (
                        <p className="mt-1 text-[12px] leading-relaxed text-muted">{check.detail}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-club border border-rule bg-surface-sunk p-5">
        <SectionLabel as="h3">Live evidence ids</SectionLabel>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Computed on this request. Cite any of these; invent one and the verifier says so.
        </p>
        <ul className="mt-4 space-y-3.5">
          {evidence.map((row) => (
            <li key={row.id} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
              <p className="font-mono text-[11px] text-ink">{row.id}</p>
              <p className="mt-1 text-[11.5px] text-muted">
                {row.tool}@{row.version}
              </p>
              <p className="tnum mt-0.5 text-[11.5px] text-faint">
                {row.value === null ? 'non-scalar' : num(row.value, 0)} {row.unit}
              </p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
