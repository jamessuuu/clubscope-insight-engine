/**
 * Domain model for a private club.
 *
 * Deliberately shaped after the fragmentation ClubScope describes on its own site:
 * membership, finance, and engagement normally live in separate systems, and the value
 * appears only when they are queried together. Everything here is one coherent model so
 * a single analysis tool can cross finance and engagement in one pass.
 */

export type ClubKind = 'country' | 'yacht' | 'social' | 'health';

/**
 * Membership categories mirror how real private clubs price and segment. Category drives
 * dues, facility entitlement, and — importantly for churn — expected usage patterns. A
 * Social member playing zero golf is normal; a Full Golf member playing zero golf is a
 * retention emergency. Scoring must know the difference.
 */
export type MembershipCategory =
  | 'full-golf'
  | 'social'
  | 'junior-executive'
  | 'corporate'
  | 'non-resident';

export type MemberStatus = 'active' | 'resigned' | 'suspended';

export interface Member {
  id: string;
  /** Human-facing member number, as staff would refer to them. */
  memberNo: string;
  firstName: string;
  lastName: string;
  email: string;
  category: MembershipCategory;
  status: MemberStatus;
  /** ISO date. Tenure is one of the strongest retention signals in club data. */
  joinedAt: string;
  /** ISO date, present only when status is 'resigned'. Ground truth for model checking. */
  resignedAt?: string;
  householdSize: number;
  /** Age band rather than birth date: enough for cohort analysis, no needless PII shape. */
  ageBand: '20-34' | '35-49' | '50-64' | '65+';
  /** Annual dues in whole dollars, set by category with per-member variation. */
  annualDues: number;
  homeCity: string;
  /** Referral source, useful for acquisition-quality analysis. */
  joinedVia: 'referral' | 'waitlist' | 'corporate' | 'legacy' | 'event';
}

export type RevenueCategory =
  | 'dues'
  | 'dining'
  | 'bar'
  | 'events'
  | 'pro-shop'
  | 'guest-fees'
  | 'lessons';

/**
 * A single money movement. Dues post monthly; everything else is discretionary spend and
 * therefore the leading indicator — discretionary spend falls months before a resignation
 * letter arrives.
 */
export interface Transaction {
  id: string;
  memberId: string;
  /** ISO date. */
  date: string;
  category: RevenueCategory;
  /** Whole dollars. Positive for charges. */
  amount: number;
}

export type FacilityKind =
  | 'golf-course'
  | 'tennis-court'
  | 'dining-room'
  | 'fitness-centre'
  | 'pool'
  | 'marina-berth';

/**
 * A member turning up. Visits are the purest engagement signal a club owns and the one
 * most clubs fail to unify, because each facility books through a different system.
 */
export interface Visit {
  id: string;
  memberId: string;
  /** ISO date-time. */
  at: string;
  facility: FacilityKind;
  /** Guests brought along — a strong advocacy signal. */
  guests: number;
  /** Minutes on site, where the facility records it. */
  durationMin: number;
}

export interface ClubEvent {
  id: string;
  name: string;
  /** ISO date. */
  date: string;
  kind: 'social' | 'tournament' | 'dining' | 'family' | 'member-meeting';
  capacity: number;
}

export interface EventRegistration {
  id: string;
  eventId: string;
  memberId: string;
  attended: boolean;
  guests: number;
}

/**
 * Free-text staff notes. Included because real club intelligence is not only numeric, and
 * because it gives the assistant something genuinely unstructured to retrieve over.
 */
export interface MemberNote {
  id: string;
  memberId: string;
  /** ISO date. */
  date: string;
  author: string;
  channel: 'front-desk' | 'email' | 'survey' | 'committee' | 'phone';
  sentiment: 'positive' | 'neutral' | 'negative';
  body: string;
}

/** The complete unified dataset — the "single source of truth" the product promises. */
export interface ClubDataset {
  club: {
    name: string;
    kind: ClubKind;
    city: string;
    foundedYear: number;
    /** Inclusive ISO date bounds of the data. The assistant must refuse outside these. */
    dataFrom: string;
    dataTo: string;
  };
  members: Member[];
  transactions: Transaction[];
  visits: Visit[];
  events: ClubEvent[];
  registrations: EventRegistration[];
  notes: MemberNote[];
}
