import type { Metadata } from 'next';
import Link from 'next/link';
import { toSegments } from '@clubscope/core/verify';
import { ActionConsole, SuggestedActions } from '@/components/ActionConsole';
import { DonutChart } from '@/components/DonutChart';
import { EmptyState } from '@/components/EmptyState';
import { EvidenceChip, Narrative } from '@/components/EvidenceChip';
import { PageHeader } from '@/components/PageHeader';
import { ReceiptProvider } from '@/components/ReceiptProvider';
import { SectionLabel } from '@/components/SectionLabel';
import { StatCard } from '@/components/StatCard';
import { VerificationBadge } from '@/components/VerificationBadge';
import { club, evidenceFrom, recentWindow, riskDistribution, scalarValue } from '@/lib/club';
import { num, shortDate, usdCompact } from '@/lib/format';
import { rankedInsights } from '@/lib/insights';
import { forClient } from '@/lib/receipts';
import { blockedKeysOf } from '@/lib/blocked';
import type { Insight } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Insight feed — ClubScope Insight Engine',
};

const SEVERITY: Record<Insight['severity'], { bar: string; label: string; text: string }> = {
  critical: { bar: 'bg-risk-critical', label: 'Critical', text: 'text-risk-critical' },
  elevated: { bar: 'bg-risk-elevated', label: 'Elevated', text: 'text-risk-elevated' },
  informational: { bar: 'bg-rule-cool', label: 'Informational', text: 'text-muted' },
};

const BAND_COLOR: Record<string, string> = {
  critical: 'var(--color-risk-critical)',
  elevated: 'var(--color-risk-elevated)',
  watch: 'var(--color-risk-watch)',
  low: 'var(--color-risk-low)',
};

