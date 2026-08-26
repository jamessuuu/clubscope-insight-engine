import type { ClubDataset, Member, Transaction } from '../domain/types.js';
import { type AnalysisTool, type Evidence, makeEvidence } from './evidence.js';
import {
  FROM_PARAM,
  inPeriod,
  isoDate,
  periodOf,
  positiveInt,
  round2,
  TO_PARAM,
  type Period,
} from './common.js';

/**
 * Discretionary spend tools.
 *
 * ## Why dues are excluded from every figure in this file
 *
 * Dues are contractual. They post on the same day for the same amount whether a member came
 * in forty times last quarter or not at all, and they keep posting right up until the
 * resignation letter arrives. A "spend per member" number that includes them therefore
 * moves only when the club changes its own pricing - it is, in effect, a restatement of the
 * fee schedule wearing the costume of an engagement metric.
 *
 * Strip the dues out and the same number becomes a leading indicator: dining, bar, pro-shop,
 * lessons and guest fees are all choices a member makes each week, and they fall months
 * before anyone resigns. That is the whole reason the churn model watches this series too.
 */
function discretionaryIn(ds: ClubDataset, p: Period): Transaction[] {
  return ds.transactions.filter((t) => t.category !== 'dues' && inPeriod(t.date, p));
}

// ─── avg_discretionary_spend ────────────────────────────────────────────────────────

export interface AvgDiscretionarySpendParams {
  from: string;
  to: string;
}

export const avgDiscretionarySpend: AnalysisTool<AvgDiscretionarySpendParams> = {
  name: 'avg_discretionary_spend',
  version: '1.0.0',
  kind: 'read',
  description:
    'Average non-dues spend per ACTIVE member over an inclusive date period - dining, bar, ' +
    'events, pro-shop, guest fees and lessons, with contractual dues excluded. Use for ' +
    '"how much is a member worth beyond their subscription", engagement value, or F&B ' +
    'per-head questions. Returns one scalar in USD.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
  },

  run(params: AvgDiscretionarySpendParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');

    const p = periodOf(from, to);
    const activeMembers = ds.members.filter((m) => m.status === 'active');
    const activeIds = new Set(activeMembers.map((m) => m.id));

    // Numerator and denominator describe the same population. Dividing all members' spend
    // by the active headcount is a real and common reporting bug: it silently credits the
    // active roll with money spent by people who have already left, and the resulting
    // average rises every time somebody resigns.
    const rows = discretionaryIn(ds, p).filter((t) => activeIds.has(t.memberId));
    const total = rows.reduce((sum, t) => sum + t.amount, 0);

    if (activeMembers.length === 0) {
      throw new Error('average per active member is undefined: the club has no active members');
    }

    return makeEvidence({
      tool: avgDiscretionarySpend.name,
      version: avgDiscretionarySpend.version,
      params: { from, to },
      value: { kind: 'scalar', n: round2(total / activeMembers.length) },
      unit: 'usd',
      method:
        `Summed $${total.toLocaleString('en-US')} of non-dues spend by active members ` +
        `between ${from} and ${to} inclusive, and divided by the ${activeMembers.length} ` +
        `active members on the roll. Dues are excluded because they are contractual and do ` +
        `not move with engagement; members who have resigned are excluded from both the ` +
        `total and the divisor.`,
      rowIds: [...rows.map((t) => t.id), ...activeMembers.map((m) => m.id)],
    });
  },
};

// ─── top_members_by_spend ───────────────────────────────────────────────────────────

export interface TopMembersBySpendParams {
  from: string;
  to: string;
  limit?: number;
}

export const topMembersBySpend: AnalysisTool<TopMembersBySpendParams> = {
  name: 'top_members_by_spend',
  version: '1.0.0',
  kind: 'read',
  description:
    'The highest-spending members by non-dues spend over an inclusive date period, ranked ' +
    'largest first. Use for "who are our best members", VIP lists, or deciding who a ' +
    'retention call is worth making to. Members who have since resigned are included, ' +
    'because their spend is real history. Returns a table, not a single number.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
    limit: {
      type: 'number',
      description: 'How many members to return. Defaults to 10.',
      required: false,
      default: 10,
    },
  },

  run(params: TopMembersBySpendParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');
    const limit = positiveInt(params.limit, 'limit', 10);

    const rows = discretionaryIn(ds, periodOf(from, to));

    const byMember = new Map<string, number>();
    for (const t of rows) byMember.set(t.memberId, (byMember.get(t.memberId) ?? 0) + t.amount);

    const memberById = new Map<string, Member>(ds.members.map((m) => [m.id, m]));

    const ranked = [...byMember.entries()]
      // Ties break on member id so the ranking is a total order. Without it, two members on
      // the same dollar could swap places between runs and the receipt would not reproduce.
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([memberId, spend]) => {
        const m = memberById.get(memberId);
        return {
          memberId,
          memberNo: m ? m.memberNo : 'unknown',
          name: m ? `${m.firstName} ${m.lastName}` : 'unknown member',
          status: m ? m.status : 'unknown',
          spend,
        };
      });

    const top = ranked.slice(0, limit);

    return makeEvidence({
      tool: topMembersBySpend.name,
      version: topMembersBySpend.version,
      params: { from, to, limit },
      value: {
        kind: 'table',
        columns: ['memberId', 'memberNo', 'name', 'status', 'spend'],
        rows: top.map((r) => [r.memberId, r.memberNo, r.name, r.status, r.spend]),
      },
      unit: 'usd',
      method:
        `Summed non-dues spend per member between ${from} and ${to} inclusive across ` +
        `${rows.length} transactions, ranked ${ranked.length} spending members largest ` +
        `first, and returned the top ${top.length}. Dues are excluded so the ranking ` +
        `reflects discretionary choice rather than membership tier.`,
      // Ranked member ids lead the receipt so they survive the 500-row display cap, followed
      // by every transaction the ranking actually consumed - a top-10 that hides the other
      // 90 members it beat is not an auditable ranking.
      rowIds: [...top.map((r) => r.memberId), ...rows.map((t) => t.id)],
    });
  },
};
