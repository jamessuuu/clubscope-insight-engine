import type { ClubDataset, MemberNote } from '../domain/types.js';
import { type AnalysisTool, type Evidence, makeEvidence } from './evidence.js';
import { optionalOneOf, positiveInt, requiredString } from './common.js';

/**
 * Free-text retrieval over staff notes.
 *
 * ## Why this tool exists at all
 *
 * Every other tool in the registry aggregates structured rows. This one is the unstructured
 * surface, and it is where the qualitative half of club intelligence lives: the front-desk
 * note that says a member has been complaining about court booking for six months is the
 * context that turns a churn score into an action someone can actually take.
 *
 * ## Why it returns rows rather than an answer
 *
 * The tool retrieves and cites; it does not summarise, rank by relevance, or judge. Any
 * summarising is the model's job downstream, over text it can see - which means a reader
 * can always click back to the exact note and check that the model represented it fairly.
 * A retrieval tool that returned its own paraphrase would break that chain, because the
 * paraphrase is the very thing under suspicion.
 */

export const NOTE_SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type NoteSentiment = (typeof NOTE_SENTIMENTS)[number];

export interface SearchMemberNotesParams {
  query: string;
  sentiment?: NoteSentiment;
  limit?: number;
}

export const searchMemberNotes: AnalysisTool<SearchMemberNotesParams> = {
  name: 'search_member_notes',
  version: '1.0.0',
  kind: 'read',
  description:
    'Case-insensitive keyword search across free-text staff notes about members (front ' +
    'desk, email, survey, committee, phone). A note matches when it contains EVERY word in ' +
    'the query as a substring, in any order, so "slow service" finds "service was slow". ' +
    'Optionally filter to positive, neutral or negative notes. Use for "what are members ' +
    'complaining about", finding the story behind a number, or checking whether an issue ' +
    'has been reported before. Returns a table of matching notes with their full text.',
  params: {
    query: {
      type: 'string',
      description:
        'One or more keywords. All of them must appear in a note for it to match, so ' +
        'prefer two or three specific words over a long sentence.',
      required: true,
    },
    sentiment: {
      type: 'enum',
      description:
        'Optional sentiment filter: positive, neutral or negative. Omit to search all notes.',
      enum: [...NOTE_SENTIMENTS],
      required: false,
    },
    limit: {
      type: 'number',
      description:
        'How many matching notes to list. Defaults to 25. The receipt still reports the ' +
        'true total number of matches even when the list is shortened.',
      required: false,
      default: 25,
    },
  },

  run(params: SearchMemberNotesParams, ds: ClubDataset): Evidence {
    const query = requiredString(params.query, 'query');
    const sentiment = optionalOneOf(params.sentiment, 'sentiment', NOTE_SENTIMENTS);
    const limit = positiveInt(params.limit, 'limit', 25);

    // AND over whitespace-separated terms. Plain substring matching on the whole phrase
    // would miss "service was slow" for the query "slow service", which is precisely the
    // sort of near-miss that makes staff stop trusting search and go back to asking around.
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    if (terms.length === 0) throw new Error('"query" must contain at least one search term');

    const matches: MemberNote[] = ds.notes
      .filter((n) => sentiment === undefined || n.sentiment === sentiment)
      .filter((n) => {
        const body = n.body.toLowerCase();
        return terms.every((t) => body.includes(t));
      })
      // Oldest first, tie-broken on id: a stable order means the same query returns the same
      // page of results every time, which is what makes a cited note id worth anything.
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    const listed = matches.slice(0, limit);

    return makeEvidence({
      tool: searchMemberNotes.name,
      version: searchMemberNotes.version,
      params: { query, sentiment, limit },
      value: {
        kind: 'table',
        columns: ['noteId', 'memberId', 'date', 'channel', 'sentiment', 'body'],
        rows: listed.map((n) => [n.id, n.memberId, n.date, n.channel, n.sentiment, n.body]),
      },
      unit: 'none',
      method:
        `Searched all ${ds.notes.length} staff notes` +
        (sentiment === undefined ? '' : ` with sentiment "${sentiment}"`) +
        ` for notes containing every one of: ${terms.map((t) => `"${t}"`).join(', ')} ` +
        `(case-insensitive substring match). ${matches.length} note(s) matched` +
        (listed.length < matches.length ? `; the ${listed.length} oldest are listed.` : '.'),
      // Every match is cited, not just the listed page, so rowCount reports the true size of
      // the result set. A model told "3 notes matched" while shown 2 would otherwise have to
      // guess, and guessing is the failure this system exists to remove.
      rowIds: matches.map((n) => n.id),
    });
  },
};
