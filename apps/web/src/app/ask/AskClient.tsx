'use client';

import { useState } from 'react';
import { runTurnAction } from '@/app/actions';
import { ActionCard } from '@/components/ActionCard';
import { AuditLog, AuditLogHeading } from '@/components/AuditLog';
import { EmptyState } from '@/components/EmptyState';
import { Narrative } from '@/components/EvidenceChip';
import { useReceipts } from '@/components/ReceiptProvider';
import { SectionLabel } from '@/components/SectionLabel';
import { ToolTrace } from '@/components/ToolTrace';
import { VerificationBadge } from '@/components/VerificationBadge';
import { cx, num } from '@/lib/format';
import { blockedKeysOf } from '@/lib/blocked';
import { useActionLedger } from '@/lib/use-action-ledger';
import type { TurnPayload } from '@/lib/types';

export interface TurnChip {
  id: string;
  question: string;
  topic: string;
}

/**
 * The assistant surface.
 *
 * Suggested questions rather than a free text box, and that is a disclosure rather than a
 * shortcut: with no model key configured there is no model to parse an arbitrary question,
 * and a text input that silently only understood five sentences would be the single most
 * dishonest thing this prototype could ship. The chips are the truth about what replay mode
 * can do. Everything downstream of the question — tool selection, execution, verification —
 * is the same code path a live model drives.
 */
export function AskClient({ turns }: { turns: readonly TurnChip[] }) {
  const { register } = useReceipts();
  const ledger = useActionLedger();
  const [turn, setTurn] = useState<TurnPayload | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (id: string) => {
    setPendingId(id);
    setError(null);
    try {
      const payload = await runTurnAction(id);
      if (!payload) {
        setError('That question is not in the recorded transcript set.');
        return;
      }
      register(payload.evidence);
      ledger.reset();
      ledger.addProposals(payload.proposedActions);
      setTurn(payload);
    } catch {
      setError('The turn failed to run. Reload the page and try again.');
    } finally {
      setPendingId(null);
    }
  };

  const blocked = turn ? blockedKeysOf(turn.verification) : new Set<string>();

  return (
    <div className="mt-8">
      <section aria-labelledby="suggested-heading">
        <SectionLabel id="suggested-heading">Suggested questions</SectionLabel>
        <ul className="mt-4 flex flex-wrap gap-2.5">
          {turns.map((chip) => {
            const active = turn?.turnId === chip.id;
            return (
              <li key={chip.id}>
                <button
                  type="button"
                  onClick={() => void ask(chip.id)}
                  disabled={pendingId !== null}
                  aria-pressed={active}
                  className={cx(
                    'rounded-md border px-3.5 py-2 text-left text-[13px] leading-snug transition-colors disabled:opacity-60',
                    active
                      ? 'border-champagne bg-parchment text-ink'
                      : 'border-rule bg-surface text-ink hover:border-champagne hover:bg-parchment',
                  )}
                >
                  {pendingId === chip.id ? 'Running…' : chip.question}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {error ? (
        <p role="alert" className="mt-6 rounded-club border border-negative/40 bg-negative/8 px-5 py-4 text-[13px] text-negative">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="answer-heading" aria-live="polite" className="mt-10">
        <SectionLabel id="answer-heading" className="sr-only">
          Answer
        </SectionLabel>

        {turn === null ? (
          <EmptyState
            title="Pick a question to run it"
            description="The tool calls execute against the dataset on every press, the figures are computed fresh, and the groundedness verifier runs the full recomputation pass before anything reaches this panel."
          />
        ) : (
          <article className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <SectionLabel as="p">{turn.topic}</SectionLabel>
                <h2 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink">
                  {turn.question}
                </h2>
              </div>
              <VerificationBadge report={turn.verification} />
            </div>

            <div className="mt-5">
              <Narrative segments={turn.segments} blockedKeys={blocked} />
            </div>

            {turn.refusal ? (
              <p className="mt-5 rounded-club border border-rule bg-surface-sunk px-4 py-3 text-[12.5px] leading-relaxed text-muted">
                <span className="font-semibold text-ink">This is a deliberate refusal.</span> The
                question asks for something outside the dataset&rsquo;s coverage. Declining is the
                correct answer, and the eval suite scores it as a pass.
              </p>
            ) : null}

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule pt-5 sm:grid-cols-4">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted">
                  Figures cited
                </dt>
                <dd className="tnum mt-1.5 text-[17px] font-semibold text-ink">
                  {num(turn.verification.citedCount)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted">
                  Recomputed
                </dt>
                <dd className="tnum mt-1.5 text-[17px] font-semibold text-ink">
                  {num(turn.verification.recomputedCount)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted">
                  Grounded
                </dt>
                <dd className="tnum mt-1.5 text-[17px] font-semibold text-ink">
                  {num(turn.verification.groundedRate * 100, 0)}%
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted">
                  Turn time
                </dt>
                <dd className="tnum mt-1.5 text-[17px] font-semibold text-ink">{turn.totalMs}ms</dd>
              </div>
            </dl>

            <div className="mt-6">
              <ToolTrace calls={turn.toolCalls} totalMs={turn.totalMs} servedBy={turn.servedBy} />
            </div>
          </article>
        )}
      </section>

      {ledger.proposals.length > 0 ? (
        <section aria-labelledby="proposals-heading" className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
            <SectionLabel id="proposals-heading">Proposed actions</SectionLabel>
            <span className="text-[11px] text-faint">
              Composed by the assistant &middot; executed by nobody until you say so
            </span>
          </div>
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
        </section>
      ) : null}

      <section aria-label="Audit log" className="mt-12">
        <AuditLogHeading count={ledger.audit.length} />
        <div className="mt-4">
          <AuditLog entries={ledger.audit} />
        </div>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-muted">
          <span className="font-semibold text-ink">State here is client-side only.</span> This log
          lives in React state in this browser tab and vanishes when you close it. No task is
          created, no message is sent, and no member record is touched anywhere. The entries
          themselves are built by the same action definitions a real deployment would run — the
          only thing this prototype throws away is the persistence.
        </p>
      </section>
    </div>
  );
}