export default function InsightFeedPage() {
  const ds = club();
  const { from, to } = recentWindow();

  // Every headline figure is a tool call, so every headline figure has a receipt. There is
  // deliberately no path in this application for a number to reach the screen otherwise.
  const activeMembers = evidenceFrom('member_count', { status: 'active' });
  const duesAtRisk = evidenceFrom('dues_at_risk', { band: 'elevated' });
  const revenue90 = evidenceFrom('revenue_total', { from, to });
  const cohort = evidenceFrom('churn_cohort_size', { band: 'elevated' });

  const feed = rankedInsights();
  const distribution = riskDistribution();
  const activeTotal = distribution.reduce((sum, d) => sum + d.count, 0);

  const evidence = forClient([
    activeMembers,
    duesAtRisk,
    revenue90,
    cohort,
    ...feed.flatMap((insight) => insight.evidence),
  ]);

  const criticalCount = feed.filter((i) => i.severity === 'critical').length;

  return (
    <ReceiptProvider evidence={evidence}>
      <PageHeader
        eyebrow={ds.club.name}
        title="What changed, and what to do about it"
        lede={
          <>
            Detected findings across {num(ds.members.length)} members and{' '}
            {num(ds.transactions.length + ds.visits.length)} activity records covering{' '}
            {shortDate(ds.club.dataFrom)} to {shortDate(ds.club.dataTo)}. Every figure below
            opens onto the rows it came from.
          </>
        }
        aside={
          <div className="text-left sm:text-right">
            <SectionLabel as="p">Feed status</SectionLabel>
            <p className="tnum mt-2 text-[13px] text-ink">
              {feed.length} insight{feed.length === 1 ? '' : 's'} detected
            </p>
            <p className="tnum text-[12px] text-muted">
              {criticalCount} critical &middot; {feed.length - criticalCount} other
            </p>
          </div>
        }
      />

      <section aria-labelledby="headline-stats" className="mt-8">
        <h2 id="headline-stats" className="sr-only">
          Headline figures
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active members"
            value={
              <EvidenceChip evidenceId={activeMembers.id} value={num(scalarValue(activeMembers))} />
            }
            sub="On the roll today, excluding resigned and suspended."
            footnote="member_count · status: active"
          />
          <StatCard
            label="Dues at risk"
            value={
              <EvidenceChip evidenceId={duesAtRisk.id} value={usdCompact(scalarValue(duesAtRisk))} />
            }
            sub="Annual dues held by members scored elevated or worse."
            footnote="dues_at_risk · band: elevated"
          />
          <StatCard
            label="Revenue, last 90 days"
            value={
              <EvidenceChip evidenceId={revenue90.id} value={usdCompact(scalarValue(revenue90))} />
            }
            sub={`${shortDate(from)} to ${shortDate(to)}, all categories.`}
            footnote="revenue_total · from / to"
          />
          <StatCard
            label="Elevated and critical"
            value={<EvidenceChip evidenceId={cohort.id} value={num(scalarValue(cohort))} />}
            sub="Active members the churn model has genuine concern about."
            footnote="churn_cohort_size · band: elevated"
          />
        </div>
      </section>

      <ActionConsole>
        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="feed-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
              <SectionLabel id="feed-heading">Detected insights</SectionLabel>
              <span className="text-[11px] text-faint">
                Deterministic detectors, not a model asked to find something
              </span>
            </div>

            {feed.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="No detector fired this period"
                  description="That is a real answer rather than a failure. A quiet month should produce an empty feed, not an invented trend — which is exactly what a model asked to surface an insight would hand you."
                />
              </div>
            ) : (
              <ol className="mt-6 space-y-5">
                {feed.map((insight) => (
                  <li key={insight.id}>
                    <InsightCard insight={insight} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          <aside className="space-y-5">
            <div className="card p-5">
              <SectionLabel as="h2">Risk distribution</SectionLabel>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Active members by churn band, scored as at {shortDate(ds.club.dataTo)}.
              </p>
              <div className="mt-5">
                <DonutChart
                  ariaLabel={`Active members by churn risk band: ${distribution
                    .map((d) => `${d.band} ${d.count}`)
                    .join(', ')}`}
                  centreValue={num(activeTotal)}
                  centreLabel="active"
                  slices={distribution.map((d) => ({
                    label: d.band.charAt(0).toUpperCase() + d.band.slice(1),
                    value: d.count,
                    color: BAND_COLOR[d.band] ?? 'var(--color-rule)',
                  }))}
                />
              </div>
              <Link
                href="/members"
                className="mt-5 inline-block border-b border-champagne pb-0.5 text-[13px] font-medium text-ink transition-colors hover:text-champagne-press"
              >
                Open the roster
              </Link>
            </div>

            <div className="card p-5">
              <SectionLabel as="h2">How a card is built</SectionLabel>
              <ol className="mt-4 space-y-3 text-[12.5px] leading-relaxed text-muted">
                <li>
                  <span className="font-semibold text-ink">1. Detect.</span> A deterministic
                  detector fires against stated thresholds, or it stays silent.
                </li>
                <li>
                  <span className="font-semibold text-ink">2. Compute.</span> Typed analysis
                  tools produce every figure, each with its own evidence record.
                </li>
                <li>
                  <span className="font-semibold text-ink">3. Narrate.</span> The wording is
                  written around those figures, never over them.
                </li>
                <li>
                  <span className="font-semibold text-ink">4. Verify.</span> Each cited figure
                  is recomputed from source. A mismatch blocks the card.
                </li>
              </ol>
              <Link
                href="/how-it-works"
                className="mt-5 inline-block border-b border-champagne pb-0.5 text-[13px] font-medium text-ink transition-colors hover:text-champagne-press"
              >
                The full contract
              </Link>
            </div>
          </aside>
        </div>
      </ActionConsole>
    </ReceiptProvider>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const severity = SEVERITY[insight.severity];
  const blocked = blockedKeysOf(insight.verification);

  return (
    <article className="card relative overflow-hidden p-6 pl-7">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${severity.bar}`} />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex flex-wrap items-center gap-3">
          <SectionLabel as="p" className={severity.text}>
            {severity.label}
          </SectionLabel>
          <span className="text-[11px] uppercase tracking-[0.12em] text-faint">{insight.kind}</span>
        </span>
        <VerificationBadge report={insight.verification} />
      </div>

      <h3 className="mt-3 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink">
        {insight.headline}
      </h3>

      <div className="mt-3">
        <Narrative segments={toSegments(insight.narrative)} blockedKeys={blocked} />
      </div>

      <div className="mt-5 border-t border-rule pt-4">
        <SectionLabel as="p">Recommended</SectionLabel>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{insight.recommendation}</p>
      </div>

      <SuggestedActions actions={insight.suggestedActions} rationale={insight.recommendation} />

      <p className="mt-5 border-t border-rule pt-3 font-mono text-[11px] leading-relaxed text-faint">
        detector: {insight.detector} &middot; {insight.evidence.length} evidence record
        {insight.evidence.length === 1 ? '' : 's'} &middot; {insight.verification.recomputedCount}{' '}
        recomputed in {insight.verification.durationMs}ms
      </p>
    </article>
  );
}
