import type { ClubDataset } from '../domain/types.js';
import type { AnalysisTool, Evidence } from '../tools/evidence.js';
import { findFigures, isExemptFigure, parseFigure, roundsTo } from './numbers.js';

/**
 * The groundedness gate.
 *
 * ## Threat model — stated plainly, because an honest scope is the point
 *
 * This verifier defends against the failure that actually occurs in production: the model
 * calls the right tools, receives the right numbers, and then writes *different* numbers
 * into its prose — through fabrication, transcription drift, unit confusion, or blending a
 * figure with something it half-remembers from pre-training. That failure is silent,
 * survives review because the narrative reads well, and is the reason club managers stop
 * trusting an insight feed.
 *
 * It does NOT claim to prove the tool logic is correct — that is the job of the tools' own
 * unit tests — nor that the model chose the *right* tool for the question, which is what
 * the eval suite measures. Three different guarantees, three different mechanisms. Any
 * system claiming one gate covers all three is overselling.
 *
 * ## Contract with the model
 *
 * Every figure in the narrative must be written as `[[e:<evidenceId>|<figure>]]`. The
 * renderer turns those into click-through chips. Any figure left bare in the prose is
 * reported as undeclared, and the whole narrative fails closed.
 */

export const CITATION_RE = /\[\[e:([a-f0-9]{16})\|([^\]]+)\]\]/g;

export type CheckOutcome =
  | 'match'
  | 'mismatch'
  | 'unknown-evidence'
  | 'recompute-failed'
  | 'unsupported-shape'
  | 'undeclared';

export interface FigureCheck {
  /** The figure exactly as the model wrote it. */
  written: string;
  evidenceId?: string;
  /** What the tool actually returns on recomputation. */
  actual?: number;
  outcome: CheckOutcome;
  detail?: string;
}

export interface VerificationReport {
  status: 'verified' | 'blocked';
  checks: FigureCheck[];
  citedCount: number;
  matchedCount: number;
  /** Share of cited figures that survived recomputation. */
  groundedRate: number;
  /** Figures found in prose with no citation at all. */
  undeclaredCount: number;
  recomputedCount: number;
  durationMs: number;
}

export interface VerifyInput {
  narrative: string;
  /** Evidence gathered during the model's tool calls, keyed by id. */
  evidence: Map<string, Evidence>;
  dataset: ClubDataset;
  /** Tool registry, so each cited figure can be recomputed from source. */
  tools: Map<string, AnalysisTool<any>>;
}

/**
 * Re-executes the tool behind a piece of evidence and returns its scalar value.
 * Recomputation — rather than trusting the evidence object carried through the request —
 * is what closes the loop: a tampered or stale evidence payload cannot pass.
 */
function recompute(
  ev: Evidence,
  input: VerifyInput,
): { ok: true; value: number } | { ok: false; reason: string } {
  const tool = input.tools.get(ev.tool);
  if (!tool) return { ok: false, reason: `tool "${ev.tool}" not registered` };
  if (tool.version !== ev.toolVersion) {
    return {
      ok: false,
      reason: `tool version drift: evidence ${ev.toolVersion}, registry ${tool.version}`,
    };
  }
  try {
    const fresh = tool.run(ev.params as any, input.dataset);
    if (fresh.value.kind !== 'scalar') {
      return { ok: false, reason: `tool returned ${fresh.value.kind}, not a scalar` };
    }
    return { ok: true, value: fresh.value.n };
  } catch (err) {
    return { ok: false, reason: `recomputation threw: ${(err as Error).message}` };
  }
}

export function verifyNarrative(input: VerifyInput): VerificationReport {
  const started = Date.now();
  const checks: FigureCheck[] = [];
  let recomputedCount = 0;

  // 1. Every declared citation must survive recomputation.
  for (const m of input.narrative.matchAll(CITATION_RE)) {
    const [, evidenceId, written] = m;
    const ev = input.evidence.get(evidenceId);

    if (!ev) {
      checks.push({
        written,
        evidenceId,
        outcome: 'unknown-evidence',
        detail: 'cited an evidence id that was never produced by a tool call',
      });
      continue;
    }

    const figure = parseFigure(written);
    if (!figure) {
      checks.push({
        written,
        evidenceId,
        outcome: 'unsupported-shape',
        detail: 'citation payload is not a parseable figure',
      });
      continue;
    }

    const fresh = recompute(ev, input);
    recomputedCount++;
    if (!fresh.ok) {
      checks.push({ written, evidenceId, outcome: 'recompute-failed', detail: fresh.reason });
      continue;
    }

    if (roundsTo(figure, fresh.value)) {
      checks.push({ written, evidenceId, actual: fresh.value, outcome: 'match' });
    } else {
      checks.push({
        written,
        evidenceId,
        actual: fresh.value,
        outcome: 'mismatch',
        detail: `narrative says ${written}, source computes ${fresh.value}`,
      });
    }
  }

  // 2. Nothing numeric may travel uncited. Strip citations first so their payloads are
  //    not double-counted, then sweep whatever prose remains.
  const stripped = input.narrative.replace(CITATION_RE, ' ');
  for (const f of findFigures(stripped)) {
    if (isExemptFigure(f)) continue;
    checks.push({
      written: f.raw,
      outcome: 'undeclared',
      detail: 'figure appears in prose without an evidence citation',
    });
  }

  const cited = checks.filter((c) => c.evidenceId !== undefined);
  const matched = cited.filter((c) => c.outcome === 'match');
  const undeclared = checks.filter((c) => c.outcome === 'undeclared');

  return {
    status: checks.every((c) => c.outcome === 'match') ? 'verified' : 'blocked',
    checks,
    citedCount: cited.length,
    matchedCount: matched.length,
    groundedRate: cited.length === 0 ? 1 : matched.length / cited.length,
    undeclaredCount: undeclared.length,
    recomputedCount,
    durationMs: Date.now() - started,
  };
}

export type NarrativeSegment =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; text: string; evidenceId: string };

/**
 * Splits a verified narrative into renderable segments so the UI can attach a receipt to
 * every figure. Presentation stays dumb; the trust decision was already made upstream.
 */
export function toSegments(narrative: string): NarrativeSegment[] {
  const segments: NarrativeSegment[] = [];
  let cursor = 0;
  for (const m of narrative.matchAll(CITATION_RE)) {
    const at = m.index ?? 0;
    if (at > cursor) segments.push({ kind: 'text', text: narrative.slice(cursor, at) });
    segments.push({ kind: 'figure', text: m[2], evidenceId: m[1] });
    cursor = at + m[0].length;
  }
  if (cursor < narrative.length) {
    segments.push({ kind: 'text', text: narrative.slice(cursor) });
  }
  return segments;
}
