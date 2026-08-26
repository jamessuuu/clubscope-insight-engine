import type {
  ClubDataset,
  ClubEvent,
  EventRegistration,
  FacilityKind,
  Member,
  MemberNote,
  MembershipCategory,
  RevenueCategory,
  Transaction,
  Visit,
} from '../domain/types.js';
import { Rng, weightedSampleWithoutReplacement } from './rng.js';

/**
 * Synthetic club dataset generator.
 *
 * ## What this file is actually for
 *
 * A demo dataset can be honest or it can be flattering, and the difference decides whether
 * the demo proves anything. Pure noise makes every insight the engine "finds" a fluke.
 * Hand-written aggregates with nothing underneath make every insight trivial. Neither tells
 * you whether the analysis layer works.
 *
 * So this generator does three things deliberately:
 *
 * 1. **It simulates behaviour, never aggregates.** Members have a category, an engagement
 *    level, a life cycle and a calendar. Visits fall out of a daily process shaped by
 *    weekday, season and facility; spend falls out of visits. Nothing is written directly
 *    into a total. That means every figure the insight engine computes is emergent, and a
 *    bug in the analysis layer shows up as a wrong number rather than as a number that
 *    happens to match a hard-coded fixture.
 * 2. **It plants a small number of true causes.** Four of them (`PLANTED_ANOMALIES`), each
 *    with an in-world explanation, each expressed as a *behaviour change* rather than an
 *    injected total. They are kept deliberately orthogonal - different facilities, different
 *    revenue categories, different windows - so a finding can be attributed to exactly one
 *    cause and the eval suite can score attribution rather than mere detection.
 * 3. **It refuses to make the signal clean.** About a third of resignations arrive with no
 *    warning at all, and roughly thirty members decay hard and then stay. Both happen in
 *    real club data, and both mean the churn model can and will be wrong here. A fixture on
 *    which precision and recall are 1.0 is a fixture that proves nothing.
 *
 * ## Approximate volume at the default seed
 *
 * ~420 members, ~47k visits, ~63k transactions, ~104 events, ~9.4k registrations, ~1.2k notes.
 * Sized so that naive per-row scanning in the analysis layer is a real performance decision,
 * and small enough to hold in memory and ship to a browser.
 */

// ── Calendar ──────────────────────────────────────────────────────────────────────────
//
// Every date is computed in UTC. Local-time arithmetic would make the dataset depend on the
// machine's timezone and on whether a given day crossed a DST boundary - exactly the class
// of non-determinism this module exists to eliminate.

const MS_PER_DAY = 86_400_000;

const WINDOW_FROM = '2024-09-01';
const WINDOW_TO = '2026-08-31';

