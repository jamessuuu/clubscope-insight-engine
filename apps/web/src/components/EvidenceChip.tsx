'use client';

import type { NarrativeSegment } from '@/lib/types';
import { cx } from '@/lib/format';
import { useReceipts } from './ReceiptProvider';

/**
 * A figure inside a sentence that can be opened.
 *
 * The chip is styled as underlined running text rather than as a button, because it appears
 * mid-sentence and a row of buttons inside a paragraph destroys the reading line. The
 * affordance people actually need is "this number is different from ordinary text and
 * something happens when you press it", and a champagne underline carries that without
 * turning the narrative into a toolbar.
 */
export function EvidenceChip({
  evidenceId,
  value,
  blocked = false,
}: {
  evidenceId: string;
  value: string;
  blocked?: boolean;
}) {
  const { open, has } = useReceipts();

  if (!has(evidenceId)) {
    // No receipt means nothing to show, and a chip that opens an empty drawer is worse than
    // plain text. Blocked figures still read as struck through so the failure stays visible.
    return (
      <span className={cx('chip', blocked && 'chip-blocked')} style={{ cursor: 'default' }}>
        {value}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => open(evidenceId)}
      aria-haspopup="dialog"
      className={cx('chip', blocked && 'chip-blocked')}
      title={blocked ? 'Blocked by the verifier — open the receipt' : 'Open the receipt'}
    >
      {value}
      <span className="sr-only">
        {blocked
          ? ' — blocked by the verifier. Open the evidence receipt.'
          : ' — open the evidence receipt'}
      </span>
    </button>
  );
}

/**
 * Renders a verified narrative: prose as prose, every cited figure as a chip.
 *
 * `blockedKeys` carries the verifier's verdict down from the page. A figure that failed
 * recomputation is still shown, struck through, rather than quietly removed: a system that
 * hides its own catches is asking to be trusted on exactly the point it should be audited.
 */
export function Narrative({
  segments,
  blockedKeys,
  className,
}: {
  segments: readonly NarrativeSegment[];
  blockedKeys?: ReadonlySet<string>;
  className?: string;
}) {
  return (
    <p className={cx('text-[14px] leading-[1.75] text-ink', className)}>
      {segments.map((segment, i) =>
        segment.kind === 'text' ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <EvidenceChip
            key={i}
            evidenceId={segment.evidenceId}
            value={segment.text}
            blocked={blockedKeys?.has(`${segment.evidenceId}|${segment.text}`) ?? false}
          />
        ),
      )}
    </p>
  );
}
