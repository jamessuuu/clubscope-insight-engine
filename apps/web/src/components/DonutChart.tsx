import { cx, num } from '@/lib/format';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/**
 * A donut drawn with stroke-dasharray on concentric arcs.
 *
 * Chosen over `<path>` arc maths because a dashed circle cannot produce a malformed wedge at
 * 0% or 100% — the two cases that make hand-rolled pie charts render as a stray hairline or
 * a full disc with a seam. One shape, one code path, no special cases.
 */
export function DonutChart({
  slices,
  ariaLabel,
  centreValue,
  centreLabel,
  className,
}: {
  slices: readonly DonutSlice[];
  ariaLabel: string;
  centreValue?: string;
  centreLabel?: string;
  className?: string;
}) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;

  let offset = 0;
  const arcs = slices.map((s) => {
    const share = total === 0 ? 0 : s.value / total;
    const arc = { ...s, share, dash: share * C, offset };
    offset += share * C;
    return arc;
  });

  return (
    <div className={cx('flex flex-wrap items-center gap-6', className)}>
      <div className="relative shrink-0">
        <svg viewBox="0 0 110 110" className="h-[122px] w-[122px]" role="img" aria-label={ariaLabel}>
          <circle cx="55" cy="55" r={R} fill="none" stroke="var(--color-surface-sunk)" strokeWidth="13" />
          {arcs.map((a) =>
            a.share === 0 ? null : (
              <circle
                key={a.label}
                cx="55"
                cy="55"
                r={R}
                fill="none"
                stroke={a.color}
                strokeWidth="13"
                strokeDasharray={`${a.dash.toFixed(3)} ${(C - a.dash).toFixed(3)}`}
                strokeDashoffset={(-a.offset).toFixed(3)}
                transform="rotate(-90 55 55)"
              />
            ),
          )}
        </svg>
        {centreValue ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="tnum text-[19px] font-semibold leading-none text-ink">{centreValue}</span>
            {centreLabel ? (
              <span className="mt-1 text-[10px] uppercase tracking-[0.1em] text-muted">{centreLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="min-w-[168px] flex-1 space-y-2">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="flex items-center gap-2 text-ink">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
            <span className="tnum text-muted">
              {num(s.value)}
              <span className="ml-2 text-faint">
                {total === 0 ? '0%' : `${num((s.value / total) * 100, 0)}%`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