function dayStart(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoDateTime(ms: number): string {
  return new Date(ms).toISOString();
}

const WINDOW_FROM_MS = dayStart(WINDOW_FROM);
const WINDOW_TO_MS = dayStart(WINDOW_TO);
const WINDOW_DAYS = Math.round((WINDOW_TO_MS - WINDOW_FROM_MS) / MS_PER_DAY) + 1;

interface DaySlot {
  ms: number;
  /** 0 = Sunday, matching the rhythm tables below. */
  dow: number;
  /** 1-12. */
  month: number;
  year: number;
}

/**
 * Every day in the window, precomputed once.
 *
 * The visit simulation touches ~420 members x 730 days x 5 facilities. Constructing a Date
 * inside that loop to ask for the weekday is the difference between a generator that runs in
 * a tenth of a second and one that stalls a test run.
 */
const DAYS: readonly DaySlot[] = Array.from({ length: WINDOW_DAYS }, (_, i) => {
  const ms = WINDOW_FROM_MS + i * MS_PER_DAY;
  const d = new Date(ms);
  return { ms, dow: d.getUTCDay(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
});

interface MonthSlot {
  year: number;
  /** 1-12. */
  month: number;
  startMs: number;
  endMs: number;
  days: number;
}

/** The 24 calendar months covered by the window, in order. */
const MONTHS: readonly MonthSlot[] = (() => {
  const out: MonthSlot[] = [];
  let year = new Date(WINDOW_FROM_MS).getUTCFullYear();
  let month = new Date(WINDOW_FROM_MS).getUTCMonth() + 1;
  while (Date.UTC(year, month - 1, 1) <= WINDOW_TO_MS) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    out.push({
      year,
      month,
      startMs: Date.UTC(year, month - 1, 1),
      endMs: Date.UTC(year, month - 1, days),
      days,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
})();

// ── Planted ground truth ──────────────────────────────────────────────────────────────

export type PlantedAnomalyKind =
  | 'revenue-decline'
  | 'under-utilisation'
  | 'cohort-churn'
  | 'revenue-surge';

export interface PlantedAnomaly {
  id: string;
  title: string;
  kind: PlantedAnomalyKind;
  /** Inclusive ISO window in which the anomaly is observable. */
  from: string;
  to: string;
  /** What a correct finding must say. Used to grade the insight engine's narrative. */
  expectedFinding: string;
  /**
   * The in-world cause. Deliberately *not* stated anywhere in the dataset as a field - it is
   * only inferrable from staff notes and timing - so it can be used to score root-cause
   * reasoning rather than pattern matching.
   */
  cause: string;
  /**
   * A machine-checkable expectation. The eval suite and `generate.test.ts` both assert
   * against it, so a change to the generator that quietly erases the thing the demo claims
   * to find fails a test instead of becoming a lie on stage.
   */
  metric: {
    name: string;
    unit: 'percent-change' | 'share' | 'ratio';
    /** Measured against DEFAULT_SEED; see generate.test.ts for the exact computation. */
    expected: number;
    tolerance: number;
  };
}

/**
 * The four true things in this dataset.
 *
 * The magnitudes below were measured from the generated data at the default seed, not
 * guessed from the knobs - the knobs interact (a decaying member both visits less and spends
 * less per visit), so the only honest source for these numbers is the output itself.
 */
export const PLANTED_ANOMALIES: readonly PlantedAnomaly[] = [
  {
    id: 'dining-decline-2026',
    title: 'Sustained dining revenue decline from February 2026',
    kind: 'revenue-decline',
    from: '2026-02-01',
    to: WINDOW_TO,
    expectedFinding:
      'Dining revenue from February 2026 onward is roughly a fifth below the same months a year earlier, and the fall is sustained rather than one bad month. Negative food-and-beverage notes cluster in the same period.',
    cause:
      'The executive chef left at the end of January 2026. Covers fell and average spend per cover fell with them; members report that the menu and the service have not recovered.',
    metric: {
      name: 'dining revenue, Feb-Aug 2026 vs Feb-Aug 2025',
      unit: 'percent-change',
      expected: -0.21,
      tolerance: 0.07,
    },
  },
  {
    id: 'tennis-weekday-mornings',
    title: 'Tennis courts are effectively unused on weekday mornings',
    kind: 'under-utilisation',
    from: WINDOW_FROM,
    to: WINDOW_TO,
    expectedFinding:
      'Monday to Friday before 11am accounts for a negligible share of court usage across the whole two years, despite being roughly a quarter of staffed court hours. That capacity is real, standing, and already paid for.',
    cause:
      'There is no weekday-morning programming. Clinics, ladder play and the professional lesson block are all scheduled from late afternoon, so the mornings were never given a reason to exist.',
    metric: {
      name: 'share of tennis visits starting Mon-Fri before 11:00',
      unit: 'share',
      expected: 0.019,
      tolerance: 0.012,
    },
  },
  {
    id: 'q1-2025-joiner-cohort',
    title: 'The Q1 2025 joiner cohort churns at roughly double the rate of other joiners',
    kind: 'cohort-churn',
    from: '2025-01-01',
    to: WINDOW_TO,
    expectedFinding:
      'Members who joined between January and March 2025 have resigned at about twice the rate of members who joined elsewhere in the window, and their first-90-day visit counts are less than half those of other new members. The failure is onboarding, not acquisition.',
    cause:
      'A discounted membership drive in Q1 2025 produced an unusually large intake in a single quarter. Member services did not scale with it: the new members were never introduced to a group, and most never established a reason to come back.',
    metric: {
      name: 'Q1-2025 cohort resignation rate divided by the rate among other in-window joiners',
      unit: 'ratio',
      expected: 2.03,
      tolerance: 0.5,
    },
  },
  {
    id: 'guest-fee-surge-2026',
    title: 'Guest fee revenue surged in summer 2026',
    kind: 'revenue-surge',
    from: '2026-06-01',
    to: '2026-08-31',
    expectedFinding:
      'Guest fees in June-August 2026 are materially above the same three months in 2025, and the increase is concentrated in golf and pool rather than spread across all facilities.',
    cause:
      'A reciprocal arrangement with two neighbouring clubs went live in May 2026, alongside a summer bring-a-guest promotion on the golf course. Worth flagging in both directions: it is incremental revenue, and it is also peak-season tee time being given away.',
    metric: {
      name: 'guest-fee revenue, Jun-Aug 2026 vs Jun-Aug 2025',
      unit: 'percent-change',
      expected: 0.55,
      tolerance: 0.2,
    },
  },
];

/** The chef leaves at the end of January 2026; everything downstream keys off this date. */
const CHEF_DEPARTURE_MS = dayStart('2026-02-01');
/** Reciprocal-club programme plus the summer bring-a-guest promotion. */
const GUEST_SURGE_FROM_MS = dayStart('2026-06-01');
const GUEST_SURGE_TO_MS = dayStart('2026-08-31');
/** The discounted membership drive that produced the weak cohort. */
const DRIVE_FROM_MS = dayStart('2025-01-01');
const DRIVE_TO_MS = dayStart('2025-03-31');

/**
 * The dining decline is modelled with two levers rather than one. A chef departure shows up
 * both as fewer covers and as smaller cheques, and reproducing only one of those would give
 * a decline that any competent analyst could immediately tell was synthetic.
 */
const DINING_VISITS_AFTER_CHEF = 0.90;
const DINING_CHEQUE_AFTER_CHEF = 0.90;
/** The bar suffers far less: people still drink when the kitchen is mediocre. */
const BAR_AFTER_CHEF = 0.95;

/**
 * Guest-fee surge multipliers, applied only to golf and pool.
 *
 * Keeping the surge off dining is a deliberate separation of concerns: if summer guests also
 * inflated food spend, the dining decline and the guest surge would contaminate each other
 * and neither anomaly could be cleanly attributed. Real signals do overlap, but a fixture
 * whose planted causes are inseparable cannot be used to score attribution.
 */
const GUEST_SURGE_GOLF = 1.6;
const GUEST_SURGE_POOL = 1.4;
/** Probability that a surge-period guest visit brings one extra guest along. */
const GUEST_SURGE_EXTRA = 0.28;

// ── Club identity ─────────────────────────────────────────────────────────────────────

const CLUB = {
  name: 'Windermere Hills Country Club',
  kind: 'country',
  city: 'Dallas, Texas',
  foundedYear: 1962,
  dataFrom: WINDOW_FROM,
  dataTo: WINDOW_TO,
} as const;

const TOTAL_MEMBERS = 420;

/**
 * A country club has no marina. Carrying `marina-berth` through the tables with a zero
 * weight would put a facility in the type system that never appears in the data, and the
 * first thing an analysis tool would do is confidently report 0% marina utilisation for a
 * club that has no water. Narrowing the type instead keeps the dataset honest.
 */
type ClubFacility = Exclude<FacilityKind, 'marina-berth'>;

const CLUB_FACILITIES: readonly ClubFacility[] = [
  'golf-course',
  'tennis-court',
  'dining-room',
  'fitness-centre',
  'pool',
];

// ── Reference pools ───────────────────────────────────────────────────────────────────

const FIRST_NAMES: readonly string[] = [
  'Robert', 'Katherine', 'James', 'Margaret', 'William', 'Susan', 'Charles', 'Elizabeth',
  'Thomas', 'Patricia', 'Richard', 'Nancy', 'Edward', 'Barbara', 'Michael', 'Linda',
  'David', 'Carolyn', 'Andrew', 'Diane', 'Peter', 'Joan', 'Stephen', 'Marilyn',
  'Gregory', 'Sandra', 'Douglas', 'Janet', 'Brian', 'Rebecca', 'Kevin', 'Laura',
  'Timothy', 'Melissa', 'Jeffrey', 'Amy', 'Scott', 'Stephanie', 'Eric', 'Rachel',
  'Ryan', 'Jennifer', 'Justin', 'Ashley', 'Tyler', 'Megan', 'Brandon', 'Lauren',
  'Nathan', 'Hannah', 'Marcus', 'Adriana', 'Victor', 'Camila', 'Rafael', 'Lucia',
  'Omar', 'Priya', 'Devon', 'Simone', 'Anton', 'Ingrid', 'Dimitri', 'Yvonne',
  'Hugh', 'Beatrice', 'Malcolm', 'Rosalind', 'Grant', 'Constance', 'Neil', 'Theodora',
];

const LAST_NAMES: readonly string[] = [
  'Whitfield', 'Ashworth', 'Calloway', 'Prentiss', 'Bradbury', 'Harlow', 'Sutcliffe',
  'Merriweather', 'Kingsley', 'Fairbanks', 'Thorne', 'Ellsworth', 'Winslow', 'Marchetti',
  'Delacroix', 'Vasquez', 'Aguilar', 'Serrano', 'Montoya', 'Castellanos', 'Rosenthal',
  'Weissman', 'Steinberg', 'Lindqvist', 'Halvorsen', 'Papadakis', 'Stavros', 'Okafor',
  'Adeyemi', 'Nakamura', 'Yamashita', 'Chowdhury', 'Rangarajan', 'Nguyen', 'Pham',
  'Beaumont', 'Carrington', 'Devereaux', 'Radcliffe', 'Pemberton', 'Alderton', 'Barlowe',
  'Cavendish', 'Duxbury', 'Eastwood', 'Fenwick', 'Granville', 'Hawthorne', 'Ingram',
  'Jarrett', 'Kendrick', 'Langford', 'Mortimer', 'Northcote', 'Oakley', 'Pickering',
  'Quimby', 'Ravenscroft', 'Sanderson', 'Tremaine', 'Underhill', 'Vandermeer', 'Wexford',
  'Yardley', 'Ziegler', 'Abernathy', 'Blackwood', 'Chastain', 'Driscoll', 'Everhart',
  'Fitzgerald', 'Galloway', 'Hollister', 'Iverson', 'Jamison', 'Kilgore', 'Lockhart',
  'Marchand', 'Nolen', 'Ondrejka', 'Prescott', 'Rutherford', 'Stockton', 'Thackeray',
  'Vandergriff', 'Wentworth', 'Ashby', 'Bellweather', 'Caldwell', 'Duquesne',
];

/** Where a Dallas country club's resident members actually live. */
const LOCAL_CITIES: readonly string[] = [
  'Highland Park', 'University Park', 'Preston Hollow', 'Plano', 'Frisco', 'Southlake',
  'Colleyville', 'Coppell', 'Richardson', 'Allen', 'Grapevine', 'Flower Mound',
  'Rockwall', 'Lakewood', 'Prosper', 'Westlake', 'Trophy Club', 'Addison', 'Lucas',
];

/** Non-resident members are non-resident because they live too far to use the club weekly. */
const DISTANT_CITIES: readonly string[] = [
  'Houston, TX', 'Austin, TX', 'San Antonio, TX', 'Midland, TX', 'Oklahoma City, OK',
  'Tulsa, OK', 'Shreveport, LA', 'Fort Smith, AR', 'Santa Fe, NM', 'Scottsdale, AZ',
  'Naples, FL', 'Vail, CO', 'Kansas City, MO', 'Memphis, TN',
];

const EMAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'outlook.com', 'icloud.com', 'yahoo.com', 'me.com', 'protonmail.com',
];

const STAFF: readonly string[] = [
  'Marissa Ford, Membership Director',
  'Dale Whitcombe, Head Golf Professional',
  'Anita Reyes, Front Desk',
  'Colin Barrow, General Manager',
  'Priya Venkat, Member Services',
  'Tom Halloran, Food and Beverage Manager',
  'Grace Okonjo, Events Coordinator',
  'Stuart Lang, Tennis Professional',
  'Bethany Cruz, Front Desk',
  'Raymond Petit, Controller',
  'Nora Sinclair, Fitness Manager',
  'Board Secretary',
];

// ── Category configuration ────────────────────────────────────────────────────────────

type AgeBand = Member['ageBand'];

interface CategoryConfig {
  /** Target share of the roster. */
  share: number;
  /**
   * Baseline visits per week at engagement 1.0. Set comfortably above the churn model's
   * CADENCE_FLOOR for the category, so that falling below the floor is a real signal about
   * a member rather than an artefact of a stingy generator.
   */
  weeklyVisits: number;
  baseDues: number;
  duesSd: number;
  /** Must sum to 1 - it is a split of the member's visits, not an independent rate. */
  facilityWeights: Record<ClubFacility, number>;
  householdWeights: ReadonlyArray<readonly [number, number]>;
  ageWeights: ReadonlyArray<readonly [AgeBand, number]>;
  /** Multiplier on discretionary spend per visit. */
  spendIndex: number;
}

const CATEGORY: Record<MembershipCategory, CategoryConfig> = {
  'full-golf': {
    share: 0.3,
    weeklyVisits: 2.35,
    baseDues: 12_600,
    duesSd: 900,
    facilityWeights: {
      'golf-course': 0.55,
      'dining-room': 0.22,
      'tennis-court': 0.09,
      'fitness-centre': 0.08,
      pool: 0.06,
    },
    householdWeights: [
      [1, 12],
      [2, 34],
      [3, 22],
      [4, 24],
      [5, 8],
    ],
    ageWeights: [
      ['20-34', 2],
      ['35-49', 22],
      ['50-64', 44],
      ['65+', 32],
    ],
    spendIndex: 1.15,
  },
  social: {
    share: 0.34,
    weeklyVisits: 0.88,
    baseDues: 4200,
    duesSd: 450,
    facilityWeights: {
      'dining-room': 0.52,
      pool: 0.16,
      'fitness-centre': 0.14,
      'tennis-court': 0.13,
      'golf-course': 0.05,
    },
    householdWeights: [
      [1, 18],
      [2, 40],
      [3, 20],
      [4, 16],
      [5, 6],
    ],
    ageWeights: [
      ['20-34', 8],
      ['35-49', 30],
      ['50-64', 36],
      ['65+', 26],
    ],
    spendIndex: 1.0,
  },
  'junior-executive': {
    share: 0.12,
    weeklyVisits: 1.2,
    baseDues: 6400,
    duesSd: 550,
    facilityWeights: {
      'golf-course': 0.3,
      'fitness-centre': 0.22,
      'dining-room': 0.22,
      'tennis-court': 0.14,
      pool: 0.12,
    },
    householdWeights: [
      [1, 20],
      [2, 30],
      [3, 26],
      [4, 18],
      [5, 6],
    ],
    ageWeights: [
      ['20-34', 42],
      ['35-49', 54],
      ['50-64', 4],
      ['65+', 0],
    ],
    spendIndex: 0.85,
  },
  corporate: {
    share: 0.09,
    weeklyVisits: 0.58,
    baseDues: 15_800,
    duesSd: 2100,
    facilityWeights: {
      'golf-course': 0.48,
      'dining-room': 0.42,
      'fitness-centre': 0.05,
      'tennis-court': 0.03,
      pool: 0.02,
    },
    householdWeights: [
      [1, 62],
      [2, 26],
      [3, 8],
      [4, 4],
    ],
    ageWeights: [
      ['20-34', 6],
      ['35-49', 38],
      ['50-64', 44],
      ['65+', 12],
    ],
    spendIndex: 1.45,
  },
  'non-resident': {
    share: 0.15,
    weeklyVisits: 0.3,
    baseDues: 3100,
    duesSd: 320,
    facilityWeights: {
      'golf-course': 0.45,
      'dining-room': 0.4,
      pool: 0.08,
      'tennis-court': 0.04,
      'fitness-centre': 0.03,
    },
    householdWeights: [
      [1, 26],
      [2, 44],
      [3, 16],
      [4, 12],
      [5, 2],
    ],
    ageWeights: [
      ['20-34', 4],
      ['35-49', 22],
      ['50-64', 40],
      ['65+', 34],
    ],
    spendIndex: 1.1,
  },
};

// ── Seasonality and weekly rhythm ─────────────────────────────────────────────────────
//
// Indexed by calendar month (Jan..Dec). Dallas-specific: golf has a double peak either side
// of a brutal July/August, the pool is the inverse of that, dining lifts hard for the
// holidays, and the fitness centre gets its January spike like every gym on earth. Each
// table is kept near an average of 1.0 so that changing the shape of a season does not
// silently change total volume - the only knob for volume is `weeklyVisits`.

const SEASONALITY: Record<ClubFacility, readonly number[]> = {
  'golf-course': [0.62, 0.7, 1.15, 1.3, 1.28, 1.1, 0.72, 0.66, 1.12, 1.3, 1.12, 0.7],
  pool: [0.05, 0.05, 0.1, 0.35, 0.95, 1.75, 1.95, 1.8, 0.85, 0.25, 0.06, 0.05],
  'dining-room': [0.85, 0.95, 1.0, 1.02, 1.05, 0.95, 0.85, 0.82, 1.0, 1.08, 1.3, 1.45],
  'tennis-court': [0.75, 0.85, 1.1, 1.2, 1.15, 0.9, 0.65, 0.6, 1.05, 1.2, 1.0, 0.75],
  'fitness-centre': [1.35, 1.2, 1.05, 1.0, 0.95, 0.9, 0.85, 0.88, 1.0, 1.05, 0.95, 0.8],
};

/**
 * Day-of-week multipliers, index 0 = Sunday.
 *
 * The Monday troughs on golf and dining are not noise: the course closes Mondays for
 * maintenance and the main dining room closes with it, which is standard practice at a club
 * of this type. It is included because a utilisation report that does not know Mondays are
 * dark will produce a confident, wrong recommendation about Monday programming.
 */
const WEEKLY_RHYTHM: Record<ClubFacility, readonly number[]> = {
  'golf-course': [1.25, 0.15, 0.85, 0.95, 0.95, 1.05, 1.6],
  'dining-room': [1.15, 0.45, 0.7, 0.85, 1.0, 1.55, 1.45],
  'tennis-court': [1.3, 0.7, 0.95, 1.0, 0.95, 0.9, 1.4],
  pool: [1.45, 0.55, 0.75, 0.85, 0.85, 1.15, 1.5],
  'fitness-centre': [0.75, 1.25, 1.2, 1.15, 1.15, 0.95, 0.75],
};

/**
 * Start-hour distributions, split weekday/weekend.
 *
 * Tennis carries planted anomaly #2. Weekday hours before 11:00 are given a combined weight
 * of ~0.03 against ~1.0 for the rest of the day, because there is no morning programming -
 * the pro's block, the ladder and every clinic run from late afternoon. Weekends are the
 * mirror image, which is what makes the weekday gap a scheduling failure rather than a
 * property of the sport.
 */
type HourWeights = ReadonlyArray<readonly [number, number]>;

const START_HOURS: Record<ClubFacility, { weekday: HourWeights; weekend: HourWeights }> = {
  'golf-course': {
    weekday: [[7, 8], [8, 12], [9, 13], [10, 12], [11, 10], [12, 10], [13, 12], [14, 12], [15, 8], [16, 3]],
    weekend: [[7, 16], [8, 18], [9, 15], [10, 12], [11, 9], [12, 8], [13, 8], [14, 7], [15, 5], [16, 2]],
  },
  'tennis-court': {
    weekday: [
      [6, 0.2], [7, 0.4], [8, 0.6], [9, 0.8], [10, 1.0],
      [11, 6], [12, 9], [13, 7], [14, 6], [15, 8], [16, 13], [17, 17], [18, 19], [19, 13], [20, 5],
    ],
    weekend: [[7, 6], [8, 14], [9, 17], [10, 15], [11, 11], [12, 7], [13, 5], [14, 5], [15, 6], [16, 7], [17, 5], [18, 2]],
  },
  'dining-room': {
    weekday: [[11, 6], [12, 14], [13, 9], [17, 8], [18, 18], [19, 24], [20, 15], [21, 6]],
    weekend: [[10, 6], [11, 12], [12, 14], [13, 8], [17, 7], [18, 16], [19, 21], [20, 12], [21, 4]],
  },
  'fitness-centre': {
    weekday: [[5, 8], [6, 16], [7, 15], [8, 10], [9, 6], [11, 4], [12, 6], [16, 10], [17, 13], [18, 9], [19, 3]],
    weekend: [[7, 10], [8, 16], [9, 18], [10, 14], [11, 10], [12, 6], [15, 8], [16, 9], [17, 6], [18, 3]],
  },
  pool: {
    weekday: [[10, 6], [11, 10], [12, 14], [13, 16], [14, 15], [15, 13], [16, 12], [17, 9], [18, 5]],
    weekend: [[10, 9], [11, 13], [12, 15], [13, 15], [14, 14], [15, 12], [16, 10], [17, 7], [18, 5]],
  },
};

/** Base probability that a visit brings guests at all, before member and season effects. */
const GUEST_PROBABILITY: Record<ClubFacility, number> = {
  'golf-course': 0.16,
  'dining-room': 0.2,
  pool: 0.12,
  'tennis-court': 0.1,
  'fitness-centre': 0.03,
};

/**
 * Per-guest fees in dollars. Dining guests are deliberately absent: a guest at dinner is
 * billed as dining on the member's account, not as a guest fee, which is how club billing
 * actually works and which keeps the guest-fee series a clean read on golf and pool traffic.
 */
const GUEST_FEE: Partial<Record<ClubFacility, number>> = {
  'golf-course': 110,
  'tennis-court': 30,
  pool: 20,
  'fitness-centre': 25,
};

// ── Event configuration ───────────────────────────────────────────────────────────────

type EventKind = ClubEvent['kind'];

const EVENT_NAMES: Record<EventKind, readonly string[]> = {
  tournament: [
    'Member-Guest Invitational',
    'Club Championship',
    'Spring Four-Ball',
    'President’s Cup',
    'Ryder Cup Match Play',
    'Ladies Member-Member',
    'Junior Club Championship',
    'Turkey Trot Scramble',
    'Founders Cup',
  ],
  dining: [
    'Wine Dinner: Northern Rhone',
    'Lobster Boil',
    'Thanksgiving Buffet',
    'Holiday Gala Dinner',
    'Chef’s Table Tasting',
    'Prime Rib Night',
    'Easter Brunch',
    'Mother’s Day Brunch',
    'Bourbon and Barbecue Evening',
  ],
  social: [
    'Live Jazz on the Terrace',
    'Wine Down Wednesday',
    'Trivia Night',
    'New Member Reception',
    'Cigar and Scotch Evening',
    'Casino Night',
    'Derby Day Party',
    'Halloween Costume Party',
  ],
  family: [
    'Family Pool Party',
    'Independence Day Cookout',
    'Junior Golf Clinic',
    'Movie Night on the Lawn',
    'Easter Egg Hunt',
    'Back to School Splash',
    'Breakfast with Santa',
    'Father-Son Scramble',
  ],
  'member-meeting': [
    'Annual General Meeting',
    'Quarterly Member Forum',
    'Capital Projects Briefing',
    'Budget and Dues Presentation',
  ],
};

interface EventConfig {
  capacity: readonly [number, number];
  /** Fraction of capacity that registers. */
  fill: readonly [number, number];
  /** Ticket price per head; 0 means the event does not generate a charge. */
  price: number;
  /** Relative appeal by membership category, used when drawing registrants. */
  affinity: Partial<Record<MembershipCategory, number>>;
}

const EVENT_CONFIG: Record<EventKind, EventConfig> = {
  tournament: {
    capacity: [56, 144],
    fill: [0.74, 0.98],
    price: 145,
    affinity: { 'full-golf': 3.4, 'junior-executive': 1.6, corporate: 1.5, 'non-resident': 0.8, social: 0.3 },
  },
  dining: {
    capacity: [40, 130],
    fill: [0.6, 0.96],
    price: 95,
    affinity: { social: 1.9, 'full-golf': 1.3, 'non-resident': 0.7, corporate: 0.9, 'junior-executive': 0.9 },
  },
  social: {
    capacity: [60, 170],
    fill: [0.48, 0.9],
    price: 65,
    affinity: { social: 1.9, 'junior-executive': 1.5, 'full-golf': 1.1, corporate: 0.7, 'non-resident': 0.5 },
  },
  family: {
    capacity: [90, 250],
    fill: [0.52, 0.92],
    price: 45,
    affinity: { social: 1.7, 'junior-executive': 1.8, 'full-golf': 1.3, 'non-resident': 0.4, corporate: 0.2 },
  },
  // Nobody comes to the AGM. This is not a bug in the generator; it is the single most
  // reliable fact about club governance, and it gives the insight engine a true finding that
  // has nothing to do with money.
  'member-meeting': {
    capacity: [150, 300],
    fill: [0.12, 0.34],
    price: 0,
    affinity: { 'full-golf': 1.4, social: 0.9, corporate: 0.5, 'junior-executive': 0.5, 'non-resident': 0.2 },
  },
};

/** Which event kinds are plausible in which month. Weights are relative. */
const EVENT_KIND_BY_MONTH: readonly ReadonlyArray<readonly [EventKind, number]>[] = [
  /* Jan */ [['social', 4], ['dining', 3], ['member-meeting', 1], ['family', 1], ['tournament', 0.5]],
  /* Feb */ [['dining', 4], ['social', 3], ['tournament', 1], ['family', 1]],
  /* Mar */ [['tournament', 3], ['social', 3], ['family', 2], ['dining', 2]],
  /* Apr */ [['tournament', 4], ['dining', 3], ['family', 3], ['social', 2]],
  /* May */ [['tournament', 5], ['family', 3], ['social', 3], ['dining', 2]],
  /* Jun */ [['family', 5], ['tournament', 3], ['social', 3], ['dining', 1]],
  /* Jul */ [['family', 6], ['social', 3], ['dining', 1], ['tournament', 1]],
  /* Aug */ [['family', 5], ['social', 3], ['dining', 1], ['tournament', 1]],
  /* Sep */ [['tournament', 5], ['social', 3], ['dining', 2], ['family', 2]],
  /* Oct */ [['tournament', 4], ['social', 4], ['dining', 3], ['family', 2]],
  /* Nov */ [['dining', 5], ['tournament', 2], ['social', 3], ['family', 2]],
  /* Dec */ [['dining', 6], ['social', 4], ['family', 3], ['tournament', 0.5]],
];

// ── Staff note text ───────────────────────────────────────────────────────────────────
//
// These are retrieved and shown verbatim to a human, so they are written rather than
// templated. Variety comes from the size of the pools plus an optional trailing clause,
// which keeps ~1,100 notes from reading like the same sentence with the nouns swapped.

const POSITIVE_NOTES: readonly string[] = [
  'Hosted four guests for the Saturday shotgun and asked about sponsoring the member-guest next year.',
  'Complimented the bunker work on 7 and 12; said the course looks the best it has in a decade.',
  'Brought her parents to Sunday brunch and asked whether we could hold the same table monthly.',
  'Volunteered for the junior golf clinic again this summer, third year running.',
  'Stopped by the shop to thank Dale for the fitting. Says the new irons have taken four strokes off.',
  'Asked to be put on the list for the Pinehurst trip before it had even been announced.',
  'Sent a note after the wine dinner saying it was the best evening they have had here.',
  'Introduced a colleague from the office who is now on the waitlist.',
  'Wants to turn the standing Thursday game into a fourball and is looking for a fourth.',
  'Told the front desk the mobile tee sheet is a huge improvement on the old phone system.',
  'Their daughter made the high school team and they credited the junior programme for it.',
  'Paid the capital assessment early without being chased.',
  'Offered to chair the greens committee if a seat comes open.',
  'Said the pool staff were exceptional with their grandchildren over the long weekend.',
  'Asked to book the private dining room for a fiftieth birthday in the spring.',
  'Praised the halfway house menu change, the brisket sandwich in particular.',
  'Has been bringing the same two guests every other Friday and asked about reciprocal cards for them.',
  'Stayed after the member meeting to thank the board for being straight about the pool project.',
  'Wrote in to say the valet team went well out of their way during the storm.',
  'Signed up for the couples league within an hour of the email going out.',
  'Requested a second locker for their son, who has started playing weekly.',
  'Told the professional they are playing more golf now than at any point since retiring.',
  'Brought a prospective member to lunch unprompted and gave them the full tour.',
  'Asked for the crab cake recipe for a dinner party at home. Kitchen sent it over.',
  'Their company has taken a table at the charity scramble for the third year.',
  'Says the fitness centre refresh is the reason they renewed the family membership.',
  'Has not missed a Wednesday ladies day since March.',
  'Sent flowers to the front desk team after the holiday party.',
  'Described the club to a guest as the only place their whole family actually agrees on.',
];

const NEUTRAL_NOTES: readonly string[] = [
  'Updated billing address after a move within Preston Hollow.',
  'Asked about the process for putting a membership on hold during a sabbatical.',
  'Requested that club correspondence go to their personal address rather than work.',
  'Called to confirm the dress code for the club championship dinner.',
  'Left a jacket in the locker room; returned to them the following week.',
  'Asked whether the range would stay open during the aeration window.',
  'Changed the card on file after a fraud alert with their bank.',
  'Enquired about adding a spouse mid-year and how the dues would be prorated.',
  'Wanted to know whether the courts are lit for evening play through the winter.',
  'Asked for a copy of last year’s statement for their accountant.',
  'Booked the family for Easter brunch, then moved to the later sitting.',
  'Requested a locker closer to the entrance for mobility reasons.',
  'Asked whether junior members may use the fitness centre unaccompanied.',
  'Confirmed they will be travelling for most of July and asked us to hold event mail.',
  'Wanted clarification on the monthly guest limit at the pool.',
  'Asked about the timeline for the short game area.',
  'Requested a paper statement in addition to the emailed one.',
  'Enquired about changing membership category at renewal.',
  'Asked whether the kitchen can accommodate a coeliac guest at a private dinner.',
  'Called about a duplicate charge on the November statement. Posting error, resolved same day.',
  'Wanted to know whether the reciprocal list has changed this year.',
  'Asked to come off the golf newsletter but stay on club-wide notices.',
  'Enquired about parking during the works on the north entrance.',
  'Requested the club history booklet as a family gift.',
  'Asked what happens to the initiation fee if a member resigns within five years.',
  'Confirmed their son’s age band for junior competition eligibility.',
  'Asked whether the club will be open on the public holiday and at what hours.',
];

const NEGATIVE_NOTES: readonly string[] = [
  'Frustrated that the tee sheet was already full the moment the booking window opened.',
  'Complained the fitness centre air conditioning has been unreliable since June.',
  'Unhappy about the dues increase and said it was communicated late and badly.',
  'Reported cold showers in the locker room for the third time this month.',
  'Says the pace of play on Saturday mornings has become unbearable.',
  'Objected to the new cart path policy and wanted to know who made the decision.',
  'Annoyed that their guest was charged the weekend rate on a Friday.',
  'Said the pool was over capacity and there was nowhere to sit for two hours.',
  'Complained that nobody returned their call about a private event enquiry.',
  'Unhappy the championship pairings were posted late and were wrong when they appeared.',
  'Feels the club has become louder and less relaxed since the family membership push.',
  'Reported the practice green has been in poor condition for weeks.',
  'Frustrated by the construction parking and said staff were dismissive about it.',
  'Says the app logs them out constantly and they have given up on using it.',
  'Complained about noise from pool events carrying into the dining room.',
  'Objected to the roof assessment arriving with no warning.',
  'Unhappy that the tennis professional cancelled two lessons in a row at short notice.',
  'Said the halfway house was shut on a Saturday afternoon with no signage.',
  'Reported the same billing error twice and says nobody has come back to them.',
  'Feels the board has not answered the questions raised at the last meeting.',
  'Complained the range balls are worn out and it is affecting their practice.',
  'Says the booking system loses their preferences every single time.',
  'Unhappy that a member event ran out of food before the second sitting.',
  'Reported that the junior programme has become too competitive for their child.',
];

/** Clustered after the chef departure. The cause is never stated as a field anywhere. */
const DINING_COMPLAINTS: readonly string[] = [
  'Said the dining room is not what it was and asked directly whether the chef had left.',
  'Sent a steak back twice on Friday and then asked for the cover to be taken off the bill.',
  'Says the menu has not changed since the winter and the specials repeat weekly.',
  'Complained the kitchen took over an hour on a Tuesday with a half-empty room.',
  'Told the front desk they have started booking dinner outside the club on Fridays.',
  'Said the food has slipped noticeably and they are embarrassed to bring clients now.',
  'Cancelled a private dinner for twelve and moved it to a restaurant in Plano.',
  'Asked what the plan is for the kitchen, because the last three meals have been poor.',
  'Says the service in the grill has gone from attentive to absent.',
  'Reported cold food twice in one week. Did not want it comped, wanted it noted.',
  'Says the wine list has not been touched and half of it is unavailable anyway.',
  'Told the manager that club dining used to be the reason they joined and no longer is.',
  'Complained the Sunday brunch has been cut back with no reduction in price.',
  'Says they now eat before coming to the club, which they never used to do.',
  'Asked whether we are recruiting a new executive chef and when that is likely to land.',
  'Left after twenty minutes on Saturday because nobody had taken a drinks order.',
  'Said the kitchen sent out three of four mains wrong at a table of eight.',
  'Feels the food has become the weakest part of the membership and said so plainly.',
  'Says the bar is now the only reliable part of an evening here.',
  'Their family has stopped using the dining room entirely since the winter.',
];

/** The cause, visible only in committee minutes - which is exactly where it would be. */
const CHEF_COMMITTEE_NOTES: readonly string[] = [
  'Committee informed that the executive chef has resigned effective the end of January. Sous chef covering on an interim basis while a search runs.',
  'Food and beverage discussed at the February committee. Covers are down on last year and the interim kitchen is stretched thin. Search is open.',
  'Member feedback on dining raised again at committee. Agreed to bring a recruitment update to every meeting until the position is filled.',
  'Noted at committee that the kitchen has now run four months without an executive chef and that dining complaints are arriving weekly.',
];

/** The Q1 2025 intake. Every one of these is an onboarding failure, not an acquisition one. */
const ONBOARDING_NOTES: readonly string[] = [
  'Joined in the winter drive. Has not been in since orientation and did not respond to the follow-up.',
  'Said they joined for the golf but cannot get into a game and does not know anybody yet.',
  'Asked how the standing games work and whether there is a way to be paired. Nobody had a clear answer.',
  'Joined during the promotion and has used the club twice in four months.',
  'Said the welcome pack arrived a month after they joined and nothing has followed it.',
  'Told the front desk they are not actually sure what their membership includes.',
  'Enquired about cancelling within the first year and what notice is required.',
  'Has not attended a single club event since joining, despite three invitations.',
  'Expected an introduction to the other new members and never received one.',
  'Joined in the drive and has not booked a tee time once.',
  'Asked whether the discounted rate they joined on carries past the first year.',
  'Says their spouse has never been to the club and does not see the point of it.',
  'Came to the new member reception, but it ran two months after they joined and they knew nobody.',
  'Said the club feels closed off and they have not found a way in.',
];

/** Written during the decay window, before a resignation letter exists. */
const DISENGAGEMENT_NOTES: readonly string[] = [
  'Has not been seen since the spring. Called and left a message; no response.',
  'Said work has changed and they cannot justify the time at the moment.',
  'Mentioned they are reviewing all their memberships this year.',
  'Cancelled the standing Thursday game and has not rebooked.',
  'Asked what the resignation notice period is. Said they were only curious.',
  'Their locker has not been touched since last season.',
  'Declined the last three event invitations without giving a reason.',
  'Said they have joined a course closer to home for weekday play.',
  'Guest privileges have gone completely unused this year, which is unlike them.',
  'Came in, collected something from the shop and left without playing.',
  'Said the club no longer fits the way the family spends weekends.',
  'Has moved their standing dinner reservation to a restaurant in town.',
  'Asked whether any part of the initiation fee is refundable on resignation.',
  'Said they will decide about next year once the renewal notice arrives.',
  'Their spouse mentioned the club has not come up at home in months.',
  'Stopped responding to the membership director after two attempts.',
  'Spending most weekends at the lake house now.',
  'Still paying dues but has not been on the property since the winter.',
];

const EXIT_NOTES: readonly string[] = [
  'Resigned in writing. Cited cost against low usage over the last two years.',
  'Resignation received. Relocating out of state for work.',
  'Resigned effective at renewal. Said the club is no longer the right fit for the family.',
  'Resignation letter cites the dues increase and the assessment together being too much.',
  'Resigned. Exit conversation: has not played enough golf to justify a full membership.',
  'Resigned after a long tenure. Health has made regular use difficult.',
  'Resignation received with a note thanking the staff. No complaint raised.',
  'Resigned. Joining a club closer to their new home in Frisco.',
  'Resignation effective year end. The company has cut the corporate seat.',
  'Resigned. Said the decline in the dining room made the decision easy.',
  'Resigned, citing how hard it has become to get a weekend tee time.',
  'Resignation received. Retiring and relocating to the coast.',
  'Resigned after twelve months. Said they never really settled in.',
  'Resignation processed. Declined an exit conversation.',
  'Resigned. Divorce; the membership is being closed rather than transferred.',
  'Resignation received. Asked to stay on the mailing list in case circumstances change.',
];

/** Supporting retrieval material for the tennis anomaly - members noticing it themselves. */
const TENNIS_NOTES: readonly string[] = [
  'Asked why there is nothing on the courts in the mornings. Would play at nine if there were a group.',
  'Suggested a weekday morning ladder, because the courts are empty every time they drive past.',
  'Likes that they can always get a court before lunch, but wondered aloud why it is so quiet.',
  'Enquired about morning clinics. Told there are none scheduled before four.',
  'Retired member asked for a daytime tennis group and was told to check back in the spring.',
  'Noted the courts are freshly resurfaced and immaculate, and unused most weekday mornings.',
];

/** Supporting material for the guest surge, including the uncomfortable side of it. */
const GUEST_PROGRAMME_NOTES: readonly string[] = [
  'Asked about the reciprocal arrangement and whether the guest rate applies to their members too.',
  'Brought three guests from the reciprocal club and asked whether the tee time cap applies to them.',
  'Very positive about the summer guest promotion; has used it four times already.',
  'Asked whether the bring-a-guest offer will run again next summer.',
  'Wondered aloud whether the number of guests on Saturdays is squeezing members out.',
  'Complimented the reciprocal programme but asked how member tee time priority is protected.',
];

const NOTE_FOLLOW_UPS: readonly string[] = [
  'Membership director to follow up.',
  'Logged for the committee.',
  'No action requested.',
  'Passed to the golf shop.',
  'Flagged for the GM.',
  'Will revisit at renewal.',
  'Front desk to note the preference on the account.',
  'Copied to food and beverage.',
  'Nothing outstanding.',
  'Follow-up scheduled for next month.',
  'Escalated to the general manager.',
  'Noted on file.',
  'Member declined a call back.',
  'Assigned to member services.',
  'Raised at the weekly staff meeting.',
  'Awaiting a response from the member.',
];

const NOTE_CHANNELS: ReadonlyArray<readonly [MemberNote['channel'], number]> = [
  ['front-desk', 34],
  ['email', 27],
  ['phone', 18],
  ['survey', 12],
  ['committee', 9],
];

// ── Internal working types ────────────────────────────────────────────────────────────

/**
 * Everything the simulation needs to know about a member that is *not* part of the exported
 * domain model. Keeping it separate matters: engagement level, decay curve and the fact that
 * a member was picked to resign are ground truth the product must never be able to read.
 * If they lived on `Member`, the churn model could cheat and the eval would be worthless.
 */
interface Profile {
  member: Member;
  /** Lognormal multiplier on visit frequency, mean ~1.0. */
  engagement: number;
  /** Lognormal multiplier on discretionary spend, mean ~1.0. */
  spendIndex: number;
  /** Propensity to bring guests; makes advocacy a member trait rather than a coin flip. */
  hostIndex: number;
  joinedMs: number;
  /** First and last day this member can generate activity, clipped to the window. */
  activeFromMs: number;
  activeToMs: number;
  /** Start of the pre-exit decline, or null for members who never decay. */
  decayStartMs: number | null;
  decayEndMs: number;
  /** Activity multiplier reached at the end of the decay. */
  decayFloor: number;
  /** Multiplier applied for the first 90 days after joining, if they joined in-window. */
  onboardingFactor: number;
  onboardingUntilMs: number;
  resignationStyle: 'decayed' | 'quiet' | null;
  inDriveCohort: boolean;
}

/** Rows are built without ids and numbered after sorting, so ids run in date order. */
type VisitDraft = Omit<Visit, 'id'>;
type TransactionDraft = Omit<Transaction, 'id'>;
type NoteDraft = Omit<MemberNote, 'id'>;
type RegistrationDraft = Omit<EventRegistration, 'id'>;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Activity multiplier for a member on a given day: decay times onboarding.
 *
 * Decay is linear from 1.0 at `decayStartMs` down to `decayFloor` at `decayEndMs`. Linear
 * rather than exponential on purpose - a club member drifting away does not fall off a
 * cliff, they miss one week, then two, and a straight line over three to six months is what
 * that looks like in the data.
 */
function lifecycleFactor(p: Profile, ms: number): number {
  let factor = 1;

  if (p.decayStartMs !== null && ms >= p.decayStartMs) {
    const span = Math.max(1, p.decayEndMs - p.decayStartMs);
    const progress = clamp((ms - p.decayStartMs) / span, 0, 1);
    factor *= 1 - progress * (1 - p.decayFloor);
  }

  if (ms < p.onboardingUntilMs) {
    factor *= p.onboardingFactor;
  }

  return factor;
}

// ── Generation ────────────────────────────────────────────────────────────────────────

/**
 * Builds the complete dataset for a seed.
 *
 * Pure: the only inputs are the seed and the constants in this file. Two calls with the same
 * seed produce structurally identical output, which `generate.test.ts` asserts by comparing
 * serialised snapshots.
 */
export function generateDataset(seed: number): ClubDataset {
  const rng = new Rng(seed);

  const profiles = buildMembers(rng);
  assignGroundTruth(rng, profiles);

  const { visits, transactions } = simulateActivity(rng, profiles);
  const { events, registrations, eventTransactions } = simulateEvents(rng, profiles);
  transactions.push(...eventTransactions);
  transactions.push(...postDues(profiles));

  const notes = writeNotes(rng, profiles);

  // Sorting before numbering means row ids are chronological, which makes an evidence
  // receipt ("rows v-018420 through v-018463") readable rather than an opaque id soup.
  visits.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.memberId < b.memberId ? -1 : 1));
  transactions.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.memberId < b.memberId ? -1 : a.category < b.category ? -1 : 1,
  );
  notes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.memberId < b.memberId ? -1 : 1));
  registrations.sort((a, b) =>
    a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : a.memberId < b.memberId ? -1 : 1,
  );

  return {
    club: { ...CLUB },
    members: profiles.map((p) => p.member),
    transactions: transactions.map((t, i) => ({ id: `t-${pad(i + 1, 6)}`, ...t })),
    visits: visits.map((v, i) => ({ id: `v-${pad(i + 1, 6)}`, ...v })),
    events,
    registrations: registrations.map((r, i) => ({ id: `r-${pad(i + 1, 5)}`, ...r })),
    notes: notes.map((n, i) => ({ id: `n-${pad(i + 1, 5)}`, ...n })),
  };
}

