import type { ClubDataset } from '../domain/types.js';

/**
 * Hand-written dataset for the analysis-tool tests.
 *
 * Deliberately tiny and deliberately not generated. Every figure the tool tests assert is
 * arithmetic a reviewer can redo on paper from the tables below, which is the only way a
 * test of an aggregation proves anything: a test that recomputes the expectation using the
 * same code path it is testing proves only that the code is self-consistent.
 *
 * It also carries the edge cases on purpose:
 *  - a visit at 23:30 on the last day of Q1, which a naive `to`-is-midnight bound drops;
 *  - a resigned member (m3) who still spent money, so population-consistency bugs surface;
 *  - Q2 2024, whose immediately-preceding equal-length window is exactly Q1 2024 (91 days
 *    each, 2024 being a leap year) - so trend expectations are checkable by inspection;
 *  - three members (m7, m8, m9) shaped to land in distinct churn bands, so a threshold bug
 *    in the cohort tools cannot hide behind every member scoring the same. They carry
 *    visits and notes but no transactions, deliberately, so the revenue arithmetic above
 *    stays exactly as written.
 */

export const M1 = 'mem-001';
export const M2 = 'mem-002';
export const M3 = 'mem-003';
export const M4 = 'mem-004';
export const M5 = 'mem-005';
export const M6 = 'mem-006';
export const M7 = 'mem-007';
export const M8 = 'mem-008';
export const M9 = 'mem-009';

/** Q1 2024. 91 days. */
export const Q1 = { from: '2024-01-01', to: '2024-03-31' } as const;
/** Q2 2024. Also 91 days, so its preceding equal-length window is exactly Q1. */
export const Q2 = { from: '2024-04-01', to: '2024-06-30' } as const;
export const FULL_YEAR = { from: '2024-01-01', to: '2024-12-31' } as const;

