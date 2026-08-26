import { cx } from '@/lib/format';

export type Band = 'low' | 'watch' | 'elevated' | 'critical';

/**
 * Band colour is carried by a dot and by the text, never by a filled pill.
 *
 * A table of 400 rows with 400 coloured pills reads as an alarm panel, and once everything
 * is shouting nothing is. The dot gives the scan-level signal; the word carries the meaning
 * for anyone who cannot separate these hues.
 */
const BAND_STYLE: Record<Band, { dot: string; text: string; label: string }> = {
  low: { dot: 'bg-risk-low', text: 'text-risk-low', label: 'Low' },
  watch: { dot: 'bg-risk-watch', text: 'text-risk-watch', label: 'Watch' },
  elevated: { dot: 'bg-risk-elevated', text: 'text-risk-elevated', label: 'Elevated' },
  critical: { dot: 'bg-risk-critical', text: 'text-risk-critical', label: 'Critical' },
};

export function RiskBadge({
  band,
  score,
  size = 'sm',
}: {
  band: Band;
  score?: number;
  size?: 'sm' | 'lg';
}) {
  const style = BAND_STYLE[band];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span
        aria-hidden="true"
        className={cx('inline-block shrink-0 rounded-full', style.dot, size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2')}
      />
      <span
        className={cx(
          'font-semibold',
          style.text,
          size === 'lg' ? 'text-[13px] uppercase tracking-[0.1em]' : 'text-[12px]',
        )}
      >
        {style.label}
      </span>
      {score === undefined ? null : (
        <span className="tnum text-[12px] text-muted">{score}</span>
      )}
    </span>
  );
}