// ── Step 1: the roster ────────────────────────────────────────────────────────────────

/**
 * Join dates are drawn first and everything else follows from them, because tenure is the
 * variable that touches the most downstream behaviour: category mix, dues (legacy members
 * are grandfathered), referral source, and the churn model's strongest protective signal.
 */
function buildMembers(rng: Rng): Profile[] {
  const joinTimes: Array<{ ms: number; inDriveCohort: boolean }> = [];

  // In-window joiners. A club this size replaces roughly its own attrition, so a steady
  // one-to-three a month - except during the Q1 2025 drive, which is the whole point of
  // planted anomaly #3.
  for (const slot of MONTHS) {
    const isDriveMonth = slot.startMs >= DRIVE_FROM_MS && slot.startMs <= DRIVE_TO_MS;
    const count = isDriveMonth ? rng.int(9, 11) : rng.int(1, 3);
    for (let i = 0; i < count; i++) {
      joinTimes.push({
        ms: slot.startMs + (rng.int(1, slot.days) - 1) * MS_PER_DAY,
        inDriveCohort: isDriveMonth,
      });
    }
  }

  // Pre-window members, spread across the club's history. The 1980s tail is small but real:
  // every club has a handful of members who have been there longer than most of the staff.
  const eraBands: ReadonlyArray<readonly [string, string, number]> = [
    ['1978-01-01', '1989-12-31', 5],
    ['1990-01-01', '1999-12-31', 7],
    ['2000-01-01', '2009-12-31', 13],
    ['2010-01-01', '2016-12-31', 20],
    ['2017-01-01', '2020-12-31', 22],
    ['2021-01-01', '2022-12-31', 17],
    ['2023-01-01', '2024-08-31', 16],
  ];
  const eraEntries = eraBands.map((b) => [b, b[2]] as const);

  const preWindowCount = TOTAL_MEMBERS - joinTimes.length;
  for (let i = 0; i < preWindowCount; i++) {
    const band = rng.weighted(eraEntries);
    const from = dayStart(band[0]);
    const to = dayStart(band[1]);
    joinTimes.push({
      ms: from + rng.int(0, Math.round((to - from) / MS_PER_DAY)) * MS_PER_DAY,
      inDriveCohort: false,
    });
  }

  joinTimes.sort((a, b) => a.ms - b.ms);

  // Category quotas are filled in join order using era-appropriate preferences. This keeps
  // the roster mix exactly on target while still letting legacy members skew to full golf
  // and the discounted drive skew to social - which is itself part of why that cohort
  // churns: they were price-shopped in rather than fitted to the club.
  const quota = categoryQuotas();
  const emailSeen = new Map<string, number>();
  let memberNo = 1042;

  return joinTimes.map((join, index) => {
    const category = pickCategory(rng, quota, join.ms, join.inDriveCohort);
    quota[category] -= 1;

    const cfg = CATEGORY[category];
    const tenureYears = (WINDOW_TO_MS - join.ms) / (365 * MS_PER_DAY);

    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const emailBase = `${firstName}.${lastName}`.toLowerCase();
    const seen = emailSeen.get(emailBase) ?? 0;
    emailSeen.set(emailBase, seen + 1);
    const email = `${emailBase}${seen === 0 ? '' : seen + 1}@${rng.pick(EMAIL_DOMAINS)}`;

    // Dues vary per member because real rosters carry legacy rates, mid-year proration and
    // negotiated corporate terms. A single flat number per category would make dues revenue
    // trivially decomposable and would hide exactly the kind of pricing drift a GM cares about.
    let dues = rng.normalClamped(cfg.baseDues, cfg.duesSd, cfg.baseDues * 0.72, cfg.baseDues * 1.3);
    if (join.ms < dayStart('1990-01-01')) dues *= 0.88;
    dues = Math.round(dues / 25) * 25;

    memberNo += rng.int(1, 3);

    const member: Member = {
      id: `m-${pad(index + 1, 4)}`,
      memberNo: String(memberNo),
      firstName,
      lastName,
      email,
      category,
      status: 'active',
      joinedAt: isoDate(join.ms),
      householdSize: rng.weighted(cfg.householdWeights),
      ageBand: pickAgeBand(rng, cfg, tenureYears),
      annualDues: dues,
      homeCity: category === 'non-resident' ? rng.pick(DISTANT_CITIES) : rng.pick(LOCAL_CITIES),
      joinedVia: pickJoinedVia(rng, category, join.ms, join.inDriveCohort),
    };

    // Engagement is lognormal with mean ~1: most members cluster around typical use, a few
    // live here, and a long left tail barely comes at all. A normal distribution would have
    // produced negative rates and, worse, no heavy users - and heavy users are where guest
    // revenue and event fill actually come from.
    const engagement = Math.exp(rng.normal(-0.101, 0.45));

    return {
      member,
      engagement,
      spendIndex: Math.exp(rng.normal(-0.061, 0.35)) * cfg.spendIndex,
      hostIndex: Math.exp(rng.normal(-0.125, 0.5)),
      joinedMs: join.ms,
      activeFromMs: Math.max(join.ms, WINDOW_FROM_MS),
      activeToMs: WINDOW_TO_MS,
      decayStartMs: null,
      decayEndMs: WINDOW_TO_MS,
      decayFloor: 1,
      onboardingFactor: 1,
      onboardingUntilMs: 0,
      resignationStyle: null,
      inDriveCohort: join.inDriveCohort,
    } satisfies Profile;
  });
}

