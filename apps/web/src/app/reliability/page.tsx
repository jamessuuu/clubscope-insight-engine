import type { Metadata } from 'next';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { Narrative } from '@/components/EvidenceChip';
import { PageHeader } from '@/components/PageHeader';
import { ReceiptProvider } from '@/components/ReceiptProvider';
import { SectionLabel } from '@/components/SectionLabel';
import { StatCard } from '@/components/StatCard';
import { ToolTrace } from '@/components/ToolTrace';
import { VerificationBadge } from '@/components/VerificationBadge';
import { blockedKeysOf } from '@/lib/blocked';
import { cx, num } from '@/lib/format';
import { sandboxCatalogue, sandboxNarrative } from '@/lib/sandbox';
import { allTurnResults, poisonedResult, reliabilitySummary, type TurnResult } from '@/lib/turns';
import { VerifierSandbox } from './VerifierSandbox';

export const metadata: Metadata = {
  title: 'Reliability — ClubScope Insight Engine',
};

/**
 * Prerendered, and the copy says so.
 *
 * Running the whole suite costs about four seconds — fifteen turns, and the churn tools
 * rescore every member on the roll on each call. Per-request rendering would have bought a
 * present-tense verb at the price of four seconds of blank screen for the one visitor this
 * page exists to convince.
 *
 * The live proof does not depend on this page's render mode, and that is the point: the
 * sandbox at the bottom runs the verifier on whatever the visitor types, and every chip on
 * the page re-derives its figure on demand. Both hit the same code that produced these
 * results. A reader who suspects the table is decorative has two ways to find out inside
 * thirty seconds.
 */

function CaseVerdict({ result }: { result: TurnResult }) {
  const { turn, payload } = result;

  if (turn.poison) {
    const caught = payload.status === 'blocked';
    return (
      <span className={cx('text-[12px] font-semibold', caught ? 'text-risk-low' : 'text-negative')}>
        {caught ? 'Fabrication blocked' : 'FABRICATION MISSED'}
      </span>
    );
  }

  if (turn.refusal) {
    const correct = payload.status === 'answered';
    return (
      <span className={cx('text-[12px] font-semibold', correct ? 'text-risk-low' : 'text-negative')}>
        {correct ? 'Refused correctly' : 'Refusal contaminated'}
      </span>
    );
  }

  return (
    <span
      className={cx(
        'text-[12px] font-semibold',
        payload.status === 'answered' ? 'text-risk-low' : 'text-negative',
      )}
    >
      {payload.status === 'answered' ? 'Answered, verified' : 'Blocked'}
    </span>
  );
}

