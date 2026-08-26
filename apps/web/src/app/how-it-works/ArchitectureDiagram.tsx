const BOXES = [
  {
    y: 16,
    title: 'Question',
    lines: ['A manager asks something, or a detector fires on a schedule.'],
    accent: 'var(--color-rule-cool)',
  },
  {
    y: 106,
    title: 'Assistant — Claude, tool-calling',
    lines: [
      'MAY: choose tools, choose arguments, write prose, propose actions.',
      'MAY NOT: compute, aggregate, estimate, or round a figure itself.',
    ],
    accent: 'var(--color-champagne)',
  },
  {
    y: 210,
    title: 'Analysis tool registry — pure TypeScript',
    lines: [
      'Every tool returns an Evidence record: value, unit, method,',
      'params, rowIds, rowCount, toolVersion, computedAt.',
    ],
    accent: 'var(--color-series-1)',
  },
  {
    y: 314,
    title: 'Groundedness verifier — deterministic',
    lines: [
      'Re-executes each cited tool from its own params and compares.',
      'Mismatch or undeclared figure means the narrative is blocked.',
    ],
    accent: 'var(--color-negative)',
  },
  {
    y: 418,
    title: 'UI — every figure opens its receipt',
    lines: ['Rows, method, recomputation. Nothing renders that did not pass.'],
    accent: 'var(--color-risk-low)',
  },
] as const;

const EDGES = [
  { from: 0, to: 1, label: 'natural language' },
  { from: 1, to: 2, label: 'typed tool calls' },
  { from: 2, to: 3, label: 'claims cite evidenceId' },
  { from: 3, to: 4, label: 'verified claims + receipts' },
] as const;

const X = 40;
const W = 600;

/**
 * The grounding contract, drawn.
 *
 * An inline SVG rather than a screenshot or an image asset: it inherits the page's own colour
 * tokens, stays sharp at any zoom, and is searchable and selectable as text. The horizontal
 * scroll container around it is deliberate — shrinking a 680px diagram to a 390px phone
 * column would drop the labels to six pixels, and an illegible diagram is worse than none.
 */
export function ArchitectureDiagram() {
  const height = 500;

  return (
    <figure className="mt-6">
      <div className="overflow-x-auto rounded-club border border-rule bg-surface p-5">
        <svg
          viewBox={`0 0 680 ${height}`}
          className="block h-auto w-full min-w-[620px]"
          role="img"
          aria-labelledby="architecture-title architecture-desc"
        >
          <title id="architecture-title">The grounding contract</title>
          <desc id="architecture-desc">
            A question flows to the assistant, which may choose tools and write prose but may
            not compute figures. The assistant calls typed analysis tools which return evidence
            records. A deterministic verifier re-executes each cited tool and blocks the
            narrative on any mismatch. Only verified claims reach the interface, where each
            figure opens its receipt.
          </desc>

          {EDGES.map((edge) => {
            const from = BOXES[edge.from];
            const to = BOXES[edge.to];
            const y1 = from.y + 74;
            const y2 = to.y;
            const mid = (y1 + y2) / 2;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line
                  x1={X + 28}
                  y1={y1}
                  x2={X + 28}
                  y2={y2 - 7}
                  stroke="var(--color-rule-cool)"
                  strokeWidth="1.5"
                />
                <path
                  d={`M${X + 24} ${y2 - 8} L${X + 28} ${y2 - 1} L${X + 32} ${y2 - 8} Z`}
                  fill="var(--color-rule-cool)"
                />
                <text
                  x={X + 40}
                  y={mid + 3}
                  fontSize="10.5"
                  fill="var(--color-faint)"
                  fontFamily="var(--font-sans)"
                  letterSpacing="0.06em"
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {BOXES.map((box) => (
            <g key={box.title}>
              <rect
                x={X}
                y={box.y}
                width={W}
                height={74}
                rx="12"
                fill="var(--color-surface)"
                stroke="var(--color-rule)"
                strokeWidth="1"
              />
              <rect x={X} y={box.y} width="3" height="74" fill={box.accent} rx="1.5" />
              <text
                x={X + 20}
                y={box.y + 27}
                fontSize="13"
                fontWeight="600"
                fill="var(--color-ink)"
                fontFamily="var(--font-sans)"
              >
                {box.title}
              </text>
              {box.lines.map((line, i) => (
                <text
                  key={line}
                  x={X + 20}
                  y={box.y + 46 + i * 15}
                  fontSize="11"
                  fill="var(--color-muted)"
                  fontFamily="var(--font-sans)"
                >
                  {line}
                </text>
              ))}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-3 text-[12px] leading-relaxed text-muted">
        The split is the whole design. Language models are excellent at deciding what to look
        at and how to say it, and unreliable at arithmetic over many rows. Separating those two
        jobs is what makes the output both useful and auditable — and it is what makes the
        system testable, because the tools are pure functions with unit tests and the verifier
        is a hard gate that fails closed.
      </figcaption>
    </figure>
  );
}