function categoryQuotas(): Record<MembershipCategory, number> {
  const categories = Object.keys(CATEGORY) as MembershipCategory[];
  const quota = {} as Record<MembershipCategory, number>;
  let assigned = 0;
  for (const c of categories) {
    quota[c] = Math.round(CATEGORY[c].share * TOTAL_MEMBERS);
    assigned += quota[c];
  }
  // Rounding five shares rarely lands exactly on the total; absorb the difference in the
  // largest category so the roster size stays a promise rather than an approximation.
  quota.social += TOTAL_MEMBERS - assigned;
  return quota;
}

function pickCategory(
  rng: Rng,
  quota: Record<MembershipCategory, number>,
  joinedMs: number,
  inDriveCohort: boolean,
): MembershipCategory {
  const legacy = joinedMs < dayStart('1995-01-01');
  const preferences: ReadonlyArray<readonly [MembershipCategory, number]> = legacy
    ? [['full-golf', 60], ['social', 26], ['non-resident', 10], ['corporate', 3], ['junior-executive', 1]]
    : inDriveCohort
      ? [['social', 50], ['junior-executive', 25], ['full-golf', 14], ['non-resident', 7], ['corporate', 4]]
      : [['social', 34], ['full-golf', 30], ['non-resident', 15], ['junior-executive', 12], ['corporate', 9]];

  const available = preferences.filter(([c]) => quota[c] > 0);
  if (available.length === 0) {
    // Defensive: quotas are sized to the roster, so this is unreachable unless the shares
    // and TOTAL_MEMBERS are edited out of sync. Fail loudly rather than silently skewing.
    throw new Error('categoryQuotas exhausted before every member was assigned');
  }
  return rng.weighted(available);
}

