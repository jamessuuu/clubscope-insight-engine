import type { VerificationReport } from '@clubscope/core/verify';
import { cx } from '@/lib/format';

function CheckGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
      <path
        d="M2.5 6.4 4.8 8.7 9.5 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BlockGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
      <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.2 8.8 8.8 3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The verdict of the groundedness gate, stated in the same place every time.
 *
 * It reports the count of figures actually recomputed rather than a bare "verified", because
 * "verified" with nothing behind it is the exact claim this project exists to distrust.
 */
export function VerificationBadge({
  report,
  detail = true,
}: {
  report: VerificationReport;
  detail?: boolean;
}) {
  const verified = report.status === 'verified';
  const figures = report.recomputedCount;

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.09em]',
        verified
          ? 'border-risk-low/35 bg-risk-low/8 text-risk-low'
          : 'border-negative/40 bg-negative/8 text-negative',
      )}
    >
      {verified ? <CheckGlyph /> : <BlockGlyph />}
      {verified ? 'Verified' : 'Blocked'}
      {detail ? (
        <span className="tnum font-medium normal-case tracking-normal opacity-80">
          {verified
            ? `${figures} figure${figures === 1 ? '' : 's'} recomputed`
            : `${report.citedCount - report.matchedCount + report.undeclaredCount} failed of ${report.citedCount + report.undeclaredCount}`}
        </span>
      ) : null}
    </span>
  );
}
