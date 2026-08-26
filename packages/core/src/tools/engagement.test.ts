import { describe, expect, it } from 'vitest';
import { eventAttendanceRate, facilityUtilisation, visitTrend } from './engagement.js';
import { scalarOf } from './evidence.js';
import { FULL_YEAR, Q1, Q2, makeFixture } from './fixture.js';

const ds = makeFixture();

describe('facility_utilisation', () => {
  it('counts visits to one facility in a period', () => {
    // vis-01..vis-04 are the Q1 tennis bookings.
    expect(scalarOf(facilityUtilisation.run({ facility: 'tennis-court', ...Q1 }, ds))).toBe(4);
  });

  it('answers "tennis courts, weekday mornings"', () => {
    // Of the four Q1 tennis visits: Mon 07:30 and Tue 08:15 qualify; Sat 09:00 is a
    // weekend and Mon 18:00 is outside the 05:00-12:00 window.
    expect(
      scalarOf(
        facilityUtilisation.run(
          { facility: 'tennis-court', ...Q1, dayOfWeek: 'weekday', hourFrom: 5, hourTo: 12 },
          ds,
        ),
      ),
    ).toBe(2);
  });

  it('separates weekend from weekday traffic', () => {
    const weekend = facilityUtilisation.run(
      { facility: 'tennis-court', ...Q1, dayOfWeek: 'weekend' },
      ds,
    );
    const weekday = facilityUtilisation.run(
      { facility: 'tennis-court', ...Q1, dayOfWeek: 'weekday' },
      ds,
    );
    expect(scalarOf(weekend)).toBe(1);
    expect(scalarOf(weekday)).toBe(3);
    // The two halves must partition the unfiltered total exactly - no visit counted twice,
    // none lost to a boundary.
    expect(scalarOf(weekend) + scalarOf(weekday)).toBe(
      scalarOf(facilityUtilisation.run({ facility: 'tennis-court', ...Q1 }, ds)),
    );
  });

  it('treats hourTo as exclusive so adjacent windows tile the day', () => {
    const morning = scalarOf(
      facilityUtilisation.run({ facility: 'tennis-court', ...Q1, hourFrom: 0, hourTo: 12 }, ds),
    );
    const afternoon = scalarOf(
      facilityUtilisation.run({ facility: 'tennis-court', ...Q1, hourFrom: 12, hourTo: 24 }, ds),
    );
    expect(morning).toBe(3);
    expect(afternoon).toBe(1);
    expect(morning + afternoon).toBe(4);
  });

  it('includes a visit late on the final day of the period', () => {
    // vis-08 is a 23:30 gym check-in on 2024-03-31. If `to` resolved to midnight this
    // returns 0, and a quarterly utilisation report silently loses its last evening.
    expect(scalarOf(facilityUtilisation.run({ facility: 'fitness-centre', ...Q1 }, ds))).toBe(1);
  });

  it('stores the resolved defaults on the receipt', () => {
    // The verifier recomputes from these params, and the receipt drawer displays them, so
    // they must describe the query that actually ran rather than what the caller omitted.
    const e = facilityUtilisation.run({ facility: 'pool', ...Q1 }, ds);
    expect(e.params).toMatchObject({ facility: 'pool', dayOfWeek: 'all' });
    expect(scalarOf(e)).toBe(0);
  });

  it('insists the caller names a facility', () => {
    // Defaulting to any one facility would answer about the wrong building entirely, and
    // the receipt would look every bit as authoritative as a correct one.
    expect(() => facilityUtilisation.run({ ...Q1 } as never, ds)).toThrow(/required/);
  });

  it('rejects an inverted hour window', () => {
    expect(() =>
      facilityUtilisation.run({ facility: 'pool', ...Q1, hourFrom: 12, hourTo: 6 }, ds),
    ).toThrow(/greater than/);
  });
});

describe('visit_trend', () => {
  it('compares visit volume with the preceding equal-length period', () => {
    // Q2 holds 5 visits against Q1's 8: (5 - 8) / 8 = -37.5%.
    expect(scalarOf(visitTrend.run({ ...Q2 }, ds))).toBe(-37.5);
  });

  it('applies the facility filter to both windows', () => {
    // Tennis: 3 in Q2 against 4 in Q1 => -25%.
    expect(scalarOf(visitTrend.run({ ...Q2, facility: 'tennis-court' }, ds))).toBe(-25);
  });

  it('cites both windows', () => {
    const e = visitTrend.run({ ...Q2, facility: 'tennis-court' }, ds);
    expect(e.rowCount).toBe(7);
    expect(e.rowIds).toContain('vis-01'); // Q1 baseline
    expect(e.rowIds).toContain('vis-13'); // Q2 current
  });

  it('refuses when the preceding period had no visits', () => {
    expect(() => visitTrend.run({ ...Q1 }, ds)).toThrow(/undefined/);
  });
});

describe('event_attendance_rate', () => {
  it('divides attended by registered across events held in the period', () => {
    // The Spring Gala is Q1's only event: 3 of its 4 registrations attended.
    expect(scalarOf(eventAttendanceRate.run({ ...Q1 }, ds))).toBe(75);
  });

  it('spans every event in a wider period', () => {
    // All three events: 5 attended of 7 registered = 71.43%.
    expect(scalarOf(eventAttendanceRate.run({ ...FULL_YEAR }, ds))).toBe(71.43);
  });

  it('scopes by the date the event was held, not when people registered', () => {
    const e = eventAttendanceRate.run({ ...Q1 }, ds);
    expect(e.rowIds).toEqual(['evt-01', 'reg-01', 'reg-02', 'reg-03', 'reg-04']);
    expect(e.rowCount).toBe(5);
    expect(e.unit).toBe('percent');
  });

  it('refuses a period with no registrations rather than reporting 0%', () => {
    // "0% turned up" and "nothing was on" are different facts, and only one of them would
    // send a GM looking for a programming problem.
    expect(() => eventAttendanceRate.run({ from: '2024-01-01', to: '2024-02-29' }, ds)).toThrow(
      /undefined/,
    );
  });
});