function pickAgeBand(rng: Rng, cfg: CategoryConfig, tenureYears: number): AgeBand {
  const bands: readonly AgeBand[] = ['20-34', '35-49', '50-64', '65+'];
  let index = bands.indexOf(rng.weighted(cfg.ageWeights));
  // Somebody who joined in 1988 is not in the 20-34 band today. Rather than model birth
  // dates, push the band up in proportion to tenure - same effect, one field instead of two.
  const shift = Math.floor(tenureYears / 14);
  index = clamp(index + shift, 0, bands.length - 1);
  const band = bands[index];
  return band ?? '50-64';
}

function pickJoinedVia(
  rng: Rng,
  category: MembershipCategory,
  joinedMs: number,
  inDriveCohort: boolean,
): Member['joinedVia'] {
  if (category === 'corporate') return 'corporate';
  if (joinedMs < dayStart('1995-01-01')) return rng.weighted([['legacy', 8], ['referral', 2]]);
  if (inDriveCohort) return rng.weighted([['event', 66], ['referral', 20], ['waitlist', 14]]);
  return rng.weighted([['referral', 46], ['waitlist', 30], ['event', 18], ['legacy', 6]]);
}

// ── Step 2: attrition ground truth ────────────────────────────────────────────────────

const TARGET_ANNUAL_ATTRITION = 0.08;
/** Share of the Q1-2025 cohort that resigns inside the window. */
const COHORT_RESIGN_RATE = 0.3;
/** Share of other in-window joiners that resigns. Half the cohort rate, by design. */
const OTHER_JOINER_RESIGN_RATE = 0.143;
/** Resignations that arrive with no behavioural warning at all. */
const QUIET_RESIGNATION_SHARE = 0.32;
/** Members who decay hard and then simply stay. The honest false positives. */
const FALSE_ALARM_COUNT = 30;

