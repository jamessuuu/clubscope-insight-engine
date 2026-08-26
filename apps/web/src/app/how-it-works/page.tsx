import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CHURN_MODEL_VERSION } from '@clubscope/core/scoring';
import { PageHeader } from '@/components/PageHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { club } from '@/lib/club';
import { num, shortDate } from '@/lib/format';
import { ArchitectureDiagram } from './ArchitectureDiagram';

export const metadata: Metadata = {
  title: 'How it works — ClubScope Insight Engine',
};

function Section({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-rule pt-10">
      <SectionLabel as="p">{label}</SectionLabel>
      <h2 id={`${id}-title`} className="mt-3 text-[20px] font-semibold tracking-[-0.018em] text-ink">
        {title}
      </h2>
      <div className="mt-4 max-w-3xl space-y-4 text-[14px] leading-[1.75] text-ink">{children}</div>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-rule bg-surface-sunk px-1.5 py-0.5 font-mono text-[12.5px] text-ink">
      {children}
    </code>
  );
}

const CONTENTS = [
  { href: '#contract', label: 'The grounding contract' },
  { href: '#citations', label: 'Citation format' },
  { href: '#verifier', label: 'Recompute and fail closed' },
  { href: '#rounding', label: 'Rounding-aware comparison' },
  { href: '#churn', label: 'Churn scoring is arithmetic' },
  { href: '#replay', label: 'What replay mode is' },
  { href: '#data', label: 'The data is synthetic' },
  { href: '#limits', label: 'Limitations' },
] as const;

