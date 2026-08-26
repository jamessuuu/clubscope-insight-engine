import type { ReactNode } from 'react';
import { SectionLabel } from './SectionLabel';

/**
 * A headline figure that can prove itself.
 *
 * The value slot takes a node rather than a string on purpose: on every surface in this
 * application it is filled with an evidence chip, so the number a manager reads first is
 * also the number they can click into. A stat card that renders a bare string is a stat card
 * that has quietly opted out of the grounding contract.
 */
export function StatCard({
  label,
  value,
  sub,
  footnote,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  footnote?: string;
}) {
  return (
    <div className="card flex flex-col justify-between p-5">
      <SectionLabel as="h3">{label}</SectionLabel>
      <p className="tnum mt-4 text-[27px] font-semibold leading-none tracking-[-0.02em] text-ink">
        {value}
      </p>
      {sub ? <p className="mt-2 text-[13px] leading-snug text-muted">{sub}</p> : null}
      {footnote ? (
        <p className="mt-3 border-t border-rule pt-3 text-[11px] leading-snug text-faint">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}
