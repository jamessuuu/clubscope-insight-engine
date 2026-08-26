import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export default function NotFound() {
  return (
    <>
      <PageHeader
        eyebrow="404"
        title="Nothing here"
        lede="That address does not match a page or a member on the roll."
      />
      <div className="mt-8">
        <EmptyState
          title="No such record"
          description="Member ids look like m-0042. If you followed a link from inside the app, the roster is the reliable way back."
          action={
            <Link
              href="/members"
              className="rounded-md border border-champagne bg-champagne px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-champagne-hover"
            >
              Open the roster
            </Link>
          }
        />
      </div>
    </>
  );
}
