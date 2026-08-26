import { cx } from '@/lib/format';

/**
 * A horizontal bar chart: SVG marks, HTML type.
 *
 * Putting the labels in real text nodes rather than inside the SVG keeps them at a readable
 * size at 390px — an all-SVG chart scaled uniformly to a phone column drops its captions to
 * about 8px, which is a legibility failure dressed up as a chart. The marks themselves are
 * hand-rolled rects; there is no chart library anywhere in this application.
 */
/**
 * The chart series, written out one literal at a time.
 *
 * This looks like something a loop should generate, and it was, until every bar after the
 * first rendered black. Tailwind v4 scans source files as text and keeps only the `@theme`
 * variables whose names it actually finds there, so `var(--color-series-${i})` emits nothing
 * for series 2 through 5 and the browser falls back to the initial `fill` value. Spelling the
 * names out is what puts them in the stylesheet.
 */
const SERIES = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
] as const;

export interface BarDatum {
  label: string;
  value: number;
  /** Optional pre-formatted display value; falls back to the raw number. */
  display?: string;
  color?: string;
}

export function BarChart({
  data,
  ariaLabel,
  className,
}: {
  data: readonly BarDatum[];
  ariaLabel: string;
  className?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;

  return (
    <div className={cx('flex flex-col gap-3', className)} role="img" aria-label={ariaLabel}>
      {data.map((d, i) => {
        const pctWidth = Math.max(0, (d.value / max) * 100);
        const color = d.color ?? SERIES[i % SERIES.length];
        return (
          <div key={d.label} className="grid grid-cols-[minmax(84px,1fr)_2fr_auto] items-center gap-3">
            <span className="truncate text-[12px] text-ink" title={d.label}>
              {d.label}
            </span>
            <svg
              viewBox="0 0 100 8"
              preserveAspectRatio="none"
              className="h-2 w-full overflow-visible"
              aria-hidden="true"
            >
              <rect x="0" y="0" width="100" height="8" fill="var(--color-surface-sunk)" rx="0" />
              <rect x="0" y="0" width={pctWidth} height="8" fill={color} />
            </svg>
            <span className="tnum w-[86px] text-right text-[12px] font-medium text-ink">
              {d.display ?? d.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
