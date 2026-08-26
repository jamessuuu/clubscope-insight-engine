import { describe, expect, it } from 'vitest';
import { dataCoverage } from './coverage.js';
import { allRowIds, makeFixture } from './fixture.js';

const ds = makeFixture();

describe('data_coverage', () => {
  it('reports the dataset bounds and every collection size', () => {
    expect(dataCoverage.run({}, ds).value).toEqual({
      kind: 'table',
      columns: ['field', 'value'],
      rows: [
        ['club', 'Harbourview Club'],
        ['dataFrom', '2024-01-01'],
        ['dataTo', '2024-12-31'],
        ['members', 9],
        ['transactions', 17],
        ['visits', 21],
        ['events', 3],
        ['registrations', 7],
        ['notes', 6],
        ['totalRows', 63],
      ],
    });
  });

  it('cites every row in the dataset, because it read every row', () => {
    const e = dataCoverage.run({}, ds);
    expect(e.rowCount).toBe(allRowIds(ds).size);
    expect(e.rowCount).toBe(63);
    expect(new Set(e.rowIds)).toEqual(allRowIds(ds));
  });

  it('states the refusal boundary in plain English, for the model to act on', () => {
    // The method text is what the assistant reads back before deciding whether a question
    // is answerable at all, so the range has to be in the sentence, not only in the table.
    const method = dataCoverage.run({}, ds).method;
    expect(method).toContain('2024-01-01');
    expect(method).toContain('2024-12-31');
    expect(method).toMatch(/cannot be answered/);
  });

  it('takes no arguments, so the model cannot narrow its own boundary check', () => {
    expect(dataCoverage.params).toEqual({});
    expect(dataCoverage.run({}, ds).params).toEqual({});
  });
});
