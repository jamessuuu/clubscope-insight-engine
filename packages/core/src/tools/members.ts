import type {
  ClubDataset,
  Member,
  MemberStatus,
  MembershipCategory,
} from '../domain/types.js';
import { assessChurn, CHURN_MODEL_VERSION } from '../scoring/churn.js';
import {
  type AnalysisTool,
  type Evidence,
  makeEvidence,
  type ToolParamSpec,
} from './evidence.js';
import {
  bandAtOrAbove,
  FROM_PARAM,
  isoDate,
  MEMBER_STATUSES,
  MEMBERSHIP_CATEGORIES,
  optionalOneOf,
  percentOf,
  periodOf,
  requiredOneOf,
  requiredString,
  THRESHOLD_BANDS,
  TO_PARAM,
  type RiskBand,
  inPeriod,
} from './common.js';

/**
 * Membership and retention tools.
 *
 * ## Why every churn tool is evaluated at the dataset's end date
 *
 * `assessChurn` defaults `asOf` to `ds.club.dataTo`, and these tools keep that default
 * rather than exposing "now". Two reasons, and they matter more than the convenience:
 *
 * 1. The verifier re-runs a tool minutes or days after the original call. If risk were
 *    computed against the wall clock, the recomputation would drift past its own 90-day
 *    window and a figure that was true when written would be flagged as fabricated. The
 *    grounding guarantee requires that a tool be a function of its params alone.
 * 2. The dataset is a closed historical record. Asking "who is at risk today" of data that
 *    ends last December is a question with no honest answer, and inventing one by silently
 *    ageing the window is precisely the failure mode this system is built to refuse.
 */

const STATUS_PARAM = {
  type: 'enum',
  description:
    'Optional membership status filter: active, resigned or suspended. Omit to count all.',
  enum: [...MEMBER_STATUSES],
  required: false,
} satisfies ToolParamSpec;

const CATEGORY_PARAM = {
  type: 'enum',
  description:
    'Optional membership category filter (full-golf, social, junior-executive, corporate, ' +
    'non-resident). Omit to include every category.',
  enum: [...MEMBERSHIP_CATEGORIES],
  required: false,
} satisfies ToolParamSpec;

const BAND_PARAM = {
  type: 'enum',
  description:
    'Risk threshold, inclusive. "watch" is score 25+, "elevated" is 45+, "critical" is ' +
    '70+. Members in higher bands are always included, so "watch" returns everyone the ' +
    'model has any concern about.',
  enum: [...THRESHOLD_BANDS],
  required: true,
} satisfies ToolParamSpec;

/**
 * Active members at or above a risk threshold, in a stable order.
 *
 * Restricted to active members deliberately: a resigned member's churn risk is not a
 * prediction, it is a fact that already happened, and mixing them into a "who might leave"
 * cohort inflates every retention number the club would then act on.
 */