export function makeFixture(): ClubDataset {
  return {
    club: {
      name: 'Harbourview Club',
      kind: 'country',
      city: 'Sydney',
      foundedYear: 1923,
      dataFrom: '2024-01-01',
      dataTo: '2024-12-31',
    },

    // 9 members: 7 active (m1, m2, m4, m5, m7, m8, m9), 1 resigned (m3), 1 suspended (m6).
    members: [
      {
        id: M1,
        memberNo: 'M-001',
        firstName: 'Ada',
        lastName: 'Chen',
        email: 'ada@example.test',
        category: 'full-golf',
        status: 'active',
        joinedAt: '2019-03-15',
        householdSize: 2,
        ageBand: '50-64',
        annualDues: 12_000,
        homeCity: 'Sydney',
        joinedVia: 'referral',
      },
      {
        id: M2,
        memberNo: 'M-002',
        firstName: 'Ben',
        lastName: 'Ortiz',
        email: 'ben@example.test',
        category: 'social',
        status: 'active',
        joinedAt: '2024-02-01',
        householdSize: 1,
        ageBand: '35-49',
        annualDues: 3_000,
        homeCity: 'Sydney',
        joinedVia: 'waitlist',
      },
      {
        id: M3,
        memberNo: 'M-003',
        firstName: 'Cara',
        lastName: 'Diaz',
        email: 'cara@example.test',
        category: 'full-golf',
        status: 'resigned',
        joinedAt: '2021-06-10',
        resignedAt: '2024-11-20',
        householdSize: 3,
        ageBand: '35-49',
        annualDues: 12_000,
        homeCity: 'Newcastle',
        joinedVia: 'event',
      },
      {
        id: M4,
        memberNo: 'M-004',
        firstName: 'Dan',
        lastName: 'Reid',
        email: 'dan@example.test',
        category: 'corporate',
        status: 'active',
        joinedAt: '2024-03-05',
        householdSize: 1,
        ageBand: '20-34',
        annualDues: 8_000,
        homeCity: 'Sydney',
        joinedVia: 'corporate',
      },
      {
        id: M5,
        memberNo: 'M-005',
        firstName: 'Eve',
        lastName: 'Novak',
        email: 'eve@example.test',
        category: 'social',
        status: 'active',
        joinedAt: '2015-09-01',
        householdSize: 4,
        ageBand: '65+',
        annualDues: 3_000,
        homeCity: 'Sydney',
        joinedVia: 'legacy',
      },
      {
        id: M6,
        memberNo: 'M-006',
        firstName: 'Finn',
        lastName: 'Adler',
        email: 'finn@example.test',
        category: 'junior-executive',
        status: 'suspended',
        joinedAt: '2024-04-18',
        householdSize: 2,
        ageBand: '20-34',
        annualDues: 4_500,
        homeCity: 'Sydney',
        joinedVia: 'referral',
      },
      // Churn band: CRITICAL. Joined mid-year, never once came in, one negative note on
      // file - the profile of a new member the club has already lost and not yet noticed.
      {
        id: M7,
        memberNo: 'M-007',
        firstName: 'Gina',
        lastName: 'Hart',
        email: 'gina@example.test',
        category: 'full-golf',
        status: 'active',
        joinedAt: '2024-06-01',
        householdSize: 2,
        ageBand: '35-49',
        annualDues: 12_000,
        homeCity: 'Sydney',
        joinedVia: 'waitlist',
      },
      // Churn band: LOW. Long tenure, in regularly through the final quarter, brings guests.
      {
        id: M8,
        memberNo: 'M-008',
        firstName: 'Hugo',
        lastName: 'Lang',
        email: 'hugo@example.test',
        category: 'social',
        status: 'active',
        joinedAt: '2015-04-20',
        householdSize: 3,
        ageBand: '50-64',
        annualDues: 3_000,
        homeCity: 'Sydney',
        joinedVia: 'legacy',
      },
      // Churn band: WATCH. Not gone, just quiet since September - the cohort worth a call.
      {
        id: M9,
        memberNo: 'M-009',
        firstName: 'Iris',
        lastName: 'Bell',
        email: 'iris@example.test',
        category: 'corporate',
        status: 'active',
        joinedAt: '2022-01-10',
        householdSize: 1,
        ageBand: '35-49',
        annualDues: 8_000,
        homeCity: 'Wollongong',
        joinedVia: 'corporate',
      },
    ],

    // Q1 total 2,500 (dues 1,000 / dining 900 / pro-shop 300 / lessons 200 / bar 100).
    // Q2 total 2,750. H2 total 1,540. Full year 6,790.
    transactions: [
      { id: 'txn-01', memberId: M1, date: '2024-01-15', category: 'dining', amount: 400 },
      { id: 'txn-02', memberId: M1, date: '2024-02-10', category: 'dues', amount: 1_000 },
      { id: 'txn-03', memberId: M2, date: '2024-02-20', category: 'bar', amount: 100 },
      { id: 'txn-04', memberId: M3, date: '2024-03-05', category: 'dining', amount: 500 },
      { id: 'txn-05', memberId: M5, date: '2024-03-28', category: 'pro-shop', amount: 300 },
      { id: 'txn-06', memberId: M1, date: '2024-03-31', category: 'lessons', amount: 200 },

      { id: 'txn-07', memberId: M1, date: '2024-04-10', category: 'dining', amount: 600 },
      { id: 'txn-08', memberId: M3, date: '2024-04-22', category: 'dining', amount: 500 },
      { id: 'txn-09', memberId: M1, date: '2024-05-15', category: 'dues', amount: 1_000 },
      { id: 'txn-10', memberId: M2, date: '2024-05-20', category: 'bar', amount: 150 },
      { id: 'txn-11', memberId: M4, date: '2024-06-01', category: 'guest-fees', amount: 250 },
      { id: 'txn-12', memberId: M5, date: '2024-06-30', category: 'events', amount: 250 },

      { id: 'txn-13', memberId: M1, date: '2024-08-14', category: 'dining', amount: 700 },
      { id: 'txn-14', memberId: M5, date: '2024-09-09', category: 'dining', amount: 200 },
      { id: 'txn-15', memberId: M3, date: '2024-10-02', category: 'pro-shop', amount: 150 },
      { id: 'txn-16', memberId: M2, date: '2024-11-11', category: 'bar', amount: 90 },
      { id: 'txn-17', memberId: M1, date: '2024-12-20', category: 'events', amount: 400 },
    ],

    // Q1 holds 8 visits (4 of them tennis), Q2 holds 5 (3 of them tennis).
    visits: [
      // Mon 07:00 - weekday morning tennis.
      { id: 'vis-01', memberId: M1, at: '2024-01-08T07:30:00.000Z', facility: 'tennis-court', guests: 0, durationMin: 60 },
      // Tue 08:00 - weekday morning tennis.
      { id: 'vis-02', memberId: M2, at: '2024-01-09T08:15:00.000Z', facility: 'tennis-court', guests: 1, durationMin: 45 },
      // Sat 09:00 - weekend, so excluded from any weekday filter.
      { id: 'vis-03', memberId: M5, at: '2024-01-13T09:00:00.000Z', facility: 'tennis-court', guests: 0, durationMin: 60 },
      // Mon 18:00 - weekday but evening, so excluded from a morning hour window.
      { id: 'vis-04', memberId: M1, at: '2024-01-15T18:00:00.000Z', facility: 'tennis-court', guests: 0, durationMin: 90 },
      { id: 'vis-05', memberId: M1, at: '2024-02-05T06:45:00.000Z', facility: 'golf-course', guests: 2, durationMin: 240 },
      { id: 'vis-06', memberId: M3, at: '2024-02-12T10:00:00.000Z', facility: 'golf-course', guests: 0, durationMin: 200 },
      { id: 'vis-07', memberId: M5, at: '2024-03-20T12:30:00.000Z', facility: 'dining-room', guests: 3, durationMin: 75 },
      // 23:30 on the final day of Q1 - the boundary a naive `to` bound silently drops.
      { id: 'vis-08', memberId: M4, at: '2024-03-31T23:30:00.000Z', facility: 'fitness-centre', guests: 0, durationMin: 45 },

      { id: 'vis-09', memberId: M2, at: '2024-04-02T07:00:00.000Z', facility: 'tennis-court', guests: 0, durationMin: 60 },
      { id: 'vis-10', memberId: M1, at: '2024-05-06T08:00:00.000Z', facility: 'tennis-court', guests: 1, durationMin: 60 },
      { id: 'vis-11', memberId: M1, at: '2024-06-10T09:30:00.000Z', facility: 'golf-course', guests: 0, durationMin: 210 },
      { id: 'vis-12', memberId: M5, at: '2024-06-15T10:00:00.000Z', facility: 'pool', guests: 2, durationMin: 90 },
      { id: 'vis-13', memberId: M2, at: '2024-06-25T07:15:00.000Z', facility: 'tennis-court', guests: 0, durationMin: 45 },

      // m8 and m9 are engagement-shaped, not revenue-shaped: every visit below sits in the
      // second half of 2024, outside Q1 and Q2, so it drives their churn bands without
      // disturbing a single figure the revenue or utilisation tests assert.
      { id: 'vis-14', memberId: M8, at: '2024-07-08T10:00:00.000Z', facility: 'pool', guests: 0, durationMin: 60 },
      { id: 'vis-15', memberId: M8, at: '2024-08-14T10:00:00.000Z', facility: 'dining-room', guests: 1, durationMin: 80 },
      { id: 'vis-16', memberId: M8, at: '2024-10-15T10:00:00.000Z', facility: 'pool', guests: 2, durationMin: 60 },
      { id: 'vis-17', memberId: M8, at: '2024-11-05T10:00:00.000Z', facility: 'dining-room', guests: 2, durationMin: 90 },
      { id: 'vis-18', memberId: M8, at: '2024-11-20T10:00:00.000Z', facility: 'pool', guests: 1, durationMin: 60 },
      { id: 'vis-19', memberId: M8, at: '2024-12-10T10:00:00.000Z', facility: 'dining-room', guests: 0, durationMin: 75 },
      { id: 'vis-20', memberId: M9, at: '2024-08-05T09:00:00.000Z', facility: 'fitness-centre', guests: 0, durationMin: 50 },
      { id: 'vis-21', memberId: M9, at: '2024-09-17T09:00:00.000Z', facility: 'fitness-centre', guests: 0, durationMin: 50 },
    ],

    events: [
      { id: 'evt-01', name: 'Spring Gala', date: '2024-03-15', kind: 'social', capacity: 100 },
      { id: 'evt-02', name: 'Club Championship', date: '2024-05-18', kind: 'tournament', capacity: 60 },
      { id: 'evt-03', name: 'Winter Dinner', date: '2024-07-20', kind: 'dining', capacity: 40 },
    ],

    // evt-01: 3 of 4 attended. Across all three events: 5 of 7.
    registrations: [
      { id: 'reg-01', eventId: 'evt-01', memberId: M1, attended: true, guests: 1 },
      { id: 'reg-02', eventId: 'evt-01', memberId: M2, attended: true, guests: 0 },
      { id: 'reg-03', eventId: 'evt-01', memberId: M3, attended: false, guests: 0 },
      { id: 'reg-04', eventId: 'evt-01', memberId: M5, attended: true, guests: 2 },
      { id: 'reg-05', eventId: 'evt-02', memberId: M1, attended: true, guests: 0 },
      { id: 'reg-06', eventId: 'evt-02', memberId: M4, attended: false, guests: 0 },
      { id: 'reg-07', eventId: 'evt-03', memberId: M5, attended: true, guests: 0 },
    ],

    // Three notes contain "slow" in three different cases and contexts; only one pairs it
    // with "service", which is what makes the AND-over-terms behaviour observable.
    notes: [
      {
        id: 'note-01',
        memberId: M1,
        date: '2024-02-14',
        author: 'Front Desk',
        channel: 'front-desk',
        sentiment: 'negative',
        body: 'Complained that the tennis court booking system is slow and double-booked him twice.',
      },
      {
        id: 'note-02',
        memberId: M3,
        date: '2024-09-02',
        author: 'M. Reyes',
        channel: 'email',
        sentiment: 'negative',
        body: 'Says the golf course conditions have declined; considering resigning at renewal.',
      },
      {
        id: 'note-03',
        memberId: M5,
        date: '2024-05-30',
        author: 'A. Bell',
        channel: 'survey',
        sentiment: 'positive',
        body: 'Loves the new pool hours. Slow service in the dining room on Sundays though.',
      },
      {
        id: 'note-04',
        memberId: M2,
        date: '2024-08-08',
        author: 'Front Desk',
        channel: 'front-desk',
        sentiment: 'neutral',
        body: 'Asked about upgrading to a full golf membership next season.',
      },
      {
        id: 'note-05',
        memberId: M4,
        date: '2024-10-15',
        author: 'J. Patel',
        channel: 'phone',
        sentiment: 'negative',
        body: 'Frustrated by slow response to his corporate event enquiry.',
      },
      {
        id: 'note-06',
        memberId: M7,
        date: '2024-11-08',
        author: 'Membership Office',
        channel: 'committee',
        sentiment: 'negative',
        body: 'Joined in June and has never been on site; welcome call went unanswered.',
      },
    ],
  };
}

