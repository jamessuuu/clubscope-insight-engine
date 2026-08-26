'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DataTable, type Column, type SortDirection } from '@/components/DataTable';
import { RiskBadge } from '@/components/RiskBadge';
import { SectionLabel } from '@/components/SectionLabel';
import type { RosterRow } from '@/lib/roster';
import { cx, humanise, num, shortDate, usd } from '@/lib/format';

const STATUSES = ['active', 'resigned', 'suspended'] as const;
const CATEGORIES = [
  'full-golf',
  'social',
  'junior-executive',
  'corporate',
  'non-resident',
] as const;
const BANDS = ['critical', 'elevated', 'watch', 'low'] as const;

type Filter<T extends string> = T | 'all';

const SORTERS: Record<string, (a: RosterRow, b: RosterRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  category: (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  tenure: (a, b) => a.tenure - b.tenure,
  // Never-seen members sort as the quietest, which is what a retention lead is looking for.
  lastVisit: (a, b) => (a.quietDays < 0 ? 1e9 : a.quietDays) - (b.quietDays < 0 ? 1e9 : b.quietDays),
  spend90: (a, b) => a.spend90 - b.spend90,
  score: (a, b) => a.score - b.score,
};

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Filter<T>;
  options: readonly T[];
  onChange: (next: Filter<T>) => void;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as Filter<T>)}
        className="h-9 rounded-md border border-rule bg-surface px-2.5 text-[13px] text-ink"
      >
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {humanise(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The roster.
 *
 * Filtering and sorting run in the browser over data the server already computed. At 420
 * members that is instantly responsive and costs one payload; the alternative — a round trip
 * per keystroke — would be slower and would buy nothing until the roll is an order of
 * magnitude larger, at which point the fix is server-side pagination rather than a spinner.
 */
export function MembersTable({ rows }: { rows: readonly RosterRow[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter<(typeof STATUSES)[number]>>('active');
  const [category, setCategory] = useState<Filter<(typeof CATEGORIES)[number]>>('all');
  const [band, setBand] = useState<Filter<(typeof BANDS)[number]>>('all');
  const [sortKey, setSortKey] = useState('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (category !== 'all' && row.category !== category) return false;
      if (band !== 'all' && row.band !== band) return false;
      if (needle === '') return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.memberNo.includes(needle) ||
        row.id.includes(needle)
      );
    });

    const sorter = SORTERS[sortKey] ?? SORTERS.score;
    const sorted = [...matched].sort(sorter);
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [rows, query, status, category, band, sortKey, sortDirection]);

  const onSort = (key: string) => {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'name' || key === 'category' ? 'asc' : 'desc');
    }
  };

  const columns: ReadonlyArray<Column<RosterRow>> = [
    {
      key: 'name',
      header: 'Member',
      sortable: true,
      render: (row) => (
        <Link
          href={`/members/${row.id}`}
          className="group inline-flex flex-col gap-0.5 rounded-sm"
        >
          <span className="font-medium text-ink underline-offset-2 group-hover:underline">
            {row.name}
          </span>
          <span className="tnum text-[11px] text-faint">
            #{row.memberNo}
            {row.status === 'active' ? '' : ` · ${humanise(row.status)}`}
          </span>
        </Link>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      render: (row) => <span className="text-muted">{humanise(row.category)}</span>,
    },
    {
      key: 'tenure',
      header: 'Tenure',
      align: 'right',
      sortable: true,
      render: (row) => <span className="tnum text-muted">{num(row.tenure, 1)} yr</span>,
    },
    {
      key: 'lastVisit',
      header: 'Last visit',
      align: 'right',
      sortable: true,
      render: (row) =>
        row.lastVisit === null ? (
          <span className="text-faint">never</span>
        ) : (
          <span className="tnum flex flex-col items-end">
            <span className="text-ink">{shortDate(row.lastVisit)}</span>
            <span
              className={cx(
                'text-[11px]',
                row.quietDays >= 90 ? 'text-risk-elevated' : 'text-faint',
              )}
            >
              {row.quietDays}d ago
            </span>
          </span>
        ),
    },
    {
      key: 'spend90',
      header: 'Spend (90d)',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cx('tnum', row.spend90 === 0 ? 'text-faint' : 'text-ink')}>
          {usd(row.spend90)}
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Churn risk',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="inline-flex justify-end">
          <RiskBadge band={row.band} score={row.score} />
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4 border-b border-rule pb-5">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label
            htmlFor="roster-search"
            className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted"
          >
            Search
          </label>
          <input
            id="roster-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, member number or id"
            className="h-9 rounded-md border border-rule bg-surface px-3 text-[13px] text-ink placeholder:text-faint"
          />
        </div>

        <Select label="Status" value={status} options={STATUSES} onChange={setStatus} />
        <Select label="Category" value={category} options={CATEGORIES} onChange={setCategory} />
        <Select label="Risk band" value={band} options={BANDS} onChange={setBand} />
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3">
        <SectionLabel>
          {num(filtered.length)} of {num(rows.length)} members
        </SectionLabel>
        <p className="text-[11px] text-faint">
          Spend excludes dues: dues keep posting until the resignation letter arrives
        </p>
      </div>

      <div className="mt-4">
        <DataTable
          caption="Club roster with churn risk"
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={onSort}
          emptyTitle="No members match these filters"
          emptyDescription="Widen the status, category or risk-band filter, or clear the search box."
        />
      </div>
    </div>
  );
}