function membersAtRisk(ds: ClubDataset, threshold: RiskBand): Member[] {
  return ds.members
    .filter((m) => m.status === 'active')
    .filter((m) => bandAtOrAbove(assessChurn(m, ds).band, threshold))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ─── member_count ───────────────────────────────────────────────────────────────────

export interface MemberCountParams {
  status?: MemberStatus;
  category?: MembershipCategory;
}

export const memberCount: AnalysisTool<MemberCountParams> = {
  name: 'member_count',
  version: '1.0.0',
  kind: 'read',
  description:
    'Number of members on the roll, optionally filtered by status (active, resigned, ' +
    'suspended) and/or membership category. Use for "how many members do we have", roster ' +
    'sizes, and as the denominator for any per-member figure. Returns one scalar count. ' +
    'This is a snapshot of the roll, not a count over a date range.',
  params: {
    status: STATUS_PARAM,
    category: CATEGORY_PARAM,
  },

  run(params: MemberCountParams, ds: ClubDataset): Evidence {
    const status = optionalOneOf(params.status, 'status', MEMBER_STATUSES);
    const category = optionalOneOf(params.category, 'category', MEMBERSHIP_CATEGORIES);

    const rows = ds.members.filter(
      (m) =>
        (status === undefined || m.status === status) &&
        (category === undefined || m.category === category),
    );

    const filters = [
      status === undefined ? null : `status "${status}"`,
      category === undefined ? null : `category "${category}"`,
    ].filter((s): s is string => s !== null);

    return makeEvidence({
      tool: memberCount.name,
      version: memberCount.version,
      params: { status, category },
      value: { kind: 'scalar', n: rows.length },
      unit: 'count',
      method:
        `Counted member records${
          filters.length === 0 ? ' with no filters applied' : ` matching ${filters.join(' and ')}`
        }. ${rows.length} of ${ds.members.length} members on the roll matched.`,
      rowIds: rows.map((m) => m.id),
    });
  },
};

// ─── churn_cohort_size ──────────────────────────────────────────────────────────────

export interface ChurnCohortSizeParams {
  band: RiskBand;
}

export const churnCohortSize: AnalysisTool<ChurnCohortSizeParams> = {
  name: 'churn_cohort_size',
  version: '1.1.0',
  kind: 'read',
  description:
    'How many ACTIVE members sit at or above a given churn-risk band. Use for "how many ' +
    'members are at risk", "how big is the critical cohort", or to size a retention ' +
    'campaign. Returns one scalar count. Risk is scored deterministically as at the last ' +
    'date the dataset covers, not today.',
  params: {
    band: BAND_PARAM,
  },

  run(params: ChurnCohortSizeParams, ds: ClubDataset): Evidence {
    const band = requiredOneOf(params.band, 'band', THRESHOLD_BANDS);
    const rows = membersAtRisk(ds, band);

    return makeEvidence({
      tool: churnCohortSize.name,
      version: churnCohortSize.version,
      params: { band },
      value: { kind: 'scalar', n: rows.length },
      unit: 'count',
      method:
        `Scored every active member with churn model v${CHURN_MODEL_VERSION} as at ` +
        `${ds.club.dataTo}, then counted those in the "${band}" band or worse. ` +
        `${rows.length} of ${ds.members.filter((m) => m.status === 'active').length} ` +
        `active members qualified.`,
      // The receipt cites the member rows the count is made of - which members, by id.
      // The risk model reads each member's visits, transactions and notes to reach a score,
      // and listing those thousands of rows here would bury the one thing a GM needs from
      // this figure: the names behind it. Those inputs are itemised on each member's own
      // assessment, where they are actually legible.
      rowIds: rows.map((m) => m.id),
    });
  },
};

// ─── dues_at_risk ───────────────────────────────────────────────────────────────────

export interface DuesAtRiskParams {
  band: RiskBand;
}

export const duesAtRisk: AnalysisTool<DuesAtRiskParams> = {
  name: 'dues_at_risk',
  version: '1.1.0',
  kind: 'read',
  description:
    'Total annual dues held by ACTIVE members at or above a given churn-risk band - the ' +
    'dollar value the club stands to lose if that cohort resigns. Use whenever risk needs ' +
    'to be expressed as money rather than headcount, or to justify retention spend. ' +
    'Returns one scalar in USD.',
  params: {
    band: BAND_PARAM,
  },

  run(params: DuesAtRiskParams, ds: ClubDataset): Evidence {
    const band = requiredOneOf(params.band, 'band', THRESHOLD_BANDS);
    const rows = membersAtRisk(ds, band);
    const exposure = rows.reduce((sum, m) => sum + m.annualDues, 0);

    return makeEvidence({
      tool: duesAtRisk.name,
      version: duesAtRisk.version,
      params: { band },
      value: { kind: 'scalar', n: exposure },
      unit: 'usd',
      method:
        `Summed the contracted annual dues of the ${rows.length} active member(s) scored in ` +
        `the "${band}" band or worse by churn model v${CHURN_MODEL_VERSION} as at ` +
        `${ds.club.dataTo}. This is annual recurring revenue exposed to resignation, not ` +
        `revenue already lost.`,
      rowIds: rows.map((m) => m.id),
    });
  },
};

// ─── member_churn_score ─────────────────────────────────────────────────────────────

export interface MemberChurnScoreParams {
  memberId: string;
}

export const memberChurnScore: AnalysisTool<MemberChurnScoreParams> = {
  name: 'member_churn_score',
  version: '1.1.0',
  kind: 'read',
  description:
    'Churn-risk score from 0 to 100 for one member, where higher is worse (25+ is watch, ' +
    '45+ elevated, 70+ critical). Takes the internal member id, not the member number. Use ' +
    'when a question is about one named individual. Returns one scalar score. The score is ' +
    'arithmetic, not a model judgement, and can be decomposed into its contributing signals.',
  params: {
    memberId: {
      type: 'string',
      description: 'Internal member id, as returned by other tools (not the member number).',
      required: true,
    },
  },

  run(params: MemberChurnScoreParams, ds: ClubDataset): Evidence {
    const memberId = requiredString(params.memberId, 'memberId');
    const member = ds.members.find((m) => m.id === memberId);
    if (!member) throw new Error(`no member with id "${memberId}" in this dataset`);

    const assessment = assessChurn(member, ds);
    const drivers = assessment.contributions
      .filter((c) => c.points > 0)
      .slice(0, 3)
      .map((c) => `${c.signal} (+${c.points})`);

    return makeEvidence({
      tool: memberChurnScore.name,
      version: memberChurnScore.version,
      params: { memberId },
      value: { kind: 'scalar', n: assessment.score },
      unit: 'score',
      method:
        `Churn model v${assessment.modelVersion} scored member ${member.memberNo} at ` +
        `${assessment.score}/100 ("${assessment.band}" band) as at ${assessment.asOf}, by ` +
        `summing weighted signals measured against this member's own 12-month baseline` +
        (drivers.length === 0
          ? '. No signal raised risk.'
          : `. Heaviest drivers: ${drivers.join(', ')}.`),
      rowIds: [member.id],
    });
  },
};

// ─── cohort_retention ───────────────────────────────────────────────────────────────

export interface CohortRetentionParams {
  from: string;
  to: string;
}

export const cohortRetention: AnalysisTool<CohortRetentionParams> = {
  name: 'cohort_retention',
  version: '1.0.0',
  kind: 'read',
  description:
    'Of the members who JOINED within a given period, the percentage still active at the ' +
    'end of the dataset. Use for "how well did the 2023 intake stick", comparing acquisition ' +
    'cohorts, or judging whether a recruitment drive produced durable members. Returns one ' +
    'scalar in percentage points. Fails if nobody joined in the period.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
  },

  run(params: CohortRetentionParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');

    const p = periodOf(from, to);
    const cohort = ds.members.filter((m) => inPeriod(m.joinedAt, p));
    // Status is read as at the dataset's end date, not "today". The dataset is a closed
    // record; measuring retention against the wall clock would make the same cohort
    // question return a different answer tomorrow, with no new data to justify the change.
    const retained = cohort.filter((m) => m.status === 'active');

    const rate = percentOf(retained.length, cohort.length, `members joining between ${from} and ${to}`);

    return makeEvidence({
      tool: cohortRetention.name,
      version: cohortRetention.version,
      params: { from, to },
      value: { kind: 'scalar', n: rate },
      unit: 'percent',
      method:
        `Took the ${cohort.length} member(s) whose join date falls between ${from} and ${to} ` +
        `inclusive, and measured how many were still "active" as at ${ds.club.dataTo}, the ` +
        `last date this dataset covers: ${retained.length} of ${cohort.length}.`,
      rowIds: cohort.map((m) => m.id),
    });
  },
};
