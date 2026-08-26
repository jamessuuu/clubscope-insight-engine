import { once } from './once';
import type { MemberStatus, MembershipCategory } from '@clubscope/core/domain';
import { assessments, club, recentWindow } from './club';
import { daysBetween } from './format';

export interface RosterRow {
  id: string;
  memberNo: string;
  name: string;
  category: MembershipCategory;
  status: MemberStatus;
  joinedAt: string;
  /** Years on the roll, to one decimal, as at the dataset's end date. */
  tenure: number;
  /** ISO instant of the most recent visit to any facility, or null. */
  lastVisit: string | null;
  /** Days since that visit, as at the dataset's end date. -1 when never seen. */
  quietDays: number;
  /** Discretionary spend over the last 90 days the data covers. Dues excluded. */
  spend90: number;
  annualDues: number;
  score: number;
  band: 'low' | 'watch' | 'elevated' | 'critical';
}

/**
 * The roster, assembled in three passes rather than per member.
 *
 * The obvious shape — filter transactions and visits inside a `members.map` — is O(members ×
 * rows) and turns 420 members over 110,000 rows into tens of millions of comparisons for a
 * table nobody wants to wait for. Bucketing first costs one pass each and makes the page
 * render in the time the churn scoring alone takes.
 *
 * Spend excludes dues on purpose. Dues are contractual and keep posting right up to the
 * resignation letter, so a spend column that includes them shows a disengaging member as a
 * healthy one — the exact blind spot that makes dues-only reporting miss churn entirely.
 */
export const roster = once((): RosterRow[] => {
  const ds = club();
  const scored = assessments();
  const { from, to } = recentWindow();
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T23:59:59.999Z`);

  const spend = new Map<string, number>();
  for (const t of ds.transactions) {
    if (t.category === 'dues') continue;
    const at = Date.parse(t.date);
    if (at < fromMs || at > toMs) continue;
    spend.set(t.memberId, (spend.get(t.memberId) ?? 0) + t.amount);
  }

  const lastVisit = new Map<string, string>();
  for (const v of ds.visits) {
    const current = lastVisit.get(v.memberId);
    if (current === undefined || v.at > current) lastVisit.set(v.memberId, v.at);
  }

  return ds.members.map((m) => {
    const assessment = scored.get(m.id);
    const seen = lastVisit.get(m.id) ?? null;
    return {
      id: m.id,
      memberNo: m.memberNo,
      name: `${m.firstName} ${m.lastName}`,
      category: m.category,
      status: m.status,
      joinedAt: m.joinedAt,
      tenure: Math.round((daysBetween(m.joinedAt, ds.club.dataTo) / 365.25) * 10) / 10,
      lastVisit: seen,
      quietDays: seen === null ? -1 : daysBetween(seen, ds.club.dataTo),
      spend90: spend.get(m.id) ?? 0,
      annualDues: m.annualDues,
      score: assessment?.score ?? 0,
      band: assessment?.band ?? 'low',
    };
  });
});
