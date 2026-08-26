'use client';

import type { AuditEntry } from '@/lib/types';
import { cx, dateTime, humanise } from '@/lib/format';
import { EmptyState } from './EmptyState';
import { SectionLabel } from './SectionLabel';

/**
 * The audit log.
 *
 * Every row names a human. That is the design position, not a formality: if an action can be
 * traced only to "the AI", nobody owns the outcome, and the first bad action ends the whole
 * programme. The assistant is credited as the originator on the same row, so accountability
 * survives without pretending a person composed it.
 *
 * Rejections are logged as loudly as confirmations. What staff decline is the highest-signal
 * training data an assistant like this ever gets, and throwing it away is a waste.
 */
export function AuditLog({ entries }: { entries: readonly AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No actions taken yet"
        description="Confirm or reject a proposed action and it will be recorded here, with the actor, the time, and the result."
      />
    );
  }

  return (
    <ol className="overflow-hidden rounded-club border border-rule bg-surface">
      {entries.map((entry) => (
        <li key={entry.id} className="border-b border-rule px-5 py-4 last:border-b-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={cx(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
                  entry.outcome === 'confirmed'
                    ? 'border-risk-low/45 text-risk-low'
                    : 'border-rule text-muted',
                )}
              >
                {entry.outcome}
              </span>
              <span className="text-[13px] font-medium text-ink">{entry.action.title}</span>
            </span>
            <span className="tnum text-[11px] text-faint">{dateTime(entry.at)}</span>
          </div>

          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            <span className="font-semibold text-ink">{entry.actor}</span>
            {' '}
            {entry.outcome === 'confirmed' ? 'confirmed' : 'rejected'}
            {' '}
            <span className="font-mono text-[11px]">{entry.action.kind}</span>
            {entry.originatedByAssistant ? (
              <>
                {' '}
                <span className="rounded border border-champagne/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-champagne-press">
                  assistant-originated
                </span>
              </>
            ) : null}
          </p>

          {entry.result ? (
            <p className="mt-2 border-l-2 border-rule pl-3 text-[12px] leading-relaxed text-ink">
              {entry.result}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function AuditLogHeading({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <SectionLabel>Audit log</SectionLabel>
      <span className="tnum text-[11px] text-faint">
        {count} entr{count === 1 ? 'y' : 'ies'} &middot; this browser tab only
      </span>
    </div>
  );
}
