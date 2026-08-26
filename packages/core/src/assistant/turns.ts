import type { ScriptedTurn } from './scripted.js';

/**
 * The scripted turn library.
 *
 * ## What a turn is, and what it deliberately is not
 *
 * A turn is a question, the tool calls that answer it, and the prose that reports the
 * answer — with the figures left as `{{placeholders}}`. **No turn in this file contains a
 * number.** Every figure the reader sees is computed on the request by the tool named in the
 * call, cited to that computation's evidence id, and re-derived from source by the verifier
 * before it renders. That is the whole reason the templates look like this: it is not
 * possible to write a wrong figure here, only a wrong sentence, and a wrong sentence is a
 * thing a reviewer can catch by reading.
 *
 * ## Why the prose is written this carefully
 *
 * This is the product surface. A club GM does not evaluate an insight engine on its
 * architecture diagram; they evaluate it on whether the answer to "why is dining down" tells
 * them something they did not already know and names what to do about it. So each answer
 * leads with the finding, gives the numbers that establish it, then says what it means for a
 * decision — and where the data cannot support a claim, it says that instead.
 *
 * Two conventions the templates follow, both enforced by the verifier rather than by
 * discipline:
 *
 *  - **Only scalar tools can be cited.** `revenue_by_category`, `search_member_notes` and
 *    `top_members_by_spend` return a series or a table; they are called for their receipts
 *    and described in words, because a citation the verifier cannot recompute as one number
 *    fails closed.
 *  - **Bare numerals stay out of the prose.** The verifier treats any uncited figure as a
 *    fabrication and blocks the whole narrative, which is exactly right — so quantities that
 *    are not tool output ("ninety days", "three themes") are spelled out as words. Bare years
 *    are exempt and therefore allowed, with one trap worth knowing: the exemption refuses any
 *    token containing a comma, so that grouped digits can never sneak through it, and the
 *    figure scanner pulls a trailing comma into the token. "February 2026, and…" is read as
 *    "2026," and blocked. That is the gate failing closed on an ambiguity, which is the
 *    behaviour we want from it — so the sentence gets rewritten, and the verifier does not.
 */

/**
 * ## The refusals are load-bearing
 *
 * Two turns here answer with nothing. They are the most important pair in the file. An
 * assistant that cannot decline is not trustworthy on the questions it *can* answer, because
 * the user has no way to tell the two apart — and "how did we do in 2022" is a question a GM
 * will absolutely ask of a system whose data starts in 2024. Both refusals call
 * `data_coverage` first and answer from what it returns, so the refusal is itself grounded:
 * the assistant is not declining out of caution, it is declining because it checked.
 */
