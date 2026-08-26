import { cx } from '@/lib/format';

/**
 * A 24-month cadence line, hand-rolled.
 *
 * Uniform scaling (no `preserveAspectRatio="none"`) so the stroke keeps its weight at every
 * container width — a sparkline whose line thickens as the column widens reads as a
 * rendering bug, and this is a surface where anything that looks like a bug costs trust.
 */
export interface SparklinePoint {
  label: string;
  value: number;
}

const W = 480;
const H = 96;
const PAD = 6;

export function Sparkline({
  points,
  ariaLabel,
  color = 'var(--color-series-1)',
  showArea = true,
  markLast = true,
  className,
}: {
  points: readonly SparklinePoint[];
  ariaLabel: string;
  color?: string;
  showArea?: boolean;
  markLast?: boolean;
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <p className="text-[12px] text-faint">Not enough history to draw a trend.</p>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(2)},${H - PAD} L${x(0).toFixed(2)},${H - PAD} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cx('w-full', className)}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Baseline, so a flat line still reads as "flat at zero" rather than "no data". */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-rule)" strokeWidth="1" />
      {showArea ? <path d={area} fill={color} opacity="0.08" /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {markLast ? <circle cx={x(points.length - 1)} cy={y(last.value)} r="3.5" fill={color} /> : null}
    </svg>
  );
}
