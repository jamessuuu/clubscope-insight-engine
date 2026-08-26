import { describe, expect, it } from 'vitest';
import { scalarOf } from './evidence.js';
import { M1, M3, M5, Q1, Q2, makeFixture } from './fixture.js';
import { avgDiscretionarySpend, topMembersBySpend } from './spend.js';

const ds = makeFixture();

describe('avg_discretionary_spend', () => {
  it('averages non-dues spend over the active roll', () => {
    // Active members' Q1 non-dues spend: 400 + 100 + 300 + 200 = 1,000, over 7 active
    // members => 142.857..., reported to cents as 142.86.
    expect(scalarOf(avgDiscretionarySpend.run({ ...Q1 }, ds))).toBe(142.86);
    expect(scalarOf(avgDiscretionarySpend.run({ ...Q2 }, ds))).toBe(178.57);
  });

  it('excludes dues from the numerator', () => {
    // Q1 total revenue is 2,500, of which 1,000 is dues and 500 belongs to a resigned
    // member. Including dues would put the average at 214.29 and make it move only when
    // the club changes its own fee schedule.
    const e = avgDiscretionarySpend.run({ ...Q1 }, ds);
    expect(e.rowIds).not.toContain('txn-02'); // the Q1 dues posting
    expect(e.method).toMatch(/Dues are excluded/);
  });

  it('keeps numerator and denominator on the same population', () => {
    // m3 resigned but spent 500 on dining in Q1. Crediting the active roll with a departed
    // member's spend is a real reporting bug: the average then rises every time somebody
    // leaves, which is the opposite of what the metric is supposed to signal.
    const e = avgDiscretionarySpend.run({ ...Q1 }, ds);
    expect(e.rowIds).not.toContain('txn-04');
    expect(e.rowIds).not.toContain(M3);
  });

  it('cites both the transactions summed and the members divided by', () => {
    const e = avgDiscretionarySpend.run({ ...Q1 }, ds);
    // 4 qualifying transactions + 7 active members.
    expect(e.rowCount).toBe(11);
    expect(e.rowIds).toContain('txn-01');
    expect(e.rowIds).toContain(M1);
    expect(e.unit).toBe('usd');
  });
});

describe('top_members_by_spend', () => {
  it('ranks members by non-dues spend, largest first', () => {
    // Q1 discretionary: m1 600 (400 dining + 200 lessons), m3 500, m5 300, m2 100.
    expect(topMembersBySpend.run({ ...Q1, limit: 3 }, ds).value).toEqual({
      kind: 'table',
      columns: ['memberId', 'memberNo', 'name', 'status', 'spend'],
      rows: [
        [M1, 'M-001', 'Ada Chen', 'active', 600],
        [M3, 'M-003', 'Cara Diaz', 'resigned', 500],
        [M5, 'M-005', 'Eve Novak', 'active', 300],
      ],
    });
  });

  it('includes members who have since resigned', () => {
    // Their spend is real revenue history; hiding it would misstate what the period earned.
    const rows = topMembersBySpend.run({ ...Q1 }, ds).value;
    expect(rows.kind === 'table' && rows.rows.some((r) => r[0] === M3)).toBe(true);
  });

  it('honours the limit but keeps the receipt whole', () => {
    const e = topMembersBySpend.run({ ...Q1, limit: 2 }, ds);
    expect(e.value.kind === 'table' && e.value.rows).toHaveLength(2);
    // 2 ranked members shown + the 5 Q1 non-dues transactions the whole ranking consumed:
    // a top-2 that hid the rows it beat would not be an auditable ranking.
    expect(e.rowCount).toBe(7);
    expect(e.rowIds.slice(0, 2)).toEqual([M1, M3]);
  });

  it('defaults the limit rather than requiring one', () => {
    const e = topMembersBySpend.run({ ...Q1 }, ds);
    expect(e.params).toMatchObject({ limit: 10 });
    // Only 4 members spent anything in Q1, so the default limit is not reached.
    expect(e.value.kind === 'table' && e.value.rows).toHaveLength(4);
  });

  it('rejects a nonsensical limit', () => {
    expect(() => topMembersBySpend.run({ ...Q1, limit: 0 }, ds)).toThrow(/positive integer/);
  });
});