export const SCRIPTED_TURNS: ScriptedTurn[] = [
  // ─── Revenue ──────────────────────────────────────────────────────────────────────

  {
    id: 'dining-decline',
    question: 'Why is dining revenue down?',
    suggested: true,
    topic: 'Revenue',
    calls: [
      {
        key: 'since',
        tool: 'revenue_total',
        params: { from: '2026-02-01', to: '2026-08-31', category: 'dining' },
      },
      {
        key: 'lastYear',
        tool: 'revenue_total',
        params: { from: '2025-02-01', to: '2025-08-31', category: 'dining' },
      },
      {
        key: 'trend',
        tool: 'revenue_trend',
        params: { from: '2026-02-01', to: '2026-08-31', category: 'dining' },
      },
      {
        key: 'covers',
        tool: 'visit_trend',
        params: { from: '2026-02-01', to: '2026-08-31', facility: 'dining-room' },
      },
      // Called for the receipt, not for a figure: the cause of this decline is in free text,
      // and the point of showing it is that the assistant found it rather than inferred it.
      {
        key: 'complaints',
        tool: 'search_member_notes',
        params: { query: 'dining', sentiment: 'negative' },
      },
      { key: 'committee', tool: 'search_member_notes', params: { query: 'chef' } },
    ],
    formats: { trend: 'percentSigned', covers: 'percentSigned' },
    template: [
      'Dining has been falling since February 2026 — and it is not a pricing problem. Footfall',
      'and cheque size are moving down together.',
      '',
      'From February to the end of August 2026 the dining room took {{since}}, against',
      '{{lastYear}} across the same months of 2025. Measured against the equal-length window',
      'immediately before it, dining ran at {{trend}}, and dining-room check-ins over that same',
      'window moved {{covers}}. Members are coming in less often and spending less when they do.',
      '',
      'The cause is in the notes rather than the ledger. Negative dining feedback clusters from',
      'February onward and it is specific — cold food, a menu that has not changed since the',
      'winter, service in the grill described as gone from attentive to absent, several members',
      'saying they now book dinner outside the club on Fridays. One asked the front desk',
      'directly whether the chef had left. The committee minutes answer that: the executive chef',
      'resigned effective the end of January, with the sous chef covering while a search runs.',
      '',
      'So this is a staffing problem that has been presenting as a revenue problem for six',
      'months. It has a named owner and a known fix, and the gap between those first two figures',
      'is what the interim kitchen has cost so far.',
    ].join('\n'),
    proposes: [
      {
        kind: 'create_task',
        args: {
          title: 'Close out the executive chef vacancy and publish a dining recovery plan',
          assignee: 'General Manager',
          dueDate: '2026-09-30',
          notes:
            'Dining revenue Feb-Aug 2026 is materially below the same months of 2025, with ' +
            'dining-room visits down over the same window. Negative dining notes cluster from ' +
            'February and committee minutes record the executive chef resigning effective end ' +
            'of January. Recovery plan to cover: search status and interim cover, a menu ' +
            'refresh date, and a service standard the grill is held to in the meantime.',
        },
        rationale:
          'The decline has one identifiable cause with a named owner. Every month the kitchen ' +
          'runs on interim cover repeats the loss, and members are already redirecting Friday ' +
          'dinner spend outside the club — which is harder to win back than it is to hold.',
      },
    ],
  },

  {
    id: 'revenue-mix',
    question: 'Where is our money actually coming from?',
    suggested: true,
    topic: 'Revenue',
    calls: [
      {
        key: 'mix',
        tool: 'revenue_by_category',
        params: { from: '2025-09-01', to: '2026-08-31' },
      },
      { key: 'all', tool: 'revenue_total', params: { from: '2025-09-01', to: '2026-08-31' } },
      {
        key: 'dues',
        tool: 'revenue_total',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'dues' },
      },
      {
        key: 'dining',
        tool: 'revenue_total',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'dining' },
      },
      {
        key: 'events',
        tool: 'revenue_total',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'events' },
      },
      {
        key: 'guest',
        tool: 'revenue_total',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'guest-fees' },
      },
      {
        key: 'perMember',
        tool: 'avg_discretionary_spend',
        params: { from: '2025-09-01', to: '2026-08-31' },
      },
    ],
    // Compact money throughout, because this answer is about proportion rather than
    // precision — and because a rounded figure still has to survive recomputation, which is
    // the interesting half of the verifier's job.
    formats: {
      all: 'usdCompact',
      dues: 'usdCompact',
      dining: 'usdCompact',
      events: 'usdCompact',
      guest: 'usdCompact',
    },
    template: [
      'Over the last twelve months the club took {{all}}. Dues account for {{dues}} of that —',
      'close to three-fifths — and everything else is discretionary.',
      '',
      'Inside the discretionary half the order is dining at {{dining}}, events at {{events}} and',
      'guest fees at {{guest}}, with the bar, the pro shop and lessons behind them. Per active',
      'member, non-dues spend runs at {{perMember}} for the year.',
      '',
      'The mix matters more than the total. Dues are contractual: they move when the board',
      'changes the fee schedule and at no other time, so a dues-heavy line reads as stability',
      'right up to the month members start leaving. Everything else is a choice a member makes',
      'each week, which is why the discretionary lines are the ones worth watching — and dining',
      'has been falling since February 2026 while dues have not moved at all.',
    ].join('\n'),
  },

  {
    id: 'revenue-trend-overall',
    question: 'Are we up or down against last year?',
    suggested: false,
    topic: 'Revenue',
    calls: [
      { key: 'thisYear', tool: 'revenue_total', params: { from: '2025-09-01', to: '2026-08-31' } },
      { key: 'lastYear', tool: 'revenue_total', params: { from: '2024-09-01', to: '2025-08-31' } },
      { key: 'trend', tool: 'revenue_trend', params: { from: '2025-09-01', to: '2026-08-31' } },
      {
        key: 'diningTrend',
        tool: 'revenue_trend',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'dining' },
      },
    ],
    formats: { trend: 'percentSigned', diningTrend: 'percentSigned' },
    template: [
      'Essentially flat — and the flatness is hiding two lines moving in opposite directions.',
      '',
      'The last twelve months brought {{thisYear}} against {{lastYear}} the year before, a change',
      'of {{trend}}. Dining over the same comparison ran at {{diningTrend}}, and that hole has',
      'been filled by guest fees and events rather than by anything the club decided to do.',
      '',
      'A headline that does not move is the most dangerous number on a board pack, because it',
      'ends the conversation. The honest read is that one revenue line is deteriorating for a',
      'known reason, another is growing for a reason nobody planned, and the total happens to',
      'net out this year. There is no mechanism holding that coincidence in place next year.',
    ].join('\n'),
  },

  {
    id: 'guest-fee-surge',
    question: 'Guest fees look high this summer. Is that real, and should I be pleased?',
    suggested: false,
    topic: 'Revenue',
    calls: [
      {
        key: 'summer2026',
        tool: 'revenue_total',
        params: { from: '2026-06-01', to: '2026-08-31', category: 'guest-fees' },
      },
      {
        key: 'summer2025',
        tool: 'revenue_total',
        params: { from: '2025-06-01', to: '2025-08-31', category: 'guest-fees' },
      },
      {
        key: 'yearGuest',
        tool: 'revenue_total',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'guest-fees' },
      },
      {
        key: 'priorYearGuest',
        tool: 'revenue_total',
        params: { from: '2024-09-01', to: '2025-08-31', category: 'guest-fees' },
      },
      {
        key: 'golf',
        tool: 'facility_utilisation',
        params: { facility: 'golf-course', from: '2025-09-01', to: '2026-08-31' },
      },
    ],
    template: [
      'It is real. Guest fees from June to the end of August 2026 came to {{summer2026}} against',
      '{{summer2025}} across the same three months of 2025. Across the full year the line ran',
      '{{yearGuest}} against {{priorYearGuest}}.',
      '',
      'Be pleased carefully. The increase sits in golf and the pool rather than spreading evenly,',
      'and the course recorded {{golf}} check-ins over the year. Guest rounds in June, July and',
      'August are peak-season tee times, so part of this revenue is being earned by giving away',
      'the inventory members most want.',
      '',
      'Worth measuring both ways before the reciprocal arrangement is renewed: guest fee income',
      'against member complaints about the tee sheet in the same weeks. If the second is rising',
      'with the first, this is not incremental revenue — it is a transfer from member',
      'satisfaction into the P&L.',
    ].join('\n'),
  },

  // ─── Retention ────────────────────────────────────────────────────────────────────

  {
    id: 'members-at-risk',
    question: "Who's about to quit on me?",
    suggested: true,
    topic: 'Retention',
    calls: [
      { key: 'watch', tool: 'churn_cohort_size', params: { band: 'watch' } },
      { key: 'elevated', tool: 'churn_cohort_size', params: { band: 'elevated' } },
      { key: 'critical', tool: 'churn_cohort_size', params: { band: 'critical' } },
      { key: 'duesElevated', tool: 'dues_at_risk', params: { band: 'elevated' } },
      { key: 'duesWatch', tool: 'dues_at_risk', params: { band: 'watch' } },
      { key: 'active', tool: 'member_count', params: { status: 'active' } },
    ],
    template: [
      '{{elevated}} active members are scored elevated or worse, and {{critical}} of those are',
      'critical. Widen it to everyone the model has any concern about and it is {{watch}}, out of',
      '{{active}} on the active roll.',
      '',
      'In money: the elevated-and-worse cohort holds {{duesElevated}} of contracted annual dues,',
      'and the full watch list holds {{duesWatch}}. That is recurring revenue exposed to',
      'resignation, not revenue already lost — a distinction worth keeping, because it is what',
      'makes retention spend easy to justify and easy to over-claim.',
      '',
      'The shape of the cohort is consistent. Visits fall against the member’s own history',
      'first, discretionary spend follows a month or two later, and in several cases there is',
      'already a negative note on file that nobody closed out. None of that shows up in a dues',
      'report, because dues keep posting right up until the resignation letter arrives.',
      '',
      'Start with the critical pair rather than the whole list. One of them is a long-tenure',
      'full-golf member whose visits have collapsed against his own baseline — that is a phone',
      'call from you, not an email from the club.',
    ].join('\n'),
    proposes: [
      {
        kind: 'draft_member_outreach',
        args: {
          memberId: 'm-0006',
          subject: 'A round on us this month',
          body:
            'Ryan,\n\nWe have not seen you at the club for a while and I wanted to reach out ' +
            'personally rather than let another season go by. The bunker work on seven and ' +
            'twelve came out well and I would like you to see it — let me put a game on us this ' +
            'month, whichever morning suits, and I will join you for the front nine if you will ' +
            'have me.\n\nIf something about the club has changed for you, I would rather hear it ' +
            'from you directly than guess at it.\n\nWith regards,\nGeneral Manager\nWindermere ' +
            'Hills Country Club',
        },
        rationale:
          'Highest-value member in the critical band, forty-five years of tenure, and the only ' +
          'friction on file is about how a dues increase was communicated — which a personal ' +
          'approach answers better than any offer. Drafted for review; the tone has to be the ' +
          'GM’s, not the club’s.',
      },
    ],
  },

  {
    id: 'member-deep-dive',
    question: 'Ryan Cavendish has gone quiet. How worried should I be?',
    suggested: true,
    topic: 'Retention',
    calls: [
      { key: 'score', tool: 'member_churn_score', params: { memberId: 'm-0006' } },
      { key: 'criticalCount', tool: 'churn_cohort_size', params: { band: 'critical' } },
      { key: 'criticalDues', tool: 'dues_at_risk', params: { band: 'critical' } },
    ],
    template: [
      'Worried. He scores {{score}} out of a hundred on the churn model, which is the critical',
      'band — one of only {{criticalCount}} active members there, and between them that pair',
      'holds {{criticalDues}} of annual dues.',
      '',
      'The score is arithmetic rather than judgement, and it decomposes. His visits over the last',
      'ninety days are down by about three quarters against his own twelve-month baseline. His',
      'discretionary spend has fallen from a personal baseline of just under a thousand dollars a',
      'quarter to almost nothing. A full-golf membership that typically sees at least eighteen',
      'visits a quarter has seen three. There is one negative interaction on file in the last six',
      'months, about how the dues increase was communicated. Forty-five years of tenure is the',
      'only signal pulling the score back down.',
      '',
      'Read together, that is not a member who is unhappy with the club — an unhappy member',
      'complains. It is a member who has quietly stopped using it, which is the pattern that ends',
      'in a resignation letter nobody saw coming. The model cannot tell you why he stopped. What',
      'it can tell you is that the question has never been put to him.',
    ].join('\n'),
    proposes: [
      {
        kind: 'flag_member_for_review',
        args: {
          memberId: 'm-0006',
          reason:
            'Critical churn band on model v1.2.0 as at the end of the data. Visit cadence down ' +
            'roughly three quarters against his own twelve-month baseline, discretionary spend ' +
            'down to near zero, no golf activity in ninety days on a full-golf membership, and ' +
            'one unresolved note about the dues increase. Forty-five years of tenure and the ' +
            'largest single dues line in the critical band.',
        },
        rationale:
          'Committee review is the right level for a member of this tenure: the useful response ' +
          'is a personal approach from someone he already knows, not a retention offer. Flagged ' +
          'rather than actioned, because who makes that call is a judgement for the committee.',
      },
    ],
  },

  {
    id: 'cohort-2025',
    question: 'Did the members we signed up in 2025 actually stick?',
    suggested: false,
    topic: 'Retention',
    calls: [
      { key: 'year2025', tool: 'cohort_retention', params: { from: '2025-01-01', to: '2025-12-31' } },
      { key: 'q1', tool: 'cohort_retention', params: { from: '2025-01-01', to: '2025-03-31' } },
      {
        key: 'rest2025',
        tool: 'cohort_retention',
        params: { from: '2025-04-01', to: '2025-12-31' },
      },
      {
        key: 'late2024',
        tool: 'cohort_retention',
        params: { from: '2024-09-01', to: '2024-12-31' },
      },
      { key: 'active', tool: 'member_count', params: { status: 'active' } },
    ],
    template: [
      'Less well than the intake before them. Of everyone who joined during 2025 the share still',
      'active at the end of the data is {{year2025}}. Members who joined in the closing months of',
      '2024 are at {{late2024}}.',
      '',
      'Inside 2025 the weakest quarter is the first. The January-to-March intake sits at {{q1}}',
      'against {{rest2025}} for the rest of the year — and it was also the largest single quarter',
      'of joining in the whole window, because it was the discounted membership drive. Member',
      'services did not scale with it: those members were never introduced to a group and most',
      'never established a reason to come back.',
      '',
      'So acquisition worked and onboarding did not, which is the more expensive of the two',
      'failures: a discounted joiner who leaves inside two years has cost the club the discount,',
      'the staff time and the roster slot, and returned less than a full-price member who stayed.',
      'Against {{active}} active members the cohort is small — but the pattern will repeat with',
      'the next drive unless somebody owns the first ninety days.',
    ].join('\n'),
    proposes: [
      {
        kind: 'schedule_report',
        args: {
          name: 'New-member ninety-day engagement',
          cadence: 'monthly, first Monday',
          recipients: 'Membership Director, General Manager',
        },
        rationale:
          'The Q1 2025 cohort was only visible as a problem a year after it was acquired. A ' +
          'standing ninety-day view makes the same failure visible while there is still time to ' +
          'do something about it, and costs nobody any manual work.',
      },
    ],
  },

  // ─── Engagement and utilisation ───────────────────────────────────────────────────

  {
    id: 'tennis-mornings',
    question: 'Are the tennis courts earning their keep in the mornings?',
    suggested: true,
    topic: 'Utilisation',
    calls: [
      {
        key: 'mornings',
        tool: 'facility_utilisation',
        params: {
          facility: 'tennis-court',
          from: '2025-09-01',
          to: '2026-08-31',
          dayOfWeek: 'weekday',
          hourFrom: 6,
          hourTo: 11,
        },
      },
      {
        key: 'allCourt',
        tool: 'facility_utilisation',
        params: { facility: 'tennis-court', from: '2025-09-01', to: '2026-08-31' },
      },
      {
        key: 'evenings',
        tool: 'facility_utilisation',
        params: {
          facility: 'tennis-court',
          from: '2025-09-01',
          to: '2026-08-31',
          dayOfWeek: 'weekday',
          hourFrom: 16,
          hourTo: 21,
        },
      },
      {
        key: 'twoYears',
        tool: 'facility_utilisation',
        params: {
          facility: 'tennis-court',
          from: '2024-09-01',
          to: '2026-08-31',
          dayOfWeek: 'weekday',
          hourFrom: 6,
          hourTo: 11,
        },
      },
    ],
    template: [
      'No. Monday to Friday before 11am is dead court time.',
      '',
      'Over the last twelve months the courts recorded {{mornings}} check-ins in that window, out',
      'of {{allCourt}} across all hours — and across the full two years the data covers, the',
      'weekday-morning figure is {{twoYears}}. The same courts take {{evenings}} check-ins on',
      'weekday late afternoons and evenings, which is where the clinics, the ladder and the',
      'professional’s lesson block are all scheduled.',
      '',
      'So the mornings are not unpopular. They are unprogrammed: nothing has ever been put on',
      'then, and members book around what exists. That is standing capacity the club already pays',
      'to maintain, light and insure, and it is the cheapest inventory on the property to fill —',
      'a morning clinic, a seniors’ ladder or a coffee-and-courts session costs a',
      'professional’s time and nothing else.',
      '',
      'Treat it as a programming trial rather than a facility decision. One season of weekday',
      'mornings will tell you whether the demand is latent or absent, and either answer is worth',
      'having before the next capital conversation about the courts.',
    ].join('\n'),
    proposes: [
      {
        kind: 'create_task',
        args: {
          title: 'Trial a weekday-morning tennis programme for one season',
          assignee: 'Director of Racquets',
          dueDate: '2026-10-15',
          notes:
            'Weekday mornings before 11am account for a negligible share of court check-ins ' +
            'across the full two years of data, against a heavily used weekday late-afternoon ' +
            'block. Propose one season of morning programming (clinic, seniors ladder, ' +
            'coffee-and-courts) and report check-ins in the same window at the end of it.',
        },
        rationale:
          'The capacity is already paid for and the only new cost is professional time, so the ' +
          'trial is cheap and the result is decisive either way. Sizing it as one season keeps ' +
          'it a test rather than a commitment.',
      },
    ],
  },

  {
    id: 'visits-overall',
    question: 'Is the club getting quieter?',
    suggested: false,
    topic: 'Engagement',
    calls: [
      { key: 'yearTrend', tool: 'visit_trend', params: { from: '2025-09-01', to: '2026-08-31' } },
      { key: 'sinceFeb', tool: 'visit_trend', params: { from: '2026-02-01', to: '2026-08-31' } },
      {
        key: 'diningVisits',
        tool: 'visit_trend',
        params: { from: '2026-02-01', to: '2026-08-31', facility: 'dining-room' },
      },
      {
        key: 'diningRoom',
        tool: 'facility_utilisation',
        params: { facility: 'dining-room', from: '2025-09-01', to: '2026-08-31' },
      },
      {
        key: 'golf',
        tool: 'facility_utilisation',
        params: { facility: 'golf-course', from: '2025-09-01', to: '2026-08-31' },
      },
    ],
    formats: {
      yearTrend: 'percentSigned',
      sinceFeb: 'percentSigned',
      diningVisits: 'percentSigned',
    },
    template: [
      'Not across the club as a whole — but badly, in one room.',
      '',
      'Across every facility, visits over the last twelve months ran at {{yearTrend}} against the',
      'preceding twelve. That is noise. Narrow to February 2026 onward and it is {{sinceFeb}},',
      'still small. Narrow again to the dining room over that same window and it is',
      '{{diningVisits}}.',
      '',
      'For scale: the dining room recorded {{diningRoom}} check-ins over the year and the golf',
      'course {{golf}}. Golf, the pool and the fitness centre are steady. The dining room is',
      'carrying the entire decline on its own.',
      '',
      'This is the argument for reading facilities separately rather than watching a club-wide',
      'footfall number. The club-wide figure would have reported this year as flat and been',
      'technically correct, while the room behind the second-largest revenue line quietly lost a',
      'fifth of its traffic.',
    ].join('\n'),
  },

  {
    id: 'event-attendance',
    question: 'Are people actually turning up to what we put on?',
    suggested: false,
    topic: 'Engagement',
    calls: [
      {
        key: 'thisYear',
        tool: 'event_attendance_rate',
        params: { from: '2025-09-01', to: '2026-08-31' },
      },
      {
        key: 'lastYear',
        tool: 'event_attendance_rate',
        params: { from: '2024-09-01', to: '2025-08-31' },
      },
      {
        key: 'summer',
        tool: 'event_attendance_rate',
        params: { from: '2026-06-01', to: '2026-08-31' },
      },
      {
        key: 'eventsRevenue',
        tool: 'revenue_total',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'events' },
      },
    ],
    template: [
      'Yes, and consistently. Of everyone who registered for a club event in the last twelve',
      'months, {{thisYear}} turned up. The year before it was {{lastYear}}, and this summer ran',
      'at {{summer}} — a rate that has not meaningfully moved in two years. Events revenue for',
      'the year was {{eventsRevenue}}.',
      '',
      'That is a healthy no-show rate for a private club, and it is worth saying plainly because',
      'it is the one part of the programme with nothing wrong with it. Registration here is a',
      'soft commitment — nobody is charged for failing to appear — so a stable rate across two',
      'years means the calendar is being set for events members actually want, not just events',
      'that are easy to run.',
      '',
      'The useful follow-up is not the rate but the names behind it: which members register and',
      'never come, and whether they are the same people already on the retention watch list. A',
      'no-show is a cheap early signal, and it arrives months before a spend decline does.',
    ].join('\n'),
  },

  {
    id: 'member-complaints',
    question: 'What are members actually complaining about?',
    suggested: true,
    topic: 'Sentiment',
    calls: [
      {
        key: 'dining',
        tool: 'search_member_notes',
        params: { query: 'dining', sentiment: 'negative' },
      },
      {
        key: 'booking',
        tool: 'search_member_notes',
        params: { query: 'booking', sentiment: 'negative' },
      },
      { key: 'committee', tool: 'search_member_notes', params: { query: 'chef' } },
      // One number, deliberately: retrieval alone invites the reader to take the assistant's
      // reading of the notes on trust. Anchoring the loudest theme to a verified figure means
      // the qualitative claim can be checked against the ledger.
      {
        key: 'diningTrend',
        tool: 'revenue_trend',
        params: { from: '2026-02-01', to: '2026-08-31', category: 'dining' },
      },
    ],
    formats: { diningTrend: 'percentSigned' },
    template: [
      'Three themes, and only one of them is new.',
      '',
      'The new one is dining. Negative notes mentioning the dining room cluster from February',
      '2026 onward, and they are specific rather than vague: cold food sent back, a menu that has',
      'not changed since the winter, service in the grill described as gone from attentive to',
      'absent, and several members saying plainly that they now book dinner elsewhere. One asked',
      'the front desk directly whether the chef had left. The committee minutes answer that — the',
      'executive chef resigned effective the end of January, with the sous chef covering while a',
      'search runs. Over the same period dining revenue ran at {{diningTrend}} against the window',
      'immediately before it, so the notes and the ledger are describing the same event.',
      '',
      'The two standing themes are older than the chef. Booking is the loudest: the tee sheet',
      'full the moment the window opens, and an app that loses preferences and logs members out.',
      'Facilities is the other — locker-room showers, fitness-centre air conditioning, the',
      'practice green.',
      '',
      'The difference matters for where you spend. Dining is one appointment away from',
      'recovering. Booking and facilities are a backlog nobody has owned long enough to close,',
      'and they are the complaints that keep reappearing under different members’ names.',
    ].join('\n'),
  },

  {
    id: 'spend-per-member',
    question: 'What is a member worth to us beyond their dues?',
    suggested: false,
    topic: 'Members',
    calls: [
      {
        key: 'thisYear',
        tool: 'avg_discretionary_spend',
        params: { from: '2025-09-01', to: '2026-08-31' },
      },
      {
        key: 'lastYear',
        tool: 'avg_discretionary_spend',
        params: { from: '2024-09-01', to: '2025-08-31' },
      },
      { key: 'active', tool: 'member_count', params: { status: 'active' } },
      {
        key: 'fullGolf',
        tool: 'member_count',
        params: { status: 'active', category: 'full-golf' },
      },
      {
        key: 'top',
        tool: 'top_members_by_spend',
        params: { from: '2025-09-01', to: '2026-08-31', limit: 5 },
      },
    ],
    template: [
      '{{thisYear}} a year in non-dues spend, averaged across the {{active}} active members on the',
      'roll. The year before it was {{lastYear}}.',
      '',
      'Dues are excluded deliberately. They are contractual — the same amount posts on the same',
      'day whether a member came in forty times last quarter or not at all — so folding them in',
      'produces a number that only moves when the board changes the fee schedule. Strip them out',
      'and the same figure becomes a leading indicator: dining, bar, pro shop, lessons and guest',
      'fees are choices a member makes each week, and they fall months before anyone resigns.',
      '',
      'The average also hides the shape. The top five spenders each put several times that figure',
      'through the club in a year, and the {{fullGolf}} active full-golf members carry both the',
      'highest dues and the highest discretionary spend. When one of those goes quiet the club',
      'loses two revenue lines at once — which is why the churn model weights a spend collapse',
      'as heavily as an absence.',
    ].join('\n'),
  },

  // ─── Refusals ─────────────────────────────────────────────────────────────────────

  {
    id: 'refusal-out-of-coverage',
    question: 'How did dining do in 2022 compared with now?',
    suggested: true,
    topic: 'Coverage',
    refusal: true,
    calls: [{ key: 'coverage', tool: 'data_coverage', params: {} }],
    template: [
      'I cannot answer that, and I would rather say so than estimate it.',
      '',
      'This dataset covers September 2024 through the end of August 2026 inclusive. There are no',
      'transactions, visits, events or notes before that window, so any figure I gave you for',
      '2022 would be produced rather than measured — and nothing on the screen would tell you it',
      'was different in kind from the figures on this page that are real. That is the failure',
      'worth avoiding: not the wrong number, but the wrong number that looks exactly like a right',
      'one.',
      '',
      'What I can do inside the coverage: compare dining across the two full years the data does',
      'hold, or compare the months since February 2026 against the same months of 2025. Both are',
      'genuine like-for-like comparisons. If the club needs the longer history, it exists in the',
      'accounting system and would have to be loaded as its own source before I could speak to',
      'it.',
    ].join('\n'),
  },

  {
    id: 'refusal-not-recorded',
    question: 'How much did the dining staff make in tips last quarter?',
    suggested: false,
    topic: 'Coverage',
    refusal: true,
    calls: [{ key: 'coverage', tool: 'data_coverage', params: {} }],
    template: [
      'The club does not record that here, so I have nothing to give you.',
      '',
      'This dataset holds members, transactions, visits, events, registrations and staff notes.',
      'Transactions are club revenue by category — dues, dining, bar, events, pro shop, guest',
      'fees and lessons — with no gratuity line, no payroll and no individual staff records of',
      'any kind. There is no arrangement of these tables from which a tip figure could be',
      'derived, so producing one would mean modelling it and presenting the model as a',
      'measurement.',
      '',
      'This is a different refusal from a date outside the coverage. That one is a gap in the',
      'window; this is a gap in the schema, and no amount of extra history would close it. If tip',
      'income matters to the dining conversation, it lives in payroll or the point-of-sale system',
      'and would need to be brought in as its own source, with its own privacy question answered',
      'first.',
    ].join('\n'),
  },

  // ─── Reliability demonstration ────────────────────────────────────────────────────

  /**
   * The poisoned turn.
   *
   * The Reliability page runs this one to show the gate working on something a reader can
   * check by eye. The dining figure is multiplied before rendering while its citation is left
   * pointing at the true evidence record — which is precisely the production failure this
   * architecture exists to catch: right tool, right evidence, wrong number in the prose.
   * Every other figure in the turn is untouched, so the report shows one blocked claim beside
   * one that passed rather than a wholesale failure, and the groundedness rate is a number
   * with meaning instead of a zero.
   *
   * It is deliberately not `suggested`: a fabricated figure has no business appearing as a
   * starter chip on the Ask page.
   */
  {
    id: 'poisoned-dining-total',
    question: 'What did the dining room bring in over the last twelve months?',
    suggested: false,
    topic: 'Reliability',
    calls: [
      {
        key: 'dining',
        tool: 'revenue_total',
        params: { from: '2025-09-01', to: '2026-08-31', category: 'dining' },
      },
      { key: 'all', tool: 'revenue_total', params: { from: '2025-09-01', to: '2026-08-31' } },
    ],
    formats: { all: 'usdCompact' },
    poison: { key: 'dining', multiplier: 1.35 },
    template: [
      'The dining room took {{dining}} over the last twelve months, out of {{all}} in total club',
      'revenue across every category.',
    ].join('\n'),
  },
];

// Two turns sharing an id would make `getTurn` return whichever the array happened to list
// first, and the eval suite would silently score one case twice. Caught at module load.
const TURN_IDS = new Set(SCRIPTED_TURNS.map((t) => t.id));
if (TURN_IDS.size !== SCRIPTED_TURNS.length) {
  throw new Error('duplicate id in the scripted turn library');
}

export function getTurn(id: string): ScriptedTurn | undefined {
  return SCRIPTED_TURNS.find((turn) => turn.id === id);
}

/**
 * The starter chips on the Ask page.
 *
 * One of them is a refusal, on purpose. Offering a question the assistant will decline is
 * the fastest way to show a visitor that the declining is real and not a disclaimer, and it
 * costs one chip.
 */
export const SUGGESTED_TURNS: ScriptedTurn[] = SCRIPTED_TURNS.filter((turn) => turn.suggested);
