import type { Contribution } from '@clubscope/core/scoring';
import { cx } from '@/lib/format';

/**
 * One signed contribution to a churn score.
 *
 * A churn score that arrives as a single number is a number you can only accept or reject.
 * Rendering every signed term against a shared centre line makes the arithmetic legible at a
 * glance: which signals pushed this member up, which held them down, and by how much
 * relative to each other. That is what makes the score arguable — and a retention score that
 * cannot be argued with will not survive its first disagreement with a membership director.
 */
export function ContributionBar({
  contribution,
  maxAbs,
}: {
  contribution: Contribution;
  maxAbs: number;
}) {
  const { signal, points, detail } = contribution;
  const protective = points < 0;
  const magnitude = Math.min(1, Math.abs(points) / (maxAbs || 1));
  const half = magnitude * 50;
  const color = protective ? 'var(--color-risk-low)' : 'var(--color-risk-elevated)';

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[13px] font-medium text-ink">{signal}</span>
        <span
          className={cx(
            'tnum shrink-0 text-[13px] font-semibold',
            protective ? 'text-risk-low' : 'text-risk-elevated',
          )}
        >
          {points > 0 ? '+' : ''}
          {points}
        </span>
      </div>

      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className="mt-2 h-1.5 w-full"
        aria-hidden="true"
      >
        <rect x="0" y="2.25" width="100" height="1.5" fill="var(--color-surface-sunk)" />
        <rect
          x={protective ? 50 - half : 50}
          y="0"
          width={Math.max(half, 0.6)}
          height="6"
          fill={color}
        />
        {/* Zero line drawn as a rect, not a stroke: strokes distort under non-uniform scale. */}
        <rect x="49.8" y="0" width="0.4" height="6" fill="var(--color-rule)" />
      </svg>

      <p className="mt-2 text-[12px] leading-relaxed text-muted">{detail}</p>
    </li>
  );
}