/**
 * Decides who leaves, when, and whether the data warns you first.
 *
 * Resignations are allocated by **stratified quota** rather than by an independent coin flip
 * per member. That is the only way to make "the Q1 2025 cohort churns at double the rate"
 * a designed property instead of a lucky draw: with 30 members in the cohort, independent
 * sampling would put the observed ratio anywhere between 1.0 and 3.0 depending on the seed,
 * and an eval asserting on it would be asserting on noise.
 *
 * Within each stratum, *who* leaves is still weighted by plausible risk - low engagement,
 * short tenure, corporate seats that get cut in a budget round - so the ground truth
 * correlates with things a model could legitimately learn.
 */
function assignGroundTruth(rng: Rng, profiles: readonly Profile[]): void {
  const windowYears = WINDOW_DAYS / 365;
  const totalTarget = Math.round(TOTAL_MEMBERS * TARGET_ANNUAL_ATTRITION * windowYears);

  // A member who joined six weeks before the window closes cannot resign inside it in any
  // meaningful sense, and including them would quietly deflate every cohort rate.
  const minTenureMs = 120 * MS_PER_DAY;
  const eligible = profiles.filter((p) => p.joinedMs <= WINDOW_TO_MS - minTenureMs);

  const cohort = profiles.filter((p) => p.inDriveCohort);
  const otherJoiners = profiles.filter((p) => !p.inDriveCohort && p.joinedMs >= WINDOW_FROM_MS);

  const cohortTarget = Math.round(cohort.length * COHORT_RESIGN_RATE);
  const otherJoinerTarget = Math.round(otherJoiners.length * OTHER_JOINER_RESIGN_RATE);
  const legacyTarget = Math.max(0, totalTarget - cohortTarget - otherJoinerTarget);

  const risk = (p: Profile): number => {
    let w = 1;
    if (p.engagement < 0.7) w *= 1.9;
    else if (p.engagement > 1.4) w *= 0.5;
    if (p.member.category === 'corporate') w *= 1.4;
    if (p.member.category === 'non-resident') w *= 1.3;
    const tenureYears = (WINDOW_FROM_MS - p.joinedMs) / (365 * MS_PER_DAY);
    if (tenureYears > 15) w *= 0.55;
    else if (tenureYears > 8) w *= 0.8;
    return w;
  };

  const eligibleSet = new Set(eligible);
  const eligibleIn = (group: readonly Profile[]): Profile[] => group.filter((p) => eligibleSet.has(p));

  const resigning = [
    ...weightedSampleWithoutReplacement(rng, eligibleIn(cohort), risk, cohortTarget),
    ...weightedSampleWithoutReplacement(rng, eligibleIn(otherJoiners), risk, otherJoinerTarget),
    ...weightedSampleWithoutReplacement(
      rng,
      eligible.filter((p) => p.joinedMs < WINDOW_FROM_MS),
      risk,
      legacyTarget,
    ),
  ];

  for (const p of resigning) {
    const resignedMs = pickResignationDate(rng, p);
    p.member.status = 'resigned';
    p.member.resignedAt = isoDate(resignedMs);
    p.activeToMs = resignedMs;

    if (rng.bool(QUIET_RESIGNATION_SHARE)) {
      // No decay at all. The member is engaged on Friday and gone on Monday: a job move, a
      // diagnosis, a divorce. Roughly a third of real resignations look like this, and a
      // churn model that scores 1.0 recall on this dataset is a churn model that is lying.
      p.resignationStyle = 'quiet';
    } else {
      p.resignationStyle = 'decayed';
      p.decayStartMs = resignedMs - rng.int(90, 180) * MS_PER_DAY;
      p.decayEndMs = resignedMs;
      p.decayFloor = rng.float(0.08, 0.3);
    }
  }

  // Members who look exactly like they are leaving, and then do not. Without these the
  // precision of any churn model on this fixture would be an artefact of the fixture.
  const stayers = weightedSampleWithoutReplacement(
    rng,
    profiles.filter((p) => p.member.status === 'active' && p.joinedMs < dayStart('2025-06-01')),
    (p) => (p.engagement < 1 ? 1.6 : 0.7),
    FALSE_ALARM_COUNT,
  );
  for (const p of stayers) {
    p.decayStartMs = WINDOW_TO_MS - rng.int(150, 280) * MS_PER_DAY;
    p.decayEndMs = WINDOW_TO_MS;
    p.decayFloor = rng.float(0.15, 0.42);
  }

  // A few members in dues arrears. Suspension stops privileges, so activity and dues both
  // stop - but there is no resignation date, which is a state the UI has to handle.
  const suspended = weightedSampleWithoutReplacement(
    rng,
    profiles.filter((p) => p.member.status === 'active' && p.decayStartMs === null && p.joinedMs < WINDOW_FROM_MS),
    () => 1,
    5,
  );
  for (const p of suspended) {
    p.member.status = 'suspended';
    p.activeToMs = WINDOW_TO_MS - rng.int(70, 200) * MS_PER_DAY;
  }

  // Onboarding. New members normally arrive keen - the honeymoon is real and it is why
  // first-year attrition looks fine until it suddenly does not. The Q1 2025 intake never
  // got one, which is the observable half of planted anomaly #3.
  for (const p of profiles) {
    if (p.joinedMs < WINDOW_FROM_MS) continue;
    p.onboardingUntilMs = p.joinedMs + 90 * MS_PER_DAY;
    p.onboardingFactor = p.inDriveCohort ? rng.float(0.4, 0.7) : rng.float(1.05, 1.35);
  }
}

