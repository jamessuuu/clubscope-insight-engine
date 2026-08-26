import { assessChurn } from '@clubscope/core/scoring';
import type { ChurnAssessment } from '@clubscope/core/scoring';
import type { Member, RevenueCategory } from '@clubscope/core/domain';
import { club, evidenceFrom } from './club';
import { monthLabel, shiftDays } from './format';
import type { Evidence } from './types';

export interface MonthPoint {
  label: string;
  value: number;
}

export interface NoteRow {
  id: string;
  date: string;
  author: string;
  channel: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  body: string;
}

export interface MemberProfile {
  member: Member;
  assessment: ChurnAssessment;
  scoreEvidence: Evidence;
  /** Discretionary spend by revenue category over the trailing 12 months. */
  spendByCategory: Array<{ category: RevenueCategory; total: number }>;
  spendWindow: { from: string; to: string };
  /** One point per month across the whole dataset, dense: quiet months read as zero. */
  visitCadence: MonthPoint[];
  visitsLast90: number;
  facilityMix: Array<{ facility: string; visits: number }>;
  events: { registered: number; attended: number; recent: Array<{ name: string; date: string; attended: boolean }> };
  notes: NoteRow[];
  guestsHosted: number;
}

function monthKeysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${fromIso.slice(0, 7)}-01T00:00:00.000Z`);
  const end = new Date(`${toIso.slice(0, 7)}-01T00:00:00.000Z`);
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Everything one member's page needs, in one pass per collection.
 *
 * The visit series is built dense — every month between the dataset bounds gets a point,
 * present or not — because a sparse series silently closes the gap where a member stopped
 * turning up, drawing a continuous line straight over the disengagement the page exists to
 * show. Absent months are zero, and zero is the signal.
 */
export function memberProfile(id: string): MemberProfile | null {
  const ds = club();
  const member = ds.members.find((m) => m.id === id);
  if (!member) return null;

  const assessment = assessChurn(member, ds);
  const scoreEvidence = evidenceFrom('member_churn_score', { memberId: id });

  const to = ds.club.dataTo;
  const spendFrom = shiftDays(to, -364);
  const spendFromMs = Date.parse(`${spendFrom}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T23:59:59.999Z`);
  const window90Ms = Date.parse(`${shiftDays(to, -89)}T00:00:00.000Z`);

  const spend = new Map<RevenueCategory, number>();
  for (const t of ds.transactions) {
    if (t.memberId !== id || t.category === 'dues') continue;
    const at = Date.parse(t.date);
    if (at < spendFromMs || at > toMs) continue;
    spend.set(t.category, (spend.get(t.category) ?? 0) + t.amount);
  }

  const months = new Map<string, number>(monthKeysBetween(ds.club.dataFrom, to).map((k) => [k, 0]));
  const facilities = new Map<string, number>();
  let visitsLast90 = 0;
  let guestsHosted = 0;

  for (const v of ds.visits) {
    if (v.memberId !== id) continue;
    const key = v.at.slice(0, 7);
    if (months.has(key)) months.set(key, (months.get(key) ?? 0) + 1);
    facilities.set(v.facility, (facilities.get(v.facility) ?? 0) + 1);
    const at = Date.parse(v.at);
    if (at >= window90Ms && at <= toMs) {
      visitsLast90++;
      guestsHosted += v.guests;
    }
  }

  const eventById = new Map(ds.events.map((e) => [e.id, e]));
  let registered = 0;
  let attended = 0;
  const recentEvents: Array<{ name: string; date: string; attended: boolean }> = [];
  for (const r of ds.registrations) {
    if (r.memberId !== id) continue;
    registered++;
    if (r.attended) attended++;
    const event = eventById.get(r.eventId);
    if (event) recentEvents.push({ name: event.name, date: event.date, attended: r.attended });
  }
  recentEvents.sort((a, b) => b.date.localeCompare(a.date));

  const notes: NoteRow[] = ds.notes
    .filter((n) => n.memberId === id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)
    .map((n) => ({
      id: n.id,
      date: n.date,
      author: n.author,
      channel: n.channel,
      sentiment: n.sentiment,
      body: n.body,
    }));

  return {
    member,
    assessment,
    scoreEvidence,
    spendByCategory: [...spend.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total),
    spendWindow: { from: spendFrom, to },
    visitCadence: [...months.entries()].map(([key, value]) => ({
      label: monthLabel(key),
      value,
    })),
    visitsLast90,
    facilityMix: [...facilities.entries()]
      .map(([facility, visits]) => ({ facility, visits }))
      .sort((a, b) => b.visits - a.visits),
    events: { registered, attended, recent: recentEvents.slice(0, 5) },
    notes,
    guestsHosted,
  };
}
