import type { ReactNode } from 'react';
import { cx } from '@/lib/format';
import { EmptyState } from './EmptyState';

/**
 * The sort affordance: two stacked carets, the active one filled.
 *
 * Drawn rather than typed. The obvious shortcut is a triangle glyph, but glyph coverage and
 * baseline alignment vary by font and platform, and a control that jumps a pixel between
 * machines is the kind of small wrongness that makes a careful reader distrust the careful
 * parts too.
 */
function SortCarets({ direction }: { direction?: SortDirection }) {
  const up = direction === 'asc';
  const down = direction === 'desc';
  return (
    <svg viewBox="0 0 8 12" className="h-3 w-2" aria-hidden="true">
      <path d="M4 1.5 7 5H1z" fill={up ? 'var(--color-champagne-press)' : 'var(--color-rule-cool)'} />
      <path
        d="M4 10.5 1 7h6z"
        fill={down ? 'var(--color-champagne-press)' : 'var(--color-rule-cool)'}
      />
    </svg>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  /** Width utility applied to the column's header cell. */
  width?: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

export type SortDirection = 'asc' | 'desc';

/**
 * The table shell every dense surface shares.
 *
 * Two decisions worth naming. Row height is generous (48px) even though it means fewer rows
 * per screen: this is a table a manager reads a few rows of and then acts on, not a
 * spreadsheet they scan a thousand rows of, and cramming it would buy density nobody
 * benefits from. And zebra striping is a 2%-tint on `surface-sunk` rather than a border per
 * row — at this row count, a full grid of rules turns into visual noise that fights the
 * numbers for attention.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  sortKey,
  sortDirection,
  onSort,
  emptyTitle = 'Nothing matches these filters',
  emptyDescription,
}: {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  caption: string;
  sortKey?: string;
  sortDirection?: SortDirection;
  onSort?: (key: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto rounded-club border border-rule bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-rule">
            {columns.map((col) => {
              const active = sortKey === col.key;
              const ariaSort = !col.sortable
                ? undefined
                : active
                  ? sortDirection === 'asc'
                    ? ('ascending' as const)
                    : ('descending' as const)
                  : ('none' as const);
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cx(
                    'bg-surface-sunk px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.11em] text-muted',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.width,
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className={cx(
                        'inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-ink',
                        active && 'text-ink',
                      )}
                    >
                      {col.header}
                      <SortCarets direction={active ? sortDirection : undefined} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row)}
              className={cx(
                'border-b border-rule/60 last:border-b-0 transition-colors hover:bg-parchment/60',
                i % 2 === 1 && 'bg-surface-sunk/45',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cx(
                    'px-4 py-3.5 align-middle',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
