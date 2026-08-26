import type { Evidence, Unit } from '../tools/evidence.js';
import { toSegments, verifyNarrative } from '../verify/verifier.js';
import { proposeAction, type ProposedAction } from './actions.js';
import type { Message } from './provider.js';
import type { AssistantTurn, ToolCallRecord } from './runtime.js';
import type {
  FigureFormat,
  RunScriptedTurn,
  ScriptedRunInput,
  ScriptedToolCall,
  ScriptedTurn,
} from './scripted.js';

/**
 * Executes a scripted turn.
 *
 * ## What this file is defending
 *
 * `scripted.ts` makes a promise that the Ask page repeats to the user: with no API key
 * configured the *wording* is fixed, but everything else is real — the tools run, the
 * evidence is computed fresh, the figures in the prose are the values those tools returned,
 * and the verifier gates the result exactly as it gates a model's. This module is the code
 * that has to make that sentence true, so it is written to make the dishonest shortcut
 * impossible rather than merely unlikely:
 *
 *  - A turn never carries a number. It carries a `{{key}}` placeholder, and the only value
 *    that can land there is one a tool computed on this request.
 *  - The rendered figure and the cited evidence id come from the same Evidence record, so
 *    "the figure matches its receipt" is structural, not a convention an author must honour.
 *  - Nothing is fabricated to fill out the response shape: replay costs no tokens, so usage
 *    is zeroed rather than dressed with plausible counts, and `servedBy` says `replay`.
 *
 * ## Why a failing tool throws here and is caught in the live loop
 *
 * `runtime.ts` hands a tool error back to the model as text, because a model can read the
 * error and fix its own arguments. A scripted turn has nobody to correct it: its arguments
 * were written by hand and are part of the artifact. A tool that throws therefore means the
 * fixture and the registry have drifted apart, and the only honest outcome is a loud failure
 * in the test suite rather than a quietly thinner answer in a live demo.
 */

// ─── Figure formatting ──────────────────────────────────────────────────────────────

/**
 * Renders one figure for the narrative.
 *
 * ## This is a verifier client, not a display helper
 *
 * Everything emitted here is fed straight back through `parseFigure` and `roundsTo` by the
 * groundedness gate. So the rule is absolute: **never render a string that asserts something
 * the true value does not support.** Two consequences shaped the code below.
 *
 * **Compact forms are allowed, and they are the interesting case.** `parseFigure` infers the
 * precision the writer claimed from how the number is written, so "$381k" asserts a value in
 * [380.5k, 381.5k) and passes against 381,204. Rounding to a magnitude is honest prose at a
 * stated precision, not an approximation the gate has to forgive — which is why compact
 * rendering is built in rather than avoided.
 *
 * **A sign is never dropped, and a leading "+" is never written.** Rendering a decline as a
 * bare magnitude ("22%" for -21.6) would be a fabrication, and the verifier would block it,
 * correctly. The mirror-image temptation — writing "+8%" so a rise reads as a rise — fails
 * for a duller reason: the verifier's figure parser accepts a leading minus and nothing
 * else, so "+8%" is unparseable and fails closed as an unsupported shape. The fix belongs
 * here in the writer rather than in the gate: prose supplies the direction word, the figure
 * supplies the number.
 */
export function formatFigure(value: number, unit: Unit, format: FigureFormat): string {
  switch (format) {
    case 'usd':
      return money(Math.round(value));
    case 'usdCompact':
      return compactMoney(value);
    case 'percent':
      // Rates, in whole percentage points. A tenth of a point of attendance rate is noise a
      // GM will never act on, and claiming it invites a precision argument over a decision.
      return `${signedRound(value, 0)}%`;
    case 'percentSigned':
      // Period-over-period change, to one decimal: the difference between a five-point
      // wobble and a twenty-five-point collapse is the entire content of the figure, and
      // the direction has to survive into the prose intact.
      return `${signedRound(value, 1)}%`;
    case 'count':
      return groupThousands(String(Math.abs(Math.round(value))), Math.round(value) < 0);
    case 'score':
      // Scores run 0-100 and are never grouped: "73" is a score, "1,073" would be a bug.
      return signedRound(value, 0);
    case 'raw':
      return rawWithUnit(value, unit);
    default:
      // Adding a FigureFormat without teaching this switch about it is a compile error, not
      // a runtime surprise inside a rendered narrative.
      return assertNever(format);
  }
}

