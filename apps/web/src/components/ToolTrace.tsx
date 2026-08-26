'use client';

import type { ToolCallRecord } from '@/lib/types';
import { cx, num } from '@/lib/format';
import { useReceipts } from './ReceiptProvider';

function paramSummary(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return 'no arguments';
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
}

/**
 * The tool-call trace.
 *
 * Collapsed by default because a general manager wants the answer, and open in one keystroke
 * because the person deciding whether to buy this wants the mechanism. `<details>` rather
 * than a hand-rolled disclosure: it is keyboard-operable, screen-reader-announced and
 * findable by in-page search even while closed, all of which a div with an onClick is not.
 */
export function ToolTrace({
  calls,
  totalMs,
  servedBy,
}: {
  calls: readonly ToolCallRecord[];
  totalMs?: number;
  servedBy?: string;
}) {
  const { open, has } = useReceipts();

  if (calls.length === 0) return null;

  return (
    <details className="group rounded-club border border-rule bg-surface-sunk">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 text-[12px] font-semibold uppercase tracking-[0.11em] text-muted transition-colors hover:text-ink">
        <span className="flex items-center gap-2">
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5 transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            <path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Tool trace
        </span>
        <span className="tnum font-medium normal-case tracking-normal text-faint">
          {calls.length} call{calls.length === 1 ? '' : 's'}
          {totalMs === undefined ? '' : ` · ${num(totalMs)}ms total`}
          {servedBy ? ` · ${servedBy}` : ''}
        </span>
      </summary>

      <ol className="border-t border-rule">
        {calls.map((call, i) => (
          <li
            key={`${call.name}-${i}`}
            className="grid grid-cols-[20px_1fr] gap-3 border-b border-rule/70 px-5 py-3.5 last:border-b-0"
          >
            <span className="tnum pt-0.5 text-[11px] text-faint">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-mono text-[12.5px] font-semibold text-ink">{call.name}</span>
                <span className="tnum text-[11px] text-muted">{call.ms}ms</span>
              </div>
              <p className="mt-1 break-words font-mono text-[11.5px] leading-relaxed text-muted">
                {paramSummary(call.params)}
              </p>
              <div className="mt-1.5 text-[11px]">
                {call.ok ? (
                  call.evidenceId ? (
                    has(call.evidenceId) ? (
                      <button
                        type="button"
                        onClick={() => open(call.evidenceId as string)}
                        aria-haspopup="dialog"
                        className="font-mono text-navy underline underline-offset-2 transition-colors hover:text-ink"
                      >
                        evidence {call.evidenceId}
                      </button>
                    ) : (
                      <span className="font-mono text-faint">evidence {call.evidenceId}</span>
                    )
                  ) : (
                    <span className="text-muted">proposal recorded, nothing executed</span>
                  )
                ) : (
                  <span className={cx('text-negative')}>failed: {call.error ?? 'unknown error'}</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
