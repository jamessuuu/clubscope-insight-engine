import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { club, riskDistribution } from '@/lib/club';
import { num, shortDate } from '@/lib/format';
import { roster } from '@/lib/roster';
import { MembersTable } from './MembersTable';

export const metadata: Metadata = {
  title: 'Roster — ClubScope Insight Engine',
};

const BAND_TEXT: Record<string, string> = {
  critical: 'text-risk-critical',
  elevated: 'text-risk-elevated',
  watch: 'text-risk-watch',
  low: 'text-risk-low',
};

export default function MembersPage() {
  const ds = club();
  const rows = roster();
  const distribution = riskDistribution();

  return (
    <>
      <PageHeader
        eyebrow="Member 360"
        title="The roll, sorted by who is quietly leaving"
        lede={
          <>
            Every member on the roll with their own churn assessment, scored deterministically
            as at {shortDate(ds.club.dataTo)}. The score is arithmetic over this member&rsquo;s
            own history, not a language model&rsquo;s impression — open any profile to see each
            signed term.
          </>
        }
        aside={
          <dl className="flex gap-8 text-left sm:text-right">
            {distribution
              .filter((d) => d.band === 'critical' || d.band === 'elevated')
              .map((d) => (
                <div key={d.band}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted">
                    {d.band}
                  </dt>
                  <dd
                    className={`tnum mt-2 text-[22px] font-semibold leading-none ${BAND_TEXT[d.band]}`}
                  >
                    {num(d.count)}
                  </dd>
                </div>
              ))}
          </dl>
        }
      />

      <section aria-labelledby="roster-heading" className="mt-8">
        <SectionLabel id="roster-heading" className="sr-only">
          Member roster
        </SectionLabel>
        <MembersTable rows={rows} />
      </section>
    </>
  );
}