/** The format a call gets when neither the turn nor the placeholder names one. */
export function defaultFormatFor(unit: Unit): FigureFormat {
  switch (unit) {
    case 'usd':
      return 'usd';
    case 'percent':
      return 'percent';
    case 'count':
      return 'count';
    case 'score':
      return 'score';
    default:
      // days, minutes, ratio, none: no house style exists, so report the number exactly as
      // computed rather than inventing a rounding convention the reader cannot check.
      return 'raw';
  }
}

function assertNever(x: never): never {
  throw new Error(`unhandled figure format: ${JSON.stringify(x)}`);
}

/**
 * Thousands separators, hand-rolled.
 *
 * `toLocaleString` would be shorter and is a portability trap: its grouping depends on the
 * runtime's ICU build and the ambient locale, so the same turn could render "$381,204" in CI
 * and "$381 204" in a browser with a different default. The verifier strips commas and would
 * forgive both; the determinism test would not, and neither would a reviewer comparing the
 * page against a screenshot.
 */
function groupThousands(digits: string, negative = false): string {
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

/** Rounds to `decimals` places, normalising -0 so a rounded-away decline never reads "-0%". */
function signedRound(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return decimals === 0 ? String(safe) : safe.toFixed(decimals);
}

function money(whole: number): string {
  return `${whole < 0 ? '-' : ''}$${groupThousands(String(Math.abs(whole)))}`;
}

/**
 * `$381k`, `$1.2M`, `$847`.
 *
 * Magnitudes carry one decimal and thousands carry none, which is what makes each form
 * survive recomputation: rounding to the nearest 0.1M is an error of at most 0.05M, exactly
 * the half-step `roundsTo` allows a figure written to one decimal at that magnitude. Below a
 * thousand there is nothing to compact, so it falls through to the exact form rather than
 * inventing "$0.8k".
 */
function compactMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) {
    const thousands = Math.round(abs / 1e3);
    // 999,600 rounds to 1000k, which nobody writes. Promote it rather than print it.
    if (thousands >= 1000) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    return `${sign}$${groupThousands(String(thousands))}k`;
  }
  return money(Math.round(value));
}

/** No rounding and no grouping — the number as the tool computed it, wearing its unit. */
function rawWithUnit(value: number, unit: Unit): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (unit === 'usd') return `${sign}$${abs}`;
  if (unit === 'percent') return `${sign}${abs}%`;
  return String(value);
}

// ─── Template expansion ─────────────────────────────────────────────────────────────

/** `{{dining}}` or `{{dining|usdCompact}}`. Everything else in the template is prose. */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_-]+)\s*(?:\|\s*([A-Za-z]+)\s*)?\}\}/g;

const FIGURE_FORMATS: readonly FigureFormat[] = [
  'usd',
  'usdCompact',
  'percent',
  'percentSigned',
  'count',
  'score',
  'raw',
];

function isFigureFormat(value: string): value is FigureFormat {
  return (FIGURE_FORMATS as readonly string[]).includes(value);
}

function fail(turn: ScriptedTurn, message: string): never {
  throw new Error(`scripted turn "${turn.id}": ${message}`);
}

/**
 * Turns `{{key}}` into `[[e:<evidence id>|<formatted value>]]`.
 *
 * The one place a figure can enter the prose, and it cannot enter without an Evidence record
 * standing behind it — which is what makes "the scripted narrative is as grounded as the
 * model's" a structural property rather than a promise about how carefully the turns were
 * written.
 */
function expandTemplate(turn: ScriptedTurn, evidenceByKey: Map<string, Evidence>): string {
  return turn.template.replace(PLACEHOLDER_RE, (_match, rawKey: string, rawFormat?: string) => {
    const key = rawKey.trim();
    const evidence = evidenceByKey.get(key);
    if (!evidence) {
      fail(turn, `template references "{{${key}}}" but no tool call carries that key`);
    }

    if (evidence.value.kind !== 'scalar') {
      // The verifier recomputes a citation by re-running its tool and comparing one number.
      // A series or a table has no single number to compare against, so citing one could
      // never verify — it would fail closed at render time. Refuse at authoring time and say
      // why: call the tool for its receipt, describe it in words, cite scalars.
      fail(
        turn,
        `"${key}" is a ${evidence.value.kind} from ${evidence.tool}; only scalar evidence ` +
          'can be cited, because the verifier recomputes a citation as a single number',
      );
    }

    const requested = rawFormat === undefined ? undefined : rawFormat.trim();
    if (requested !== undefined && !isFigureFormat(requested)) {
      fail(turn, `unknown figure format "${requested}" on "{{${key}}}"`);
    }

    const chosen: FigureFormat =
      requested ?? turn.formats?.[key] ?? defaultFormatFor(evidence.unit);

    // The demonstration of the gate: the number is corrupted, the citation is not. The
    // narrative goes on pointing at real evidence that computes something else, which is
    // exactly the production failure this architecture exists to catch.
    const shown =
      turn.poison?.key === key ? evidence.value.n * turn.poison.multiplier : evidence.value.n;

    return `[[e:${evidence.id}|${formatFigure(shown, evidence.unit, chosen)}]]`;
  });
}

