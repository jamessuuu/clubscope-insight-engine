import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

/**
 * The small uppercase label that opens a section.
 *
 * It exists as a component rather than a utility class because it is doing semantic work as
 * well as visual: on most surfaces it is the accessible name for the region beneath it, so
 * the element it renders needs to be chosen per use rather than hard-coded to a div.
 */
export function SectionLabel({
  children,
  as: Tag = 'h2',
  className,
  id,
}: {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'p' | 'span' | 'div' | 'legend';
  className?: string;
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cx(
        'text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-muted',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
