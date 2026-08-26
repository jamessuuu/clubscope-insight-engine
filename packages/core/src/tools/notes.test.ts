import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixture.js';
import { searchMemberNotes } from './notes.js';

const ds = makeFixture();

/** The note ids listed in a result table, in the order the tool returned them. */
function listed(params: Parameters<typeof searchMemberNotes.run>[0]): string[] {
  const value = searchMemberNotes.run(params, ds).value;
  return value.kind === 'table' ? value.rows.map((r) => String(r[0])) : [];
}

describe('search_member_notes', () => {
  it('matches regardless of case', () => {
    // note-01 "is slow and", note-03 "Slow service", note-05 "by slow response".
    expect(listed({ query: 'slow' })).toEqual(['note-01', 'note-03', 'note-05']);
  });

  it('requires every term, in any order', () => {
    // Only note-03 contains both words. Matching the phrase literally would find nothing
    // in "service was slow"-shaped text, and staff stop trusting a search that misses.
    expect(listed({ query: 'slow service' })).toEqual(['note-03']);
    expect(listed({ query: 'service slow' })).toEqual(['note-03']);
  });

  it('filters by sentiment', () => {
    // note-03 mentions slow service but is a positive note overall.
    expect(listed({ query: 'slow', sentiment: 'negative' })).toEqual(['note-01', 'note-05']);
  });

  it('returns results oldest first, deterministically', () => {
    // note-04 is dated 2024-08-08 and note-02 2024-09-02, so date order is not id order:
    // a stable sort is what makes a cited note id mean the same thing on the next run.
    expect(listed({ query: 'golf' })).toEqual(['note-04', 'note-02']);
  });

  it('returns an empty table rather than failing when nothing matches', () => {
    expect(listed({ query: 'marina berth' })).toEqual([]);
    expect(searchMemberNotes.run({ query: 'marina berth' }, ds).rowCount).toBe(0);
  });

  it('reports the true match count even when the listed page is shortened', () => {
    // This is the distinction that keeps the model honest: it is shown one note but told
    // three matched, so it never has to guess at the size of what it did not see.
    const e = searchMemberNotes.run({ query: 'slow', limit: 1 }, ds);
    expect(e.value.kind === 'table' && e.value.rows).toHaveLength(1);
    expect(e.rowCount).toBe(3);
    expect(e.rowIds).toEqual(['note-01', 'note-03', 'note-05']);
    expect(e.method).toContain('3 note(s) matched');
  });

  it('returns the note body verbatim rather than a summary', () => {
    // The retrieval layer cites; the model summarises downstream over text a reader can
    // click back to. A tool that paraphrased would break exactly that audit trail.
    const value = searchMemberNotes.run({ query: 'double-booked' }, ds).value;
    expect(value.kind === 'table' && value.rows[0][5]).toBe(
      'Complained that the tennis court booking system is slow and double-booked him twice.',
    );
  });

  it('rejects an empty query', () => {
    expect(() => searchMemberNotes.run({ query: '   ' }, ds)).toThrow(/required/);
  });
});