// ─── The runner ─────────────────────────────────────────────────────────────────────

function runCall(
  turn: ScriptedTurn,
  call: ScriptedToolCall,
  input: ScriptedRunInput,
): { evidence: Evidence; record: ToolCallRecord } {
  const tool = input.tools.get(call.tool);
  if (!tool) {
    fail(turn, `call "${call.key}" names tool "${call.tool}", which is not in the registry`);
  }

  const startedAt = Date.now();
  try {
    const evidence = tool.run(call.params as never, input.dataset);
    return {
      evidence,
      record: {
        name: call.tool,
        params: call.params,
        evidenceId: evidence.id,
        ok: true,
        // Real elapsed time. Replay saves the model round-trip, not the analysis, and the
        // analysis is the half that a real club's data volume will make expensive.
        ms: Date.now() - startedAt,
      },
    };
  } catch (err) {
    fail(
      turn,
      `tool "${call.tool}" threw for call "${call.key}" with ` +
        `${JSON.stringify(call.params)}: ${(err as Error).message}`,
    );
  }
}

export const runScriptedTurn: RunScriptedTurn = (input: ScriptedRunInput): AssistantTurn => {
  const startedAt = Date.now();
  const { turn } = input;

  // A poison key matching no call would silently produce a perfectly verified turn on the
  // one page that exists to show verification failing. Catch the typo, not the symptom.
  if (turn.poison && !turn.calls.some((c) => c.key === turn.poison?.key)) {
    fail(turn, `poison targets key "${turn.poison.key}", which no tool call produces`);
  }

  const evidenceByKey = new Map<string, Evidence>();
  const evidenceById = new Map<string, Evidence>();
  const toolCalls: ToolCallRecord[] = [];

  for (const call of turn.calls) {
    if (evidenceByKey.has(call.key)) {
      fail(turn, `duplicate call key "${call.key}"`);
    }
    const { evidence, record } = runCall(turn, call, input);
    evidenceByKey.set(call.key, evidence);
    // Two calls can legitimately collapse onto one Evidence id, since ids are a hash of
    // tool, version and params. The verifier keys by id, so a Map is the right shape.
    evidenceById.set(evidence.id, evidence);
    toolCalls.push(record);
  }

  const narrative = expandTemplate(turn, evidenceByKey);

  const proposedActions: ProposedAction[] = (turn.proposes ?? []).map((p) =>
    proposeAction(p.kind, p.args, p.rationale),
  );

  const verification = verifyNarrative({
    narrative,
    evidence: evidenceById,
    dataset: input.dataset,
    tools: input.tools,
  });

  // The conversation as it actually happened. No synthetic tool_use blocks: no model chose
  // these calls, and inventing a transcript implying one did would be the exact species of
  // quiet dishonesty this prototype argues against. What is here is true, and it is enough
  // for a live follow-up turn to continue from once a key is configured.
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: turn.question }] },
    { role: 'assistant', content: [{ type: 'text', text: narrative }] },
  ];

  return {
    status: verification.status === 'verified' ? 'answered' : 'blocked',
    raw: narrative,
    segments: toSegments(narrative),
    verification,
    evidence: [...evidenceById.values()],
    toolCalls,
    proposedActions,
    // Replay spends no tokens. A plausible-looking number here would corrupt the one place
    // the eval suite reports cost, so it reports the truth: nothing was spent.
    usage: { inputTokens: 0, outputTokens: 0 },
    servedBy: 'replay',
    // There is no repair round to run: the wording is fixed, so a second attempt would
    // produce an identical narrative and an identical failure.
    repaired: false,
    totalMs: Date.now() - startedAt,
    messages,
  };
};
