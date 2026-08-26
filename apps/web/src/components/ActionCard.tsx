'use client';

import type { ProposedAction } from '@/lib/types';
import { cx, humanise } from '@/lib/format';
import { SectionLabel } from './SectionLabel';

const IMPACT_STYLE: Record<string, string> = {
  low: 'border-rule text-muted',
  medium: 'border-risk-watch/50 text-risk-watch',
  high: 'border-risk-critical/50 text-risk-critical',
};

const IMPACT_NOTE: Record<string, string> = {
  low: 'Reversible: creates an internal record only.',
  medium: 'Drafts member-facing content. A human still sends it.',
  high: 'Touches a member record and is visible to committee.',
};

export type ActionState = 'pending' | 'confirmed' | 'rejected';

/**
 * A proposed action, awaiting a human.
 *
 * The impact badge grades by *reversibility*, not by how impressive the action sounds, and
 * the note under it says what that grade means in practice. Confirmation friction that does
 * not track real consequence trains people to click through it, which is how an assistant
 * with actions eventually does something nobody meant.
 */
export function ActionCard({
  action,
  state,
  busy,
  onConfirm,
  onReject,
}: {
  action: ProposedAction;
  state: ActionState;
  busy?: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const settled = state !== 'pending';

  return (
    <article
      className={cx(
        'rounded-club border bg-surface p-5',
        state === 'confirmed'
          ? 'border-risk-low/45'
          : state === 'rejected'
            ? 'border-rule opacity-70'
            : 'border-champagne/55',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel as="p">Proposed action &middot; {humanise(action.kind)}</SectionLabel>
          <h3 className="mt-2 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">
            {action.title}
          </h3>
        </div>
        <span
          className={cx(
            'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.11em]',
            IMPACT_STYLE[action.impact] ?? IMPACT_STYLE.low,
          )}
        >
          {action.impact} impact
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">{action.rationale}</p>

      <dl className="mt-4 border-t border-rule pt-3 text-[12px]">
        {Object.entries(action.args).map(([key, value]) => (
          <div key={key} className="grid grid-cols-[92px_1fr] gap-3 py-1.5">
            <dt className="font-mono text-[11px] text-faint">{key}</dt>
            <dd className="break-words text-ink">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        {IMPACT_NOTE[action.impact] ?? IMPACT_NOTE.low}
      </p>

      {settled ? (
        <p
          className={cx(
            'mt-4 border-t border-rule pt-4 text-[12px] font-medium',
            state === 'confirmed' ? 'text-risk-low' : 'text-muted',
          )}
        >
          {state === 'confirmed'
            ? 'Confirmed by you. Recorded in the audit log below.'
            : 'Rejected by you. The refusal is recorded too.'}
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md border border-champagne bg-champagne px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-champagne-hover disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="rounded-md border border-rule bg-surface px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:border-ink/25 hover:text-ink disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}