/**
 * A fixture with more than 500 transactions in a single period.
 *
 * Its only job is to exercise the receipt's display cap: `makeEvidence` truncates the
 * stored `rowIds` at 500 while `rowCount` must keep telling the truth about how many rows
 * the figure actually consumed. That distinction is load-bearing - a receipt that quietly
 * reported 500 when it had summed 640 rows would be understating its own scope.
 */
export function makeWideFixture(transactionCount = 640): ClubDataset {
  const ds = makeFixture();
  return {
    ...ds,
    transactions: Array.from({ length: transactionCount }, (_, i) => ({
      id: `wide-txn-${String(i).padStart(4, '0')}`,
      memberId: M1,
      // Spread deterministically across January 2024 so every row lands inside Q1.
      date: `2024-01-${String((i % 31) + 1).padStart(2, '0')}`,
      category: 'dining' as const,
      amount: 10,
    })),
  };
}

/** Every row id present in a dataset - the ground truth for evidence-integrity checks. */
export function allRowIds(ds: ClubDataset): Set<string> {
  return new Set<string>([
    ...ds.members.map((m) => m.id),
    ...ds.transactions.map((t) => t.id),
    ...ds.visits.map((v) => v.id),
    ...ds.events.map((e) => e.id),
    ...ds.registrations.map((r) => r.id),
    ...ds.notes.map((n) => n.id),
  ]);
}