export default function HowItWorksPage() {
  const ds = club();

  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title="The parts that would embarrass me if you found them yourself"
        lede={
          <>
            Written for someone who will open the source. Everything below is a design decision
            with a stated reason, including the places this prototype is deliberately less than
            a product.
          </>
        }
      />

      <nav aria-label="On this page" className="mt-8">
        <SectionLabel as="p">Contents</SectionLabel>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {CONTENTS.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="border-b border-champagne/60 pb-0.5 text-[13px] text-ink transition-colors hover:border-champagne hover:text-champagne-press"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-12 space-y-12">
        <Section id="contract" label="01" title="The grounding contract">
          <p>
            The language model never produces a number. It selects typed analysis tools, and
            every figure it reports is recomputed by a deterministic verifier before it reaches
            the screen. That single constraint is the difference between a demo and something a
            club general manager can act on.
          </p>
          <p>
            An analysis tool is a pure function of{' '}
            <Code>(params, dataset) → Evidence</Code>. Purity is the point: it makes each tool
            unit-testable in isolation, makes the verifier&rsquo;s recomputation meaningful, and
            guarantees that the same question asked a month apart returns the same figure. No
            tool may call a model. The registry is also the assistant&rsquo;s entire capability
            surface — a question that cannot be expressed as a call into it is a question the
            assistant declines rather than improvises.
          </p>
          <ArchitectureDiagram />
        </Section>

        <Section id="citations" label="02" title="Citation format">
          <p>
            Every figure in a narrative must be written as{' '}
            <Code>{'[[e:<evidenceId>|<figure>]]'}</Code>, where the evidence id is the sixteen
            hex characters the tool returned. The renderer turns those markers into the chips
            you can click; the verifier turns them into recomputation jobs.
          </p>
          <p>
            The evidence id is itself deterministic: a SHA-256 of the tool name, its version and
            its canonicalised parameters. Two identical calls produce the same id, which is what
            lets a receipt be re-derived rather than merely retrieved.
          </p>
          <p>
            Any figure left bare in the prose is reported as{' '}
            <Code>undeclared</Code> and the whole narrative fails. The exemption list is
            enumerated rather than heuristic — bare four-digit years and small ordinals such as
            &ldquo;the top 3&rdquo; — because a permissive allowlist here would quietly defeat
            the entire verifier.
          </p>
        </Section>

        <Section id="verifier" label="03" title="The verifier recomputes, and fails closed">
          <p>
            For each citation the verifier looks up the evidence record, re-executes the named
            tool from the parameters stored on that record, and compares the fresh result to
            what the narrative claims. Recomputation rather than trusting the evidence payload
            carried through the request is what closes the loop: a tampered or stale evidence
            object cannot pass.
          </p>
          <p>
            Failure modes are named individually, not collapsed into one red flag:{' '}
            <Code>mismatch</Code>, <Code>unknown-evidence</Code>, <Code>recompute-failed</Code>,{' '}
            <Code>unsupported-shape</Code>, <Code>undeclared</Code>. Tool version drift is
            treated as a failure rather than compared across versions, because a figure computed
            by v1.0 and checked against v1.1 proves nothing either way.
          </p>
          <p>
            <span className="font-semibold">What the verifier does not claim.</span> It does not
            prove the tool logic is correct — that is what the tools&rsquo; own unit tests are
            for. It does not prove the model chose the right tool for the question — that is
            what the eval suite measures. Three different guarantees, three different mechanisms.
            Any system claiming one gate covers all three is overselling.{' '}
            <Link href="/reliability" className="text-navy underline underline-offset-2">
              Watch it block a fabricated figure
            </Link>
            .
          </p>
        </Section>

        <Section id="rounding" label="04" title="Rounding-aware comparison, and why it exists">
          <p>
            A naive verifier fails the moment a model writes &ldquo;$1.2M&rdquo; for 1,241,880 —
            technically a mismatch, journalistically correct. Rejecting that trains the model
            toward unreadable prose full of unrounded cents. Accepting any nearby number lets
            real fabrication through.
          </p>
          <p>
            The resolution is to infer the <em>precision the writer claimed</em> from how the
            number is written, then accept the figure only if the true value lies inside the
            interval that rounds to it. &ldquo;$1.2M&rdquo; asserts a value in [1.15M, 1.25M).
            &ldquo;1,241,880&rdquo; asserts a value in [1,241,879.5, 1,241,880.5). Both are
            honest at their stated precision, and both are checkable.
          </p>
          <p>
            The useful consequence: counts written at full precision demand an exact match.
            &ldquo;47 members&rdquo; must mean 47.
          </p>
        </Section>

        <Section id="churn" label="05" title="Churn scoring is arithmetic, not a model">
          <p>
            A churn score decides where a club spends retention effort and eventually who gets a
            phone call from the general manager. It has to be reproducible on Tuesday and
            Thursday, defensible to a board committee, and decomposable when a member disputes
            it. Language models are none of those things.
          </p>
          <p>
            So the score is a versioned, unit-tested weighted sum — currently{' '}
            <Code>v{CHURN_MODEL_VERSION}</Code> — where each signal contributes signed points
            carrying the plain-English reason that produced it. Baselines are per member rather
            than club-wide: a social member visiting twice a month has not disengaged, and
            comparing them to a full-golf cadence would generate noise that erodes trust in the
            whole feed.
          </p>
          <p>
            Every tool that touches risk is evaluated as at <Code>{ds.club.dataTo}</Code>, the
            last date the data covers, rather than against the wall clock. Two reasons, and both
            matter: the verifier re-runs a tool minutes or days later, so a wall-clock window
            would drift and flag a true figure as fabricated; and asking &ldquo;who is at risk
            today&rdquo; of a closed historical record is a question with no honest answer.
          </p>
          <p>
            The general lesson, and the most useful thing I have learned shipping AI features:
            decide what genuinely needs a model, and refuse to use one everywhere else. It is
            cheaper, faster, and it is the part that keeps working when the provider has an
            incident.
          </p>
        </Section>

        <Section id="replay" label="06" title="What replay mode is, and what it is not">
          <p>
            No <Code>ANTHROPIC_API_KEY</Code> is configured in this deployment, so the assistant
            runs in replay mode.
          </p>
          <p>
            <span className="font-semibold">Real on every request:</span> the tool calls execute
            against the dataset, the evidence records — values, methods, row ids — are computed
            fresh, the figures rendered into the prose are the values those tools actually
            returned, and the groundedness verifier runs its full recomputation pass over the
            result. If a tool&rsquo;s logic changed and a figure moved, the scripted narrative
            would be blocked exactly as a model&rsquo;s would.
          </p>
          <p>
            <span className="font-semibold">Not real:</span> the wording. Which tools to call and
            how to phrase the answer are fixed in advance rather than chosen by a model. With a
            key set, the identical pipeline runs with Claude choosing the tools and writing the
            prose, and it must satisfy the same citation contract to render at all.
          </p>
          <p>
            That boundary is stated on the assistant page itself rather than buried here,
            because a reviewer who discovers an undisclosed limitation stops believing the
            disclosed parts too. The same recording machinery is also what gives the eval suite
            byte-identical determinism, so it earns its place beyond the demo.
          </p>
        </Section>

        <Section id="data" label="07" title="Every row of this data is synthetic">
          <p>
            {ds.club.name} does not exist. The dataset is generated from a fixed seed and covers{' '}
            {shortDate(ds.club.dataFrom)} to {shortDate(ds.club.dataTo)}:{' '}
            {num(ds.members.length)} members, {num(ds.transactions.length)} transactions,{' '}
            {num(ds.visits.length)} facility visits, {num(ds.events.length)} events,{' '}
            {num(ds.registrations.length)} registrations and {num(ds.notes.length)} free-text
            staff notes.
          </p>
          <p>
            It is behaviourally realistic on purpose — genuine seasonality, real churn patterns,
            and a small number of planted anomalies so the insight engine has something true to
            find. Because the seed is pinned, every run of the demo, every recorded transcript
            and every eval baseline see byte-identical rows.
          </p>
          <p>
            No real club, member or financial data is used anywhere in this application, and
            nothing here is confidential to anyone.
          </p>
        </Section>

        <Section id="limits" label="08" title="Limitations, stated rather than discovered">
          <ul className="space-y-4">
            <li>
              <span className="font-semibold">The assistant&rsquo;s wording is scripted.</span>{' '}
              With no model API key configured, tool selection and phrasing come from recorded
              transcripts. The suggested-question chips are the honest surface for that: a free
              text box that silently understood only five sentences would be the most dishonest
              thing this prototype could ship.
            </li>
            <li>
              <span className="font-semibold">Action state is client-side only.</span>{' '}
              Confirmations and rejections live in React state in your browser tab and vanish
              when you close it. Nothing is written to a server, no message is sent, and no
              member record is touched. The audit entries themselves are built by the same
              action definitions a real deployment would run — only the persistence is thrown
              away.
            </li>
            <li>
              <span className="font-semibold">Single tenant, no authentication.</span> One club,
              no accounts, no roles, no row-level access control. A real deployment needs all of
              it; none of it would demonstrate anything about grounding, so none of it is here.
            </li>
            <li>
              <span className="font-semibold">The eval suite is a golden set, not a corpus.</span>{' '}
              It covers the failure modes worth proving — fabrication, out-of-coverage refusal,
              rounding — at the scale a prototype justifies. Real coverage is measured in
              hundreds of cases with per-case cost and latency budgets.
            </li>
            <li>
              <span className="font-semibold">Forecasting is out of scope in this build.</span>{' '}
              The seasonal projection described in the original spec is not implemented here.
              It is listed because an unimplemented feature quietly dropped from a spec is the
              same class of problem as an unverified figure.
            </li>
          </ul>
        </Section>
      </div>
    </>
  );
}