function pickResignationDate(rng: Rng, p: Profile): number {
  const earliest = Math.max(WINDOW_FROM_MS + 30 * MS_PER_DAY, p.joinedMs + 120 * MS_PER_DAY);

  if (p.inDriveCohort) {
    // The drive cohort leaves on its own clock: six to sixteen months in, once the first
    // renewal notice lands and the discount they joined on disappears.
    return clamp(p.joinedMs + rng.int(190, 490) * MS_PER_DAY, earliest, WINDOW_TO_MS);
  }

  // Everyone else clusters at renewal. Club resignations are overwhelmingly a December and
  // January event because that is when the invoice arrives; a flat distribution across the
  // year would look wrong to anybody who has run a membership office.
  const monthEntries = MONTHS.map((slot) => {
    const weight = slot.month === 12 ? 3.2 : slot.month === 1 ? 2.4 : slot.month === 6 ? 1.3 : 1;
    return [slot, weight] as const;
  });
  const slot = rng.weighted(monthEntries);
  const candidate = slot.startMs + (rng.int(1, slot.days) - 1) * MS_PER_DAY;
  return clamp(candidate, earliest, WINDOW_TO_MS);
}

// ── Step 3: visits and the spend that follows them ────────────────────────────────────

/**
 * The core simulation: one pass over every member-day, sampling per facility.
 *
 * Sampling per facility rather than "does this member visit today, and if so where" is what
 * lets seasonality be facility-specific - the pool and the golf course have opposite Julys,
 * and a single daily visit probability could not express that. It also produces the double
 * visits that really happen (a round in the morning, dinner that evening) for free.
 *
 * Transactions are emitted in the same pass because discretionary spend is a function of the
 * visit *and* of the member's state on that day. Deriving it in a second pass would mean
 * recomputing the life-cycle factor for every row.
 */
function simulateActivity(
  rng: Rng,
  profiles: readonly Profile[],
): { visits: VisitDraft[]; transactions: TransactionDraft[] } {
  const visits: VisitDraft[] = [];
  const transactions: TransactionDraft[] = [];

  for (const p of profiles) {
    const cfg = CATEGORY[p.member.category];
    const dailyBase = (cfg.weeklyVisits / 7) * p.engagement;

    const startIndex = Math.max(0, Math.round((p.activeFromMs - WINDOW_FROM_MS) / MS_PER_DAY));
    const endIndex = Math.min(DAYS.length - 1, Math.round((p.activeToMs - WINDOW_FROM_MS) / MS_PER_DAY));

    for (let d = startIndex; d <= endIndex; d++) {
      const day = DAYS[d];
      const lifecycle = lifecycleFactor(p, day.ms);
      if (lifecycle <= 0) continue;

      for (const facility of CLUB_FACILITIES) {
        let intensity =
          dailyBase *
          lifecycle *
          cfg.facilityWeights[facility] *
          SEASONALITY[facility][day.month - 1] *
          WEEKLY_RHYTHM[facility][day.dow];

        // Planted anomaly #1, first lever: fewer covers once the chef has gone.
        if (facility === 'dining-room' && day.ms >= CHEF_DEPARTURE_MS) {
          intensity *= DINING_VISITS_AFTER_CHEF;
        }

        // Cap rather than allow >1: a probability above one is a modelling error, and
        // silently clamping to 1 would let a keen member visit literally every single day.
        if (!rng.bool(Math.min(intensity, 0.85))) continue;

        const visit = buildVisit(rng, p, facility, day, lifecycle);
        visits.push(visit);
        emitVisitSpend(rng, p, visit, facility, day, lifecycle, transactions);
      }
    }
  }

  return { visits, transactions };
}

function buildVisit(
  rng: Rng,
  p: Profile,
  facility: ClubFacility,
  day: DaySlot,
  lifecycle: number,
): VisitDraft {
  const isWeekend = day.dow === 0 || day.dow === 6;
  const hours = START_HOURS[facility];
  const hour = rng.weighted(isWeekend ? hours.weekend : hours.weekday);
  // Quarter-hour granularity: tee sheets and court sheets book in fifteen-minute slots, and
  // minute-level noise would imply a precision the source systems do not have.
  const minute = rng.pick([0, 15, 30, 45]);

  const surge = day.ms >= GUEST_SURGE_FROM_MS && day.ms <= GUEST_SURGE_TO_MS;
  // Guests scale with the life-cycle factor as well: a member on the way out stops bringing
  // people, which is why the churn model treats hosting as protective rather than neutral.
  let guestProbability = GUEST_PROBABILITY[facility] * p.hostIndex * lifecycle;
  if (surge && facility === 'golf-course') guestProbability *= GUEST_SURGE_GOLF;
  if (surge && facility === 'pool') guestProbability *= GUEST_SURGE_POOL;

  let guests = 0;
  if (rng.bool(Math.min(guestProbability, 0.75))) {
    guests = rng.weighted([[1, 52], [2, 28], [3, 14], [4, 6]]);
    if (surge && (facility === 'golf-course' || facility === 'pool') && rng.bool(GUEST_SURGE_EXTRA)) {
      guests += 1;
    }
  }

  return {
    memberId: p.member.id,
    at: isoDateTime(day.ms + hour * 3_600_000 + minute * 60_000),
    facility,
    guests,
    durationMin: visitDuration(rng, facility, guests),
  };
}

function visitDuration(rng: Rng, facility: ClubFacility, guests: number): number {
  switch (facility) {
    case 'golf-course':
      // Two populations, not one distribution: a full round, or the range and nine holes.
      // Averaging them would produce a modal duration that nobody actually plays.
      return rng.bool(0.62)
        ? Math.round(rng.normalClamped(248, 22, 200, 320))
        : Math.round(rng.normalClamped(105, 22, 60, 155));
    case 'tennis-court':
      return Math.round(rng.normalClamped(82, 20, 45, 145));
    case 'dining-room':
      return Math.round(rng.normalClamped(84 + guests * 8, 22, 40, 190));
    case 'fitness-centre':
      return Math.round(rng.normalClamped(58, 14, 25, 105));
    case 'pool':
      return Math.round(rng.normalClamped(128, 34, 45, 240));
  }
}

/**
 * Discretionary spend attached to a visit.
 *
 * Every branch here is a real billing behaviour at a club: the grill room ticket after a
 * round, the pro shop impulse buy, the guest fee posted to the host's account. Spend scales
 * with the member's life-cycle factor as well as their visit count, because a member on the
 * way out shows up and buys nothing - and that gap between "still here" and "still spending"
 * is precisely the leading indicator the churn model is built to read.
 */
function emitVisitSpend(
  rng: Rng,
  p: Profile,
  visit: VisitDraft,
  facility: ClubFacility,
  day: DaySlot,
  lifecycle: number,
  out: TransactionDraft[],
): void {
  const date = isoDate(day.ms);
  const propensity = p.spendIndex * (0.35 + 0.65 * lifecycle);
  const afterChef = day.ms >= CHEF_DEPARTURE_MS;

  const charge = (category: RevenueCategory, base: number, sd: number, lo: number, hi: number): void => {
    let amount = rng.normalClamped(base, sd, lo, hi) * propensity;
    if (category === 'dining' && afterChef) amount *= DINING_CHEQUE_AFTER_CHEF;
    if (category === 'bar' && afterChef) amount *= BAR_AFTER_CHEF;
    const rounded = Math.round(amount);
    if (rounded > 0) out.push({ memberId: p.member.id, date, category, amount: rounded });
  };

  switch (facility) {
    case 'dining-room':
      charge('dining', 52 * (1 + 0.55 * visit.guests), 16, 18, 320);
      if (rng.bool(0.55)) charge('bar', 34 * (1 + 0.4 * visit.guests), 14, 12, 180);
      break;
    case 'golf-course':
      if (rng.bool(0.22)) charge('dining', 38 * (1 + 0.5 * visit.guests), 14, 15, 160);
      if (rng.bool(0.34)) charge('bar', 28 * (1 + 0.45 * visit.guests), 12, 10, 140);
      if (rng.bool(0.16)) charge('pro-shop', 115, 70, 25, 650);
      if (rng.bool(0.045)) charge('lessons', 120, 30, 70, 220);
      break;
    case 'tennis-court':
      if (rng.bool(0.11)) charge('lessons', 95, 25, 55, 170);
      if (rng.bool(0.05)) charge('pro-shop', 85, 45, 25, 320);
      if (rng.bool(0.12)) charge('bar', 22, 9, 8, 70);
      break;
    case 'pool':
      if (rng.bool(0.3)) charge('dining', 31 * (1 + 0.6 * visit.guests), 12, 12, 150);
      if (rng.bool(0.22)) charge('bar', 24 * (1 + 0.5 * visit.guests), 10, 10, 110);
      break;
    case 'fitness-centre':
      if (rng.bool(0.075)) charge('lessons', 85, 20, 55, 150);
      break;
  }

  const fee = GUEST_FEE[facility];
  if (fee !== undefined && visit.guests > 0) {
    out.push({
      memberId: p.member.id,
      date,
      category: 'guest-fees',
      amount: visit.guests * fee,
    });
  }
}

// ── Step 4: dues ──────────────────────────────────────────────────────────────────────

/**
 * Dues post on the first of every month a membership is live.
 *
 * They are generated separately from visits and deliberately keep posting right up to the
 * resignation date, because that is the fact the whole product is built around: a club
 * watching only its dues ledger sees a member as perfectly healthy until the month their
 * letter arrives. Every early-warning signal in this dataset lives somewhere else.
 */
function postDues(profiles: readonly Profile[]): TransactionDraft[] {
  const out: TransactionDraft[] = [];

  for (const p of profiles) {
    const monthly = Math.round(p.member.annualDues / 12);
    for (const slot of MONTHS) {
      if (p.joinedMs > slot.endMs) continue;
      if (p.activeToMs < slot.startMs) continue;
      // Joining mid-month is billed from the join date rather than backdated to the first.
      const postMs = Math.max(slot.startMs, p.joinedMs);
      out.push({ memberId: p.member.id, date: isoDate(postMs), category: 'dues', amount: monthly });
    }
  }

  return out;
}

// ── Step 5: events ────────────────────────────────────────────────────────────────────

