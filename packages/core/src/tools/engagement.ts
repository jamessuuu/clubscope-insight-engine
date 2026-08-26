import type { ClubDataset, FacilityKind, Visit } from '../domain/types.js';
import {
  type AnalysisTool,
  type Evidence,
  makeEvidence,
  type ToolParamSpec,
} from './evidence.js';
import {
  FACILITIES,
  FROM_PARAM,
  hourOrUndefined,
  inPeriod,
  isoDate,
  oneOf,
  optionalOneOf,
  percentChange,
  percentOf,
  periodOf,
  precedingPeriod,
  requiredOneOf,
  TO_PARAM,
  type Period,
} from './common.js';

/**
 * Utilisation and engagement tools.
 *
 * ## Why weekday and hour are read in UTC
 *
 * A visit timestamp is an instant. Deriving "was this a weekday morning" through
 * `Date#getHours` would resolve it against whatever timezone the process happens to run in,
 * so the same question would return a different number on a laptop in Sydney and a server
 * in Virginia - and the verifier, re-running the tool elsewhere, would flag a perfectly
 * honest figure as fabricated. Reading in UTC makes the answer machine-independent, which
 * is the property the grounding contract actually depends on.
 *
 * This dataset stores club-local wall time as UTC instants, so the two coincide. A
 * production deployment would carry an explicit club timezone on the club record and
 * convert once, at this boundary - the fix belongs here, not in the caller.
 */

export const DAY_FILTERS = ['weekday', 'weekend', 'all'] as const;
export type DayFilter = (typeof DAY_FILTERS)[number];

const FACILITY_PARAM_OPTIONAL = {
  type: 'enum',
  description:
    'Optional facility filter (golf-course, tennis-court, dining-room, fitness-centre, ' +
    'pool, marina-berth). Omit to count visits to every facility.',
  enum: [...FACILITIES],
  required: false,
} satisfies ToolParamSpec;

function matchesDayFilter(at: string, filter: DayFilter): boolean {
  if (filter === 'all') return true;
  const day = new Date(at).getUTCDay();
  const isWeekend = day === 0 || day === 6;
  return filter === 'weekend' ? isWeekend : !isWeekend;
}

function matchesHourWindow(at: string, hourFrom?: number, hourTo?: number): boolean {
  if (hourFrom === undefined && hourTo === undefined) return true;
  const hour = new Date(at).getUTCHours();
  // Half-open by design: hourFrom 5, hourTo 12 means "05:00 up to but not including 12:00",
  // so morning and afternoon windows tile the day without double-counting the 11th hour.
  if (hourFrom !== undefined && hour < hourFrom) return false;
  if (hourTo !== undefined && hour >= hourTo) return false;
  return true;
}

function visitsIn(
  ds: ClubDataset,
  p: Period,
  facility: FacilityKind | undefined,
  dayOfWeek: DayFilter,
  hourFrom?: number,
  hourTo?: number,
): Visit[] {
  return ds.visits.filter(
    (v) =>
      inPeriod(v.at, p) &&
      (facility === undefined || v.facility === facility) &&
      matchesDayFilter(v.at, dayOfWeek) &&
      matchesHourWindow(v.at, hourFrom, hourTo),
  );
}

function describeWindow(dayOfWeek: DayFilter, hourFrom?: number, hourTo?: number): string {
  const day =
    dayOfWeek === 'all' ? 'any day' : dayOfWeek === 'weekend' ? 'weekends only' : 'weekdays only';
  if (hourFrom === undefined && hourTo === undefined) return `${day}, any hour`;
  const lo = String(hourFrom ?? 0).padStart(2, '0');
  const hi = String(hourTo ?? 24).padStart(2, '0');
  return `${day}, ${lo}:00 up to ${hi}:00`;
}

// ─── facility_utilisation ───────────────────────────────────────────────────────────

export interface FacilityUtilisationParams {
  facility: FacilityKind;
  from: string;
  to: string;
  dayOfWeek?: DayFilter;
  hourFrom?: number;
  hourTo?: number;
}

