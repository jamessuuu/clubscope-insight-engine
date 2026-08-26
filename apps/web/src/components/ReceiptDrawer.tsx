'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Evidence, RecomputeResult } from '@/lib/types';
import { cx, dateTime, num, usd } from '@/lib/format';
import { SectionLabel } from './SectionLabel';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function formatScalar(value: number, unit: string): string {
  if (unit === 'usd') return usd(value);
  if (unit === 'percent') return `${num(value, 2)}%`;
  return num(value, Number.isInteger(value) ? 0 : 2);
}

function storedValue(evidence: Evidence): string {
  const { value, unit } = evidence.value.kind === 'scalar' ? { value: evidence.value.n, unit: evidence.unit } : { value: null, unit: evidence.unit };
  if (value === null) {
    return evidence.value.kind === 'text' ? evidence.value.s : `${evidence.value.kind} result`;
  }
  return formatScalar(value, unit);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-4 border-b border-rule py-3 last:border-b-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="text-[13px] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

type RecomputeState =
  | { phase: 'running' }
  | { phase: 'done'; result: RecomputeResult }
  | { phase: 'error'; detail: string };

/**
 * The receipt.
 *
 * This panel is the argument of the whole prototype rendered as one surface: a figure, the
 * exact tool and version that produced it, the parameters it was called with, the method in
 * plain English, the count and identity of the source rows, and the result of running the
 * whole computation again — right now, because you asked, not at build time.
 *
 * Recomputing on open rather than up front is what lets the panel say "just now" and mean
 * it. It also keeps the cost proportional to curiosity: the churn tools rescore every member
 * on the roll, and eagerly re-deriving forty receipts nobody opened put seconds onto a page
 * load in exchange for nothing.
 *
 * Accessibility here is not decoration. It is a modal dialog, so it announces itself as one,
 * traps Tab, closes on Escape and returns focus to the chip that opened it. That is also
 * simply the fastest way to use a panel people open dozens of times in a sitting.
 */
export function ReceiptDrawer({
  evidence,
  onClose,
}: {
  evidence: Evidence | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<Element | null>(null);
  const [state, setState] = useState<RecomputeState>({ phase: 'running' });

  const open = evidence !== null;
  const evidenceId = evidence?.id ?? null;

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = document.activeElement;
    closeRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restore = restoreRef.current;
      if (restore instanceof HTMLElement) restore.focus();
    };
  }, [open, onKeyDown]);

  useEffect(() => {
    if (!evidence) return undefined;

    // A drawer closed mid-flight must not overwrite the next one's result.
    let live = true;
    setState({ phase: 'running' });

    void fetch('/api/receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: evidence.tool,
        toolVersion: evidence.toolVersion,
        params: evidence.params,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`endpoint returned ${response.status}`);
        return (await response.json()) as { result: RecomputeResult };
      })
      .then((data) => {
        if (live) setState({ phase: 'done', result: data.result });
      })
      .catch((err: Error) => {
        if (live) setState({ phase: 'error', detail: err.message });
      });

    return () => {
      live = false;
    };
  }, [evidence, evidenceId]);

  if (!evidence) return null;

  const sampleRows = evidence.rowIds.slice(0, 14);
  const stored = evidence.value.kind === 'scalar' ? evidence.value.n : null;
  const fresh = state.phase === 'done' && state.result.ok ? state.result.value : null;
  const agrees =
    state.phase === 'done' && state.result.ok && (stored === null || fresh === null || fresh === stored);
  const clean = state.phase === 'running' || agrees;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[540px] flex-col border-l border-rule bg-surface shadow-[0_0_60px_rgba(19,19,19,0.22)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-5">
          <div>
            <SectionLabel as="p">Evidence receipt</SectionLabel>
            <h2
              id="receipt-title"
              className="mt-2 text-[19px] font-semibold tracking-[-0.01em] text-ink"
            >
              {evidence.tool}
            </h2>
            <p className="mt-1 font-mono text-[11px] text-faint">
              {evidence.id} &middot; v{evidence.toolVersion}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-md p-2 text-muted transition-colors hover:bg-surface-sunk hover:text-ink"
          >
            <span className="sr-only">Close receipt</span>
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="rounded-club border border-rule bg-surface-sunk px-5 py-4">
            <SectionLabel as="p">Value as reported</SectionLabel>
            <p className="tnum mt-2 text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink">
              {storedValue(evidence)}
            </p>
            <p className="mt-2 text-[12px] text-muted">
              unit: {evidence.unit} &middot; derived from{' '}
              <span className="tnum font-medium text-ink">{num(evidence.rowCount)}</span>{' '}
              source {evidence.rowCount === 1 ? 'row' : 'rows'}
            </p>
          </div>

          <div
            aria-live="polite"
            className={cx(
              'mt-4 rounded-club border px-5 py-4',
              clean ? 'border-risk-low/40 bg-risk-low/8' : 'border-negative/40 bg-negative/8',
            )}
          >
            <SectionLabel as="p" className={clean ? 'text-risk-low' : 'text-negative'}>
              {state.phase === 'running' ? 'Recomputing from source' : 'Recomputed just now'}
            </SectionLabel>

            {state.phase === 'running' ? (
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Re-running {evidence.tool} against the dataset&hellip;
              </p>
            ) : state.phase === 'error' ? (
              <p className="mt-2 text-[13px] leading-relaxed text-negative">
                Could not reach the recomputation endpoint ({state.detail}). The figure above is
                the value the tool returned when the page was produced; it has not been
                re-derived.
              </p>
            ) : state.result.ok ? (
              <>
                <p className="mt-2 text-[13px] leading-relaxed text-ink">
                  {state.result.value === null ? null : (
                    <span className="tnum mr-2 font-semibold">
                      {formatScalar(state.result.value, evidence.unit)}
                    </span>
                  )}
                  {state.result.detail}{' '}
                  <span className={cx('font-semibold', agrees ? 'text-risk-low' : 'text-negative')}>
                    {agrees
                      ? 'Identical result.'
                      : 'This disagrees with the figure above, so it is not safe to use.'}
                  </span>
                </p>
                <p className="tnum mt-2 text-[11px] text-muted">took {state.result.ms}ms</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-[13px] leading-relaxed text-negative">
                  {state.result.detail}
                </p>
                <p className="tnum mt-2 text-[11px] text-muted">took {state.result.ms}ms</p>
              </>
            )}
          </div>

          <dl className="mt-5">
            <Row label="Method">{evidence.method}</Row>
            <Row label="Parameters">
              {Object.keys(evidence.params).length === 0 ? (
                <span className="text-muted">none, this tool takes no arguments</span>
              ) : (
                <ul className="space-y-1">
                  {Object.entries(evidence.params).map(([key, value]) => (
                    <li key={key} className="font-mono text-[12px]">
                      <span className="text-muted">{key}</span>
                      <span className="text-faint"> = </span>
                      <span className="text-ink">{JSON.stringify(value) ?? 'undefined'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            <Row label="Computed">{dateTime(evidence.computedAt)}</Row>
            <Row label="Source rows">
              <p className="tnum">
                {num(evidence.rowCount)} rows consumed
                {evidence.rowIds.length < evidence.rowCount
                  ? `, showing the first ${num(evidence.rowIds.length)} ids`
                  : ''}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {sampleRows.map((id) => (
                  <li
                    key={id}
                    className="rounded border border-rule bg-surface-sunk px-1.5 py-0.5 font-mono text-[11px] text-muted"
                  >
                    {id}
                  </li>
                ))}
                {evidence.rowIds.length > sampleRows.length ? (
                  <li className="px-1.5 py-0.5 text-[11px] text-faint">
                    +{num(evidence.rowIds.length - sampleRows.length)} more
                  </li>
                ) : null}
              </ul>
            </Row>
          </dl>

          <p className="mt-6 border-t border-rule pt-4 text-[12px] leading-relaxed text-muted">
            This figure was produced by a pure TypeScript function over the dataset, not by a
            language model. The model&rsquo;s only role is choosing which tool to call and how
            to phrase the sentence around the result.
          </p>
        </div>
      </div>
    </div>
  );
}
