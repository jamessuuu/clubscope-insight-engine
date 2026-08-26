import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CHURN_MODEL_VERSION } from '@clubscope/core/scoring';
import { BarChart } from '@/components/BarChart';
import { ContributionBar } from '@/components/ContributionBar';
import { EvidenceChip } from '@/components/EvidenceChip';
import { EmptyState } from '@/components/EmptyState';
import { ReceiptProvider } from '@/components/ReceiptProvider';
import { RiskBadge } from '@/components/RiskBadge';
import { SectionLabel } from '@/components/SectionLabel';
import { Sparkline } from '@/components/Sparkline';
import { club, scalarValue } from '@/lib/club';
import { cx, humanise, num, shortDate, usd } from '@/lib/format';
import { memberProfile } from '@/lib/member';
import { forClient } from '@/lib/receipts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const member = club().members.find((m) => m.id === id);
  return {
    title: member
      ? `${member.firstName} ${member.lastName} — Member 360`
      : 'Member not found — ClubScope Insight Engine',
  };
}

const SENTIMENT: Record<string, string> = {
  positive: 'border-risk-low/45 text-risk-low',
  neutral: 'border-rule text-muted',
  negative: 'border-negative/45 text-negative',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-4 border-b border-rule py-2.5 last:border-b-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = memberProfile(id);
  if (!profile) notFound();

  const ds = club();
  const {
    member,
    assessment,
    scoreEvidence,
    spendByCategory,
    spendWindow,
    visitCadence,
    visitsLast90,
    facilityMix,
    events,
    notes,
    guestsHosted,
  } = profile;

  const evidence = forClient([scoreEvidence]);
  const maxAbs = Math.max(1, ...assessment.contributions.map((c) => Math.abs(c.points)));
  const spendTotal = spendByCategory.reduce((sum, s) => sum + s.total, 0);
  const attendanceRate = events.registered === 0 ? null : (events.attended / events.registered) * 100;

  return (
    <ReceiptProvider evidence={evidence}>
      <nav aria-label="Breadcrumb" className="text-[12px] text-muted">
        <Link href="/members" className="underline underline-offset-2 hover:text-ink">
          Roster
        </Link>
        <span className="mx-2 text-faint">/</span>
        <span className="text-ink">{member.firstName} {member.lastName}</span>
      </nav>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-rule pb-7">
        <div>
          <SectionLabel as="p">
            {humanise(member.category)} &middot; member #{member.memberNo}
          </SectionLabel>
          <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.022em] text-ink">
            {member.firstName} {member.lastName}
          </h1>
          <p className="mt-2 text-[13px] text-muted">
            Joined {shortDate(member.joinedAt)} via {member.joinedVia}
            {member.status === 'active' ? '' : ` · ${humanise(member.status)}`}
            {member.resignedAt ? ` ${shortDate(member.resignedAt)}` : ''}
          </p>
        </div>
        <div className="text-right">
          <SectionLabel as="p">Churn risk</SectionLabel>
          <p className="tnum mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink">
            <EvidenceChip evidenceId={scoreEvidence.id} value={num(scalarValue(scoreEvidence))} />
          </p>
          <div className="mt-3 flex justify-end">
            <RiskBadge band={assessment.band} size="lg" />
          </div>
        </div>
      </header>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="card p-5" aria-labelledby="identity-heading">
            <SectionLabel as="h2" id="identity-heading">
              Identity
            </SectionLabel>
            <dl className="mt-4">
              <Field label="Member id">
                <span className="font-mono text-[12px]">{member.id}</span>
              </Field>
              <Field label="Category">{humanise(member.category)}</Field>
              <Field label="Status">{humanise(member.status)}</Field>
              <Field label="Tenure">
                <span className="tnum">
                  {num(
                    Math.round(
                      ((Date.parse(ds.club.dataTo) - Date.parse(member.joinedAt)) /
                        86_400_000 /
                        365.25) *
                        10,
                    ) / 10,
                    1,
                  )}{' '}
                  years
                </span>
              </Field>
              <Field label="Annual dues">
                <span className="tnum">{usd(member.annualDues)}</span>
              </Field>
              <Field label="Household">
                <span className="tnum">{member.householdSize}</span> &middot; {member.ageBand}
              </Field>
              <Field label="Home city">{member.homeCity}</Field>
              <Field label="Email">
                <span className="break-all text-[12px]">{member.email}</span>
              </Field>
            </dl>
          </section>

          <section className="card p-5" aria-labelledby="engagement-heading">
            <SectionLabel as="h2" id="engagement-heading">
              Last 90 days
            </SectionLabel>
            <dl className="mt-4">
              <Field label="Visits">
                <span className="tnum">{num(visitsLast90)}</span>
              </Field>
              <Field label="Guests">
                <span className="tnum">{num(guestsHosted)}</span>
              </Field>
              <Field label="Events">
                <span className="tnum">
                  {num(events.attended)} of {num(events.registered)} attended
                </span>
              </Field>
              {attendanceRate === null ? null : (
                <Field label="Show rate">
                  <span className="tnum">{num(attendanceRate, 0)}%</span>
                </Field>
              )}
            </dl>
          </section>
        </aside>

          <section className="card p-6" aria-labelledby="assessment-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <SectionLabel as="h2" id="assessment-heading">
                  Why this score
                </SectionLabel>
                <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
                  Every signed term the model added, heaviest first. Baselines are this
                  member&rsquo;s own history rather than the club average — a social member who
                  visits twice a month has not disengaged, and comparing them to a full-golf
                  cadence would manufacture a crisis.
                </p>
              </div>
              <span className="tnum shrink-0 rounded-full border border-rule px-2.5 py-1 font-mono text-[11px] text-muted">
                v{CHURN_MODEL_VERSION}
              </span>
            </div>

            {assessment.contributions.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="No signal fired"
                  description="Nothing in this member's record crossed a threshold in either direction, so the score sits at its floor."
                />
              </div>
            ) : (
              <ul className="mt-6 divide-y divide-rule">
                {assessment.contributions.map((contribution) => (
                  <ContributionBar
                    key={contribution.signal}
                    contribution={contribution}
                    maxAbs={maxAbs}
                  />
                ))}
              </ul>
            )}

            <p className="mt-6 border-t border-rule pt-4 text-[12px] leading-relaxed text-muted">
              <span className="font-semibold text-ink">
                This score is arithmetic, not a language model.
              </span>{' '}
              It is produced by churn model v{CHURN_MODEL_VERSION} — a versioned, unit-tested
              weighted sum evaluated as at {shortDate(assessment.asOf)}, the last date the
              dataset covers. Run it twice and you get the same number; run it next quarter
              after a weight changes and the version tells you why it moved. A model would
              give none of that, and a retention budget defended to a board committee needs
              all of it.
            </p>
          </section>
        </div>

      <div className="mt-8 space-y-8">
        <div className="grid items-start gap-8 md:grid-cols-2">
          <section className="card p-6" aria-labelledby="spend-heading">
            <SectionLabel as="h2" id="spend-heading">
              Discretionary spend
            </SectionLabel>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              {shortDate(spendWindow.from)} to {shortDate(spendWindow.to)}. Dues excluded:
              they are contractual and post regardless of engagement.
            </p>
            <p className="tnum mt-4 text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">
              {usd(spendTotal)}
            </p>
            <div className="mt-5">
              {spendByCategory.length === 0 ? (
                <p className="text-[13px] text-faint">
                  No discretionary spend recorded in this window.
                </p>
              ) : (
                <BarChart
                  ariaLabel="Discretionary spend by revenue category over the trailing twelve months"
                  data={spendByCategory.map((s) => ({
                    label: humanise(s.category),
                    value: s.total,
                    display: usd(s.total),
                  }))}
                />
              )}
            </div>
          </section>

          <section className="card p-6" aria-labelledby="facility-heading">
            <SectionLabel as="h2" id="facility-heading">
              Where they go
            </SectionLabel>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Visits by facility across the full {num(visitCadence.length)}-month record.
            </p>
            <div className="mt-5">
              {facilityMix.length === 0 ? (
                <p className="text-[13px] text-faint">No recorded visit to any facility.</p>
              ) : (
                <BarChart
                  ariaLabel="Visits by facility"
                  data={facilityMix.map((f) => ({
                    label: humanise(f.facility),
                    value: f.visits,
                    display: `${num(f.visits)} visits`,
                  }))}
                />
              )}
            </div>
          </section>
        </div>

        <section className="card p-6" aria-labelledby="cadence-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <SectionLabel as="h2" id="cadence-heading">
              Visit cadence
            </SectionLabel>
            <span className="tnum text-[11px] text-faint">
              {visitCadence[0]?.label} – {visitCadence[visitCadence.length - 1]?.label}
            </span>
          </div>
          <div className="mt-5">
            <Sparkline
              ariaLabel={`Monthly visits from ${visitCadence[0]?.label} to ${
                visitCadence[visitCadence.length - 1]?.label
              }, peaking at ${Math.max(...visitCadence.map((p) => p.value))} visits in a month`}
              points={visitCadence}
            />
            <div className="mt-2 flex justify-between text-[11px] text-faint">
              <span>{visitCadence[0]?.label}</span>
              <span>{visitCadence[Math.floor(visitCadence.length / 2)]?.label}</span>
              <span>{visitCadence[visitCadence.length - 1]?.label}</span>
            </div>
          </div>
        </section>

        <section className="card p-6" aria-labelledby="events-heading">
          <SectionLabel as="h2" id="events-heading">
            Event attendance
          </SectionLabel>
          {events.recent.length === 0 ? (
            <p className="mt-4 text-[13px] text-faint">
              No event registrations on record for this member.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-rule">
              {events.recent.map((event) => (
                <li
                  key={`${event.name}-${event.date}`}
                  className="flex items-center justify-between gap-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{event.name}</span>
                    <span className="tnum text-[11px] text-faint">{shortDate(event.date)}</span>
                  </span>
                  <span
                    className={cx(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em]',
                      event.attended ? 'border-risk-low/45 text-risk-low' : 'border-rule text-muted',
                    )}
                  >
                    {event.attended ? 'attended' : 'no show'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6" aria-labelledby="notes-heading">
          <SectionLabel as="h2" id="notes-heading">
            What staff actually heard
          </SectionLabel>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Free-text notes from the front desk, email, surveys and committee. Real club
            intelligence is not only numeric.
          </p>
          {notes.length === 0 ? (
            <p className="mt-4 text-[13px] text-faint">No notes recorded for this member.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {notes.map((note) => (
                <li key={note.id} className="border-l-2 border-rule pl-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                      className={cx(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em]',
                        SENTIMENT[note.sentiment] ?? SENTIMENT.neutral,
                      )}
                    >
                      {note.sentiment}
                    </span>
                    <span className="tnum text-[11px] text-faint">{shortDate(note.date)}</span>
                    <span className="text-[11px] text-faint">
                      {note.author} &middot; {humanise(note.channel)}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink">{note.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ReceiptProvider>
  );
}
