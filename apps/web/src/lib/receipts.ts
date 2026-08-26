import { TOOL_REGISTRY } from '@clubscope/core/tools';
import type { Evidence } from '@clubscope/core/tools';
import { club } from './club';
import type { RecomputeResult } from './types';

/**
 * How many source row ids travel to the browser with a piece of evidence.
 *
 * The Evidence record keeps up to 500 while reporting the true `rowCount`. Shipping all of
 * them for every figure on a page that carries forty figures would put tens of thousands of
 * ids in the payload to render fourteen of them. The receipt states how many it is showing
 * against how many rows were consumed, so the trim is visible rather than implied.
 */
const RECEIPT_ROW_IDS = 40;

export function forTransport(evidence: Evidence): Evidence {
  return evidence.rowIds.length <= RECEIPT_ROW_IDS
    ? evidence
    : { ...evidence, rowIds: evidence.rowIds.slice(0, RECEIPT_ROW_IDS) };
}

/** Dedupes by evidence id and trims row ids. Order is preserved. */
export function forClient(list: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of list) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(forTransport(e));
  }
  return out;
}

export interface RecomputeRequest {
  tool: string;
  toolVersion: string;
  params: Record<string, unknown>;
}

/**
 * Re-executes the tool behind a figure, on demand.
 *
 * This runs when someone opens a receipt rather than when the page renders, and both halves
 * of that matter. It makes the panel's "recomputed just now" literally true instead of
 * true-as-of-the-build. And it keeps the cost proportional to curiosity: the churn tools
 * rescore every member on the roll, so eagerly recomputing forty receipts nobody opened put
 * seconds onto a page load in exchange for nothing.
 *
 * The version check fails closed. Comparing a figure computed by v1.0 against v1.1 proves
 * nothing in either direction, so it refuses rather than reporting a mismatch that is really
 * a version skew.
 */
export function recomputeEvidence(request: RecomputeRequest): RecomputeResult {
  const started = Date.now();
  const tool = TOOL_REGISTRY.get(request.tool);

  if (!tool) {
    return {
      ok: false,
      detail: `No tool named "${request.tool}" is registered, so this figure cannot be re-derived.`,
      ms: Date.now() - started,
    };
  }

  if (tool.version !== request.toolVersion) {
    return {
      ok: false,
      detail: `Version drift: this evidence came from ${request.tool}@${request.toolVersion}, the registry now holds ${tool.version}. Fails closed rather than comparing across versions.`,
      ms: Date.now() - started,
    };
  }

  try {
    const fresh = tool.run(request.params, club());
    return {
      ok: true,
      value: fresh.value.kind === 'scalar' ? fresh.value.n : null,
      kind: fresh.value.kind,
      rowCount: fresh.rowCount,
      detail: `Re-executed ${request.tool}@${request.toolVersion} over ${fresh.rowCount} source ${fresh.rowCount === 1 ? 'row' : 'rows'}.`,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      detail: `Recomputation threw: ${(err as Error).message}`,
      ms: Date.now() - started,
    };
  }
}
