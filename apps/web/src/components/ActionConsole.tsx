'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { SuggestedAction } from '@/lib/types';
import { useActionLedger } from '@/lib/use-action-ledger';
import { ActionCard } from './ActionCard';
import { AuditLog, AuditLogHeading } from './AuditLog';
import { SectionLabel } from './SectionLabel';

interface ConsoleApi {
  propose: (suggestion: SuggestedAction, rationale: string) => void;
  pendingLabel: string | null;
}

const ConsoleContext = createContext<ConsoleApi | null>(null);

/**
 * The acting half of the assistant, docked beneath the feed.
 *
 * An insight that ends at "you should probably call them" is a report. The value only
 * appears when the next step is one click away — and the reason it is a *proposal* one click
 * away rather than an action already taken is that the model chose the arguments, and a
 * model that misreads a question should cost a human ten seconds of reading, not a
 * misdirected letter to a member.
 */
export function ActionConsole({ children }: { children: ReactNode }) {
  const ledger = useActionLedger();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const api = useMemo<ConsoleApi>(
    () => ({
      pendingLabel,
      propose: (suggestion, rationale) => {
        setPendingLabel(suggestion.label);
        void ledger
          .proposeSuggestion(suggestion, rationale)
          .finally(() => setPendingLabel(null));
      },
    }),
    [ledger, pendingLabel],
  );

  const open = ledger.proposals.filter((p) => ledger.stateOf(p.id) === 'pending');

  return (
    <ConsoleContext.Provider value={api}>
      {children}

      {ledger.proposals.length === 0 && ledger.audit.length === 0 ? null : (
        <section aria-labelledby="action-console" className="mt-14 scroll-mt-24">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
            <SectionLabel id="action-console">Staged actions</SectionLabel>
            <span className="tnum text-[11px] text-faint">
              {open.length} awaiting confirmation &middot; nothing executes without you
            </span>
          </div>

          {ledger.proposals.length > 0 ? (
            <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
              {ledger.proposals.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  state={ledger.stateOf(action.id)}
                  busy={ledger.busyId === action.id}
                  onConfirm={() => void ledger.confirm(action)}
                  onReject={() => void ledger.reject(action)}
                />
              ))}
            </div>
          ) : null}

          {ledger.audit.length > 0 ? (
            <div className="mt-10">
              <AuditLogHeading count={ledger.audit.length} />
              <div className="mt-4">
                <AuditLog entries={ledger.audit} />
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                This log lives in your browser tab and disappears when you close it. Nothing is
                written to a server, no message is sent, and no member record is touched.
              </p>
            </div>
          ) : null}
        </section>
      )}
    </ConsoleContext.Provider>
  );
}

/**
 * The suggested next steps attached to an insight.
 *
 * Rendered as quiet outline buttons rather than filled champagne: on a feed of eight cards,
 * sixteen gold buttons would be the loudest thing on the page, and the loudest thing on this
 * page should be the finding.
 */
export function SuggestedActions({
  actions,
  rationale,
}: {
  actions: readonly SuggestedAction[];
  rationale: string;
}) {
  const ctx = useContext(ConsoleContext);
  if (!ctx || actions.length === 0) return null;

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => ctx.propose(action, rationale)}
          disabled={ctx.pendingLabel === action.label}
          className="rounded-md border border-rule bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-champagne hover:bg-parchment disabled:opacity-50"
        >
          {ctx.pendingLabel === action.label ? 'Staging…' : action.label}
        </button>
      ))}
    </div>
  );
}
