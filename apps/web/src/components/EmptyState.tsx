import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-club border border-dashed border-rule bg-surface-sunk px-6 py-14 text-center">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
