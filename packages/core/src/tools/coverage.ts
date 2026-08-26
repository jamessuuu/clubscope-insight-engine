import type { ClubDataset } from '../domain/types.js';
import { type AnalysisTool, type Evidence, makeEvidence } from './evidence.js';

/**
 * What the dataset actually contains.
 *
 * This is the least glamorous tool in the registry and the most load-bearing. An assistant
 * with no way to learn its own boundaries will answer "how did we do in 2019?" with a
 * confident, fabricated number, because producing text is always easier than declining to.
 * Giving it a cheap, authoritative way to discover the date bounds turns refusal into the
 * path of least resistance - which is the only reliable way to get a model to refuse.
 */

export type DataCoverageParams = Record<string, never>;

export const dataCoverage: AnalysisTool<DataCoverageParams> = {
  name: 'data_coverage',
  version: '1.0.0',
  kind: 'read',
  description:
    'Returns the inclusive date range the club dataset covers and the number of rows in ' +
    'each collection (members, transactions, visits, events, registrations, notes). Call ' +
    'this FIRST whenever a question names a date, month, quarter or year, and refuse the ' +
    'question if the requested period falls outside the returned range. Takes no arguments.',
  params: {},

  run(_params: DataCoverageParams, ds: ClubDataset): Evidence {
    const counts: Array<[string, number, string[]]> = [
      ['members', ds.members.length, ds.members.map((m) => m.id)],
      ['transactions', ds.transactions.length, ds.transactions.map((t) => t.id)],
      ['visits', ds.visits.length, ds.visits.map((v) => v.id)],
      ['events', ds.events.length, ds.events.map((e) => e.id)],
      ['registrations', ds.registrations.length, ds.registrations.map((r) => r.id)],
      ['notes', ds.notes.length, ds.notes.map((n) => n.id)],
    ];

    const totalRows = counts.reduce((sum, [, n]) => sum + n, 0);

    // Coverage genuinely reads every row in the dataset, so every row id is cited. The
    // Evidence helper caps the stored list at 500 while keeping rowCount truthful, which is
    // exactly the behaviour a receipt needs: legible, but never understating its own scope.
    const rowIds = counts.flatMap(([, , ids]) => ids);

    return makeEvidence({
      tool: dataCoverage.name,
      version: dataCoverage.version,
      params: {},
      value: {
        kind: 'table',
        columns: ['field', 'value'],
        rows: [
          ['club', ds.club.name],
          ['dataFrom', ds.club.dataFrom],
          ['dataTo', ds.club.dataTo],
          ...counts.map(([label, n]) => [label, n] as Array<string | number>),
          ['totalRows', totalRows],
        ],
      },
      unit: 'none',
      method:
        `The club dataset covers ${ds.club.dataFrom} to ${ds.club.dataTo} inclusive and ` +
        `holds ${totalRows} rows in total: ` +
        counts.map(([label, n]) => `${n} ${label}`).join(', ') +
        '. Questions about any date outside this range cannot be answered from this data.',
      rowIds,
    });
  },
};
