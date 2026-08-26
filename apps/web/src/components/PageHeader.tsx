import type { ReactNode } from 'react';
import { SectionLabel } from './SectionLabel';

/**
 * One header shape for every page: eyebrow, title, one paragraph of orientation.
 *
 * Repeating it as a component rather than by hand is what keeps five pages feeling like one
 * product. The paragraph is capped at ~68 characters per line because this is a reading
 * width, not a dashboard caption.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-rule pb-7">
      <div className="min-w-0 max-w-2xl">
        <SectionLabel as="p">{eyebrow}</SectionLabel>
        <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.022em] text-ink">
          {title}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">{lede}</p>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  );
}