export const facilityUtilisation: AnalysisTool<FacilityUtilisationParams> = {
  name: 'facility_utilisation',
  version: '1.0.0',
  kind: 'read',
  description:
    'Number of recorded visits to one facility over an inclusive date period, optionally ' +
    'narrowed to weekdays or weekends and to a range of hours. Use for "how busy are the ' +
    'tennis courts on weekday mornings", off-peak capacity questions, and under-utilisation ' +
    'checks. hourFrom is inclusive and hourTo is exclusive, so 5 and 12 mean 05:00 up to ' +
    '12:00. Returns one scalar count of visits (not unique members).',
  params: {
    facility: {
      type: 'enum',
      description:
        'The facility to measure: golf-course, tennis-court, dining-room, fitness-centre, ' +
        'pool or marina-berth.',
      enum: [...FACILITIES],
      required: true,
    },
    from: FROM_PARAM,
    to: TO_PARAM,
    dayOfWeek: {
      type: 'enum',
      description:
        'Restrict to "weekday" (Mon-Fri), "weekend" (Sat-Sun), or "all". Defaults to "all".',
      enum: [...DAY_FILTERS],
      required: false,
      default: 'all',
    },
    hourFrom: {
      type: 'number',
      description: 'Optional inclusive start hour, 0-24. Use 5 with hourTo 12 for mornings.',
      required: false,
    },
    hourTo: {
      type: 'number',
      description: 'Optional exclusive end hour, 0-24. Use 12 with hourFrom 5 for mornings.',
      required: false,
    },
  },

  run(params: FacilityUtilisationParams, ds: ClubDataset): Evidence {
    const facility = requiredOneOf(params.facility, 'facility', FACILITIES);
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');
    const dayOfWeek = oneOf(params.dayOfWeek, 'dayOfWeek', DAY_FILTERS, 'all');
    const hourFrom = hourOrUndefined(params.hourFrom, 'hourFrom');
    const hourTo = hourOrUndefined(params.hourTo, 'hourTo');
    if (hourFrom !== undefined && hourTo !== undefined && hourTo <= hourFrom) {
      throw new Error('"hourTo" must be greater than "hourFrom"');
    }

    const rows = visitsIn(ds, periodOf(from, to), facility, dayOfWeek, hourFrom, hourTo);

    return makeEvidence({
      tool: facilityUtilisation.name,
      version: facilityUtilisation.version,
      // Resolved defaults are stored, not the caller's omissions, so the receipt states the
      // query that was actually run and the verifier recomputes exactly that query.
      params: { facility, from, to, dayOfWeek, hourFrom, hourTo },
      value: { kind: 'scalar', n: rows.length },
      unit: 'count',
      method:
        `Counted check-ins at the ${facility.replace(/-/g, ' ')} between ${from} and ${to} ` +
        `inclusive, restricted to ${describeWindow(dayOfWeek, hourFrom, hourTo)}. Each row ` +
        `is one visit, so a member visiting twice counts twice.`,
      rowIds: rows.map((v) => v.id),
    });
  },
};

// ─── visit_trend ────────────────────────────────────────────────────────────────────

export interface VisitTrendParams {
  from: string;
  to: string;
  facility?: FacilityKind;
}

export const visitTrend: AnalysisTool<VisitTrendParams> = {
  name: 'visit_trend',
  version: '1.0.0',
  kind: 'read',
  description:
    'Percent change in visit volume between a period and the equal-length period ' +
    'immediately before it, optionally for a single facility. Use for "is engagement ' +
    'falling", "are the courts getting quieter", or any footfall growth question. Returns ' +
    'one scalar in percentage points, negative for a decline. Fails if there were no visits ' +
    'in the preceding period, because percent change from zero is undefined.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
    facility: FACILITY_PARAM_OPTIONAL,
  },

  run(params: VisitTrendParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');
    const facility = optionalOneOf(params.facility, 'facility', FACILITIES);

    const current = periodOf(from, to);
    const previous = precedingPeriod(current);
    const currentRows = visitsIn(ds, current, facility, 'all');
    const previousRows = visitsIn(ds, previous, facility, 'all');

    const change = percentChange(currentRows.length, previousRows.length);

    return makeEvidence({
      tool: visitTrend.name,
      version: visitTrend.version,
      params: { from, to, facility },
      value: { kind: 'scalar', n: change },
      unit: 'percent',
      method:
        `Compared ${currentRows.length} visits between ${from} and ${to} against ` +
        `${previousRows.length} visits in the equal-length period immediately before it` +
        (facility === undefined
          ? ' across all facilities'
          : `, at the ${facility.replace(/-/g, ' ')}`) +
        '. Both windows span the same number of days.',
      rowIds: [...currentRows.map((v) => v.id), ...previousRows.map((v) => v.id)],
    });
  },
};

// ─── event_attendance_rate ──────────────────────────────────────────────────────────

export interface EventAttendanceRateParams {
  from: string;
  to: string;
}

export const eventAttendanceRate: AnalysisTool<EventAttendanceRateParams> = {
  name: 'event_attendance_rate',
  version: '1.0.0',
  kind: 'read',
  description:
    'Share of event registrations that resulted in actual attendance, across every club ' +
    'event held in an inclusive date period. Use for "are people turning up", no-show ' +
    'problems, or judging programming quality. Returns one scalar in percentage points. ' +
    'Fails if no registrations exist in the period, because a rate with no denominator is ' +
    'undefined.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
  },

  run(params: EventAttendanceRateParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');

    const p = periodOf(from, to);
    // Events are scoped by the date they were HELD, not the date somebody registered:
    // a registration taken in March for an April dinner belongs to April's turnout.
    const events = ds.events.filter((e) => inPeriod(e.date, p));
    const eventIds = new Set(events.map((e) => e.id));
    const registrations = ds.registrations.filter((r) => eventIds.has(r.eventId));
    const attended = registrations.filter((r) => r.attended);

    const rate = percentOf(
      attended.length,
      registrations.length,
      `event registrations between ${from} and ${to}`,
    );

    return makeEvidence({
      tool: eventAttendanceRate.name,
      version: eventAttendanceRate.version,
      params: { from, to },
      value: { kind: 'scalar', n: rate },
      unit: 'percent',
      method:
        `Across the ${events.length} event(s) held between ${from} and ${to} inclusive, ` +
        `${attended.length} of ${registrations.length} registrations were marked attended. ` +
        `Guests are excluded: the rate measures whether the registered member turned up.`,
      // Both the events that defined the scope and the registrations that were counted, so
      // the receipt answers "which events" and "which registrations" without a second query.
      rowIds: [...events.map((e) => e.id), ...registrations.map((r) => r.id)],
    });
  },
};
