import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClubScope Insight Engine — concept prototype',
  description:
    'A grounded AI insight and assistant surface for private club operations. Independent concept prototype by James Lorenz Santos. Synthetic data; not affiliated with ClubScope.',
  robots: { index: false, follow: false },
};

const NAV = [
  { href: '/', label: 'Insights' },
  { href: '/members', label: 'Member 360' },
  { href: '/ask', label: 'Ask ClubScope' },
  { href: '/reliability', label: 'Reliability' },
  { href: '/how-it-works', label: 'How it works' },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter, self-hosted by ClubScope on their own site; loaded here from the same
            public CDN weights so type matches without hotlinking their assets. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-40 border-b border-white/25 bg-ink-deep">
          <div className="mx-auto flex h-16 max-w-[1288px] items-center justify-between px-6">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold tracking-[0.18em] text-white">
                CLUBSCOPE
              </span>
              <span className="text-[11px] font-medium tracking-[0.14em] text-champagne">
                INSIGHT ENGINE
              </span>
            </Link>

            <nav className="hidden items-center gap-8 md:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-[13px] font-medium text-white/75 transition-colors hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <span className="hidden rounded-full border border-champagne/45 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-champagne lg:inline">
              Concept prototype
            </span>
          </div>
        </header>

        {/*
          The demo runs without a model API key, and says so on every page rather than in a
          footnote. A prototype that lets a reviewer assume a capability it does not have is
          not a prototype, it is a trap — and the reviewer always finds out.
        */}
        <div className="border-b border-rule bg-parchment">
          <div className="mx-auto flex max-w-[1288px] flex-wrap items-center gap-x-2 gap-y-1 px-6 py-2 text-[12px] text-muted">
            <span className="font-semibold text-ink">Replay mode.</span>
            <span>
              No model API key is configured, so the assistant&rsquo;s wording is replayed from
              recorded transcripts.
            </span>
            <span className="font-semibold text-ink">
              Every figure on this site is computed and verified live from the dataset.
            </span>
            <Link href="/how-it-works" className="font-medium text-navy underline underline-offset-2">
              What that means
            </Link>
          </div>
        </div>

        <main id="main" className="mx-auto max-w-[1288px] px-6 py-8">
          {children}
        </main>

        <footer className="mt-16 border-t border-rule bg-white">
          <div className="mx-auto max-w-[1288px] px-6 py-8 text-[12px] leading-relaxed text-muted">
            <p className="max-w-3xl">
              <span className="font-semibold text-ink">Independent concept prototype.</span> Built
              by James Lorenz Santos as a discussion artifact for a conversation with ClubScope
              about the AI App Developer role. Not affiliated with, endorsed by, or connected to
              ClubScope. All club data shown is synthetic and generated from a fixed seed; no real
              club, member, or financial data is used anywhere in this application.
            </p>
            <p className="mt-3">
              Visual language follows ClubScope&rsquo;s public brand so the concept is legible in
              their context. Source:{' '}
              <a
                className="text-navy underline underline-offset-2"
                href="https://github.com/jamessuuu/clubscope-insight-engine"
              >
                github.com/jamessuuu/clubscope-insight-engine
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