function simulateEvents(
  rng: Rng,
  profiles: readonly Profile[],
): { events: ClubEvent[]; registrations: RegistrationDraft[]; eventTransactions: TransactionDraft[] } {
  const events: ClubEvent[] = [];
  const registrations: RegistrationDraft[] = [];
  const eventTransactions: TransactionDraft[] = [];
  const usedNames = new Set<string>();

  for (const slot of MONTHS) {
    const kinds: EventKind[] = [];
    const count = rng.int(3, 5);
    for (let i = 0; i < count; i++) {
      kinds.push(rng.weighted(EVENT_KIND_BY_MONTH[slot.month - 1]));
    }
    // Governance runs on a quarterly rhythm whether or not anybody attends.
    if (slot.month % 3 === 0) kinds.push('member-meeting');

    for (const kind of kinds) {
      const cfg = EVENT_CONFIG[kind];
      const dateMs = slot.startMs + (rng.int(1, slot.days) - 1) * MS_PER_DAY;
      if (dateMs > WINDOW_TO_MS) continue;

      const baseName = rng.pick(EVENT_NAMES[kind]);
      // Annual fixtures recur, so the year disambiguates them; a repeat inside one year gets
      // a numeric suffix rather than a silently duplicated name.
      let name = `${baseName} ${slot.year}`;
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${baseName} ${slot.year} (${suffix})`;
        suffix += 1;
      }
      usedNames.add(name);

      const event: ClubEvent = {
        id: `e-${pad(events.length + 1, 3)}`,
        name,
        date: isoDate(dateMs),
        kind,
        capacity: rng.int(cfg.capacity[0], cfg.capacity[1]),
      };
      events.push(event);

      const eligible = profiles.filter((p) => p.joinedMs <= dateMs && p.activeToMs >= dateMs);
      const target = Math.min(eligible.length, Math.round(event.capacity * rng.float(cfg.fill[0], cfg.fill[1])));

      const registrants = weightedSampleWithoutReplacement(
        rng,
        eligible,
        (p) => p.engagement * Math.max(0.05, lifecycleFactor(p, dateMs)) * (cfg.affinity[p.member.category] ?? 1),
        target,
      );

      for (const p of registrants) {
        // No-shows are not uniform: a member already drifting away is markedly likelier to
        // register and then not turn up, which makes the no-show rate a churn signal in its
        // own right rather than decorative noise.
        const attended = rng.bool(clamp(0.88 * lifecycleFactor(p, dateMs), 0.3, 0.92));
        const guests = attended && rng.bool(0.28) ? rng.weighted([[1, 62], [2, 28], [3, 10]]) : 0;
        registrations.push({ eventId: event.id, memberId: p.member.id, attended, guests });

        if (attended && cfg.price > 0) {
          const amount = Math.round(cfg.price * (1 + guests) * rng.float(0.9, 1.18) * p.spendIndex);
          if (amount > 0) {
            eventTransactions.push({
              memberId: p.member.id,
              date: event.date,
              category: 'events',
              amount,
            });
          }
        }
      }
    }
  }

  return { events, registrations, eventTransactions };
}

// ── Step 6: staff notes ───────────────────────────────────────────────────────────────

/**
 * Notes are the unstructured half of the dataset, and they carry two jobs.
 *
 * The first is retrieval: the assistant needs something genuinely free-text to search, and
 * templated filler would make retrieval look better than it is. The second is corroboration:
 * every planted anomaly has a note trail, so a correct finding can be *explained* rather than
 * only detected. The chef's departure, in particular, appears nowhere as a field - it is
 * inferrable only from four committee minutes and the complaints that follow them.
 */
function writeNotes(rng: Rng, profiles: readonly Profile[]): NoteDraft[] {
  const notes: NoteDraft[] = [];

  const push = (
    p: Profile,
    ms: number,
    sentiment: MemberNote['sentiment'],
    body: string,
    channel?: MemberNote['channel'],
  ): void => {
    const clamped = clamp(ms, Math.max(WINDOW_FROM_MS, p.joinedMs), WINDOW_TO_MS);
    const withFollowUp = rng.bool(0.33) ? `${body} ${rng.pick(NOTE_FOLLOW_UPS)}` : body;
    notes.push({
      memberId: p.member.id,
      date: isoDate(clamped),
      author: rng.pick(STAFF),
      channel: channel ?? rng.weighted(NOTE_CHANNELS),
      sentiment,
      body: withFollowUp,
    });
  };

  const randomDayIn = (fromMs: number, toMs: number): number => {
    const span = Math.max(0, Math.round((toMs - fromMs) / MS_PER_DAY));
    return fromMs + rng.int(0, span) * MS_PER_DAY;
  };

  // Baseline chatter, weighted by how much a member is actually around. A member who never
  // comes in generates almost no notes, which is itself informative: silence in the note
  // stream and silence in the visit stream are the same member.
  for (const p of profiles) {
    const expected = clamp(p.engagement * 2.4, 0.2, 6);
    const count = Math.round(rng.normalClamped(expected, 1.3, 0, 8));
    for (let i = 0; i < count; i++) {
      const ms = randomDayIn(Math.max(WINDOW_FROM_MS, p.joinedMs), p.activeToMs);
      const sentiment = rng.weighted<MemberNote['sentiment']>([
        ['positive', p.engagement > 1 ? 46 : 26],
        ['neutral', 44],
        ['negative', p.engagement > 1 ? 10 : 24],
      ]);
      const pool =
        sentiment === 'positive' ? POSITIVE_NOTES : sentiment === 'neutral' ? NEUTRAL_NOTES : NEGATIVE_NOTES;
      push(p, ms, sentiment, rng.pick(pool));
    }
  }

  // Anomaly #1 corroboration: the committee minutes that name the cause, then the complaints.
  const boardMembers = weightedSampleWithoutReplacement(
    rng,
    profiles.filter((p) => p.activeToMs >= dayStart('2026-06-01')),
    (p) => p.engagement,
    CHEF_COMMITTEE_NOTES.length,
  );
  const committeeDates = ['2026-01-28', '2026-02-19', '2026-04-16', '2026-06-18'];
  boardMembers.forEach((p, i) => {
    const body = CHEF_COMMITTEE_NOTES[i];
    const date = committeeDates[i];
    if (body === undefined || date === undefined) return;
    push(p, dayStart(date), 'negative', body, 'committee');
  });

  const diningComplainants = weightedSampleWithoutReplacement(
    rng,
    profiles.filter((p) => p.activeToMs >= CHEF_DEPARTURE_MS),
    (p) => p.engagement * (p.member.category === 'social' || p.member.category === 'corporate' ? 1.6 : 1),
    58,
  );
  for (const p of diningComplainants) {
    const from = Math.max(CHEF_DEPARTURE_MS, p.joinedMs);
    const to = Math.min(p.activeToMs, WINDOW_TO_MS);
    if (to <= from) continue;
    push(p, randomDayIn(from, to), 'negative', rng.pick(DINING_COMPLAINTS));
  }
  // A little baseline grumbling about the kitchen before the departure, so the cluster is a
  // genuine step change rather than the sudden appearance of a topic that never existed.
  const priorGrumblers = weightedSampleWithoutReplacement(
    rng,
    profiles.filter((p) => p.joinedMs < dayStart('2025-06-01')),
    () => 1,
    7,
  );
  for (const p of priorGrumblers) {
    push(p, randomDayIn(WINDOW_FROM_MS, CHEF_DEPARTURE_MS - MS_PER_DAY), 'negative', rng.pick(DINING_COMPLAINTS));
  }

  // Anomaly #2 corroboration: members noticing the empty courts themselves.
  const tennisTalkers = weightedSampleWithoutReplacement(
    rng,
    profiles.filter((p) => CATEGORY[p.member.category].facilityWeights['tennis-court'] >= 0.09),
    (p) => p.engagement,
    TENNIS_NOTES.length * 2,
  );
  tennisTalkers.forEach((p, i) => {
    const body = TENNIS_NOTES[i % TENNIS_NOTES.length];
    if (body === undefined) return;
    push(p, randomDayIn(Math.max(WINDOW_FROM_MS, p.joinedMs), p.activeToMs), 'neutral', body);
  });

  // Anomaly #3 corroboration: the drive cohort saying, in their own words, that nobody ever
  // introduced them to anyone.
  for (const p of profiles) {
    if (!p.inDriveCohort) continue;
    if (!rng.bool(0.55)) continue;
    const ms = randomDayIn(p.joinedMs + 20 * MS_PER_DAY, Math.min(p.activeToMs, p.joinedMs + 300 * MS_PER_DAY));
    push(p, ms, rng.bool(0.65) ? 'negative' : 'neutral', rng.pick(ONBOARDING_NOTES));
  }

  // Anomaly #4 corroboration, including the awkward half: the reciprocal programme is
  // revenue, and it is also members queuing behind guests on a Saturday.
  const guestTalkers = weightedSampleWithoutReplacement(
    rng,
    profiles.filter((p) => p.activeToMs >= GUEST_SURGE_FROM_MS),
    (p) => p.engagement,
    GUEST_PROGRAMME_NOTES.length * 2,
  );
  guestTalkers.forEach((p, i) => {
    const body = GUEST_PROGRAMME_NOTES[i % GUEST_PROGRAMME_NOTES.length];
    if (body === undefined) return;
    const sentiment: MemberNote['sentiment'] = i % GUEST_PROGRAMME_NOTES.length >= 4 ? 'neutral' : 'positive';
    push(p, randomDayIn(GUEST_SURGE_FROM_MS, Math.min(p.activeToMs, GUEST_SURGE_TO_MS)), sentiment, body);
  });

  // Disengagement and exit notes. Only about two thirds of decaying members generate a
  // warning note - staff do not write everything down, and a churn model that depends on a
  // note existing would be useless in production.
  for (const p of profiles) {
    if (p.resignationStyle === 'decayed' && p.decayStartMs !== null && rng.bool(0.62)) {
      const noteCount = rng.bool(0.35) ? 2 : 1;
      for (let i = 0; i < noteCount; i++) {
        push(p, randomDayIn(p.decayStartMs, p.activeToMs), 'negative', rng.pick(DISENGAGEMENT_NOTES));
      }
    }
    if (p.member.status === 'resigned' && rng.bool(0.72)) {
      push(p, p.activeToMs, 'negative', rng.pick(EXIT_NOTES), 'email');
    }
    if (p.member.status === 'suspended') {
      push(
        p,
        p.activeToMs,
        'negative',
        'Account suspended for non-payment after three statements and two reminders. Privileges withdrawn pending settlement.',
        'email',
      );
    }
  }

  return notes;
}
