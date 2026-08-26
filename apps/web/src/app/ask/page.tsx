import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { ReceiptProvider } from '@/components/ReceiptProvider';
import { SectionLabel } from '@/components/SectionLabel';
import { club } from '@/lib/club';
import { shortDate } from '@/lib/format';
import { suggestedTurns } from '@/lib/turns';
import { AskClient } from './AskClient';

export const metadata: Metadata = {
  title: 'Ask ClubScope — Insight Engine',
};

export default function AskPage() {
  const ds = club();
  const chips = suggestedTurns().map((turn) => ({
    id: turn.id,
    question: turn.question,
    topic: turn.topic,
  }));

  return (
    <ReceiptProvider evidence={[]}>
      <PageHeader
        eyebrow="Ask ClubScope"
        title="Answers with their working shown"
        lede={
          <>
            The assistant selects typed analysis tools, reads what they return, and writes a
            sentence around the result. It never produces a figure itself. Data covers{' '}
            {shortDate(ds.club.dataFrom)} to {shortDate(ds.club.dataTo)} — ask outside that and
            it declines.
          </>
        }
      />

      <section
        aria-labelledby="honesty-heading"
        className="mt-8 rounded-club border border-rule bg-parchment px-6 py-5"
      >
        <SectionLabel id="honesty-heading" as="h2">
          What is real on this page, and what is not
        </SectionLabel>
        <dl className="mt-4 grid gap-x-8 gap-y-4 text-[13px] leading-relaxed md:grid-cols-3">
          <div>
            <dt className="font-semibold text-ink">Real, every press</dt>
            <dd className="mt-1 text-muted">
              Tool calls execute against the dataset, evidence records are computed fresh, and
              the verifier recomputes every cited figure before the answer renders.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Not real</dt>
            <dd className="mt-1 text-muted">
              The wording. With no <code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code>{' '}
              configured, which tools to call and how to phrase the answer are replayed from a
              recorded transcript rather than chosen by a model.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Why it is disclosed here</dt>
            <dd className="mt-1 text-muted">
              A reviewer who finds an undisclosed limitation stops believing the disclosed
              parts too. With a key set, the identical pipeline runs with Claude driving, under
              the same citation contract.{' '}
              <Link href="/how-it-works" className="text-navy underline underline-offset-2">
                The contract
              </Link>
              .
            </dd>
          </div>
        </dl>
      </section>

      <AskClient turns={chips} />
    </ReceiptProvider>
  );
}