export default function ReliabilityPage() {
  const started = Date.now();
  const results = allTurnResults();
  const summary = reliabilitySummary(results);
  const poisoned = poisonedResult(results);
  const wallMs = Date.now() - started;

  const evidence = results.flatMap((r) => r.payload.evidence);
  const catalogue = sandboxCatalogue();

  const columns: ReadonlyArray<Column<TurnResult>> = [
    {
      key: 'question',
      header: 'Case',
      render: ({ turn }) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-ink">{turn.question}</span>
          <span className="text-[11px] uppercase tracking-[0.1em] text-faint">
            {turn.topic}
            {turn.refusal ? ' · negative control' : ''}
            {turn.poison ? ' · poisoned' : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'tools',
      header: 'Tools called',
      render: ({ payload }) =>
        payload.toolCalls.length === 0 ? (
          <span className="text-faint">none</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {payload.toolCalls.map((call, i) => (
              <span
                key={`${call.name}-${i}`}
                className="rounded border border-rule bg-surface-sunk px-1.5 py-0.5 font-mono text-[11px] text-muted"
              >
                {call.name}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'figures',
      header: 'Figures cited',
      align: 'right',
      render: ({ payload }) => (
        <span className="tnum text-ink">
          {num(payload.verification.matchedCount)}
          <span className="text-faint"> / {num(payload.verification.citedCount)}</span>
        </span>
      ),
    },
    {
      key: 'verification',
      header: 'Verification',
      render: ({ payload }) => <VerificationBadge report={payload.verification} detail={false} />,
    },
    {
      key: 'verdict',
      header: 'Verdict',
      render: (result) => <CaseVerdict result={result} />,
    },
  ];

  return (
    <ReceiptProvider evidence={evidence}>
      <PageHeader
        eyebrow="Reliability"
        title="The claims, executed rather than asserted"
        lede={
          <>
            Every scripted case below was executed in full to produce this page: tools called
            against the dataset, figures computed, the groundedness verifier run over each
            narrative, {num(wallMs)}ms end to end. Nothing is a stored score. Click any figure
            to re-derive it on demand, or take the sandbox at the bottom and try to get a
            fabricated number past the gate.
          </>
        }
      />

      <section aria-labelledby="metrics-heading" className="mt-8">
        <h2 id="metrics-heading" className="sr-only">
          Headline reliability metrics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Figures verified"
            value={<span className="tnum">{num(summary.figuresVerified)}</span>}
            sub={`${num(summary.figuresBlocked)} blocked across ${num(summary.cases)} cases.`}
            footnote="Each one recomputed from source, not compared to a cached value"
          />
          <StatCard
            label="Groundedness rate"
            value={<span className="tnum">{num(summary.groundedRate * 100, 1)}%</span>}
            sub="Share of cited figures that survived recomputation."
            footnote="A poisoned case is included deliberately, so 100% would be the wrong answer"
          />
          <StatCard
            label="Refusals correct"
            value={
              <span className="tnum">
                {num(summary.refusalsCorrect)}
                <span className="text-faint"> / {num(summary.refusalCases)}</span>
              </span>
            }
            sub="Out-of-coverage questions declined without inventing a figure."
            footnote="Declining while smuggling in an uncited number scores as a failure"
          />
          <StatCard
            label="Recomputations"
            value={<span className="tnum">{num(summary.recomputations)}</span>}
            sub="Tool re-executions performed to produce this page."
            footnote="Plus one per receipt, run again when you open a chip"
          />
        </div>
      </section>

      {poisoned ? (
        <section aria-labelledby="poison-heading" className="mt-14">
          <div className="border-b border-rule pb-4">
            <SectionLabel id="poison-heading">The poisoned case</SectionLabel>
            <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">
              One case in the suite has a fabricated figure injected into the narrative on
              purpose — the tools return the truth, and the number written into the prose is
              multiplied before it reaches the verifier. This is the exact failure that occurs
              in production: the model calls the right tools, receives the right numbers, and
              then writes a different one. It is silent, it survives review because the sentence
              reads well, and it is the reason club managers stop trusting an insight feed.
            </p>
          </div>

          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <article className="card border-negative/40 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <SectionLabel as="p" className="text-negative">
                    Blocked before render
                  </SectionLabel>
                  <h3 className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.015em] text-ink">
                    {poisoned.turn.question}
                  </h3>
                </div>
                <VerificationBadge report={poisoned.payload.verification} />
              </div>

              <div className="mt-5 rounded-club border border-rule bg-surface-sunk p-5">
                <Narrative
                  segments={poisoned.payload.segments}
                  blockedKeys={blockedKeysOf(poisoned.payload.verification)}
                />
              </div>

              <div className="mt-5">
                <ToolTrace
                  calls={poisoned.payload.toolCalls}
                  totalMs={poisoned.payload.totalMs}
                  servedBy={poisoned.payload.servedBy}
                />
              </div>
            </article>

            <div className="space-y-5">
              <div className="card border-negative/40 p-5">
                <SectionLabel as="h3" className="text-negative">
                  What the verifier said
                </SectionLabel>
                <ul className="mt-4 space-y-4">
                  {poisoned.payload.verification.checks
                    .filter((check) => check.outcome !== 'match')
                    .map((check, i) => (
                      <li key={`${check.written}-${i}`}>
                        <p className="text-[13px]">
                          <span className="tnum font-semibold text-negative line-through decoration-negative">
                            {check.written}
                          </span>
                          <span className="ml-2 text-[11px] uppercase tracking-[0.1em] text-muted">
                            {check.outcome}
                          </span>
                        </p>
                        {check.actual === undefined ? null : (
                          <p className="tnum mt-1 text-[13px] text-ink">
                            source computes{' '}
                            <span className="font-semibold">{num(check.actual, 0)}</span>
                          </p>
                        )}
                        {check.detail ? (
                          <p className="mt-1 text-[12px] leading-relaxed text-muted">
                            {check.detail}
                          </p>
                        ) : null}
                        {check.evidenceId ? (
                          <p className="mt-1 font-mono text-[11px] text-faint">
                            evidence {check.evidenceId}
                          </p>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>

              <div className="card p-5">
                <SectionLabel as="h3">What this proves</SectionLabel>
                <ul className="mt-4 space-y-3 text-[12.5px] leading-relaxed text-muted">
                  <li>
                    <span className="font-semibold text-ink">The gate is real.</span> The number
                    is not compared against a stored expectation; the tool is re-executed from
                    the parameters on its own evidence record, and the result disagrees.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">It fails closed.</span> A blocked
                    narrative does not render as an answer. There is no code path where an
                    unverified figure reaches a manager because the sentence read fluently.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">It is specific.</span> The
                    verifier names the figure, the evidence id and the true value, so the
                    failure is debuggable rather than a red banner.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">It is rounding-aware.</span> This
                    case is caught on substance, not on formatting — the same gate accepts
                    &ldquo;$381k&rdquo; for 381,204, because rejecting honest rounding would
                    just train the writing toward unreadable prose.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="mt-14">
          <EmptyState
            title="No poisoned case is present in the current suite"
            description="The featured demonstration needs a scripted turn carrying a poison directive. Without one there is nothing honest to show here, so nothing is shown."
          />
        </section>
      )}

      <section aria-labelledby="cases-heading" className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
          <SectionLabel id="cases-heading">Every case in the suite</SectionLabel>
          <span className="text-[11px] text-faint">
            {num(summary.cases)} cases &middot; {num(summary.refusalCases)} negative controls
            &middot; {num(summary.poisonedCases)} poisoned
          </span>
        </div>
        <div className="mt-5">
          <DataTable
            caption="Scripted assistant cases with verification outcome"
            columns={columns}
            rows={results}
            rowKey={({ turn }) => turn.id}
            emptyTitle="The scripted suite is empty"
          />
        </div>
      </section>

      <section aria-labelledby="sandbox-heading" className="mt-14">
        <div className="border-b border-rule pb-4">
          <SectionLabel id="sandbox-heading">Verifier sandbox</SectionLabel>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">
            Everything above is the system marking its own homework. Here you get to attack it.
            The narrative below cites live evidence ids and passes as written. Change any figure
            inside a citation, or type a bare number into the prose, and press Verify.
          </p>
        </div>
        <div className="mt-6">
          <VerifierSandbox initialNarrative={sandboxNarrative()} evidence={catalogue} />
        </div>
      </section>
    </ReceiptProvider>
  );
}
