import { createHash } from 'node:crypto';
import type { ClubDataset } from '../domain/types.js';

/**
 * The unit of grounding.
 *
 * Every number this system is willing to show a user originates in one of these records.
 * A figure that cannot point at an Evidence record is, by construction, not renderable.
 */
export interface Evidence {
  /** Deterministic: hash of tool name, version and canonicalised params. */
  id: string;
  tool: string;
  toolVersion: string;
  params: Record<string, unknown>;
  /** The computed result. Scalars for headline figures, series/table for breakdowns. */
  value: EvidenceValue;
  unit: Unit;
  /** Plain-English description of exactly how the number was derived. Shown in the UI. */
  method: string;
  /** IDs of the precise source rows consumed. This is what makes the receipt real. */
  rowIds: string[];
  rowCount: number;
  computedAt: string;
}

export type EvidenceValue =
  | { kind: 'scalar'; n: number }
  | { kind: 'text'; s: string }
  | { kind: 'series'; points: Array<{ label: string; n: number }> }
  | { kind: 'table'; columns: string[]; rows: Array<Array<string | number>> };

export type Unit =
  | 'usd'
  | 'count'
  | 'percent'
  | 'days'
  | 'minutes'
  | 'score'
  | 'ratio'
  | 'none';

export interface ToolParamSpec {
  type: 'string' | 'number' | 'boolean' | 'enum';
  description: string;
  enum?: string[];
  required?: boolean;
  default?: unknown;
}

/**
 * An analysis tool is a pure function of (params, dataset) → Evidence.
 *
 * Purity is the whole point: it makes every tool unit-testable in isolation, makes the
 * verifier's recomputation meaningful, and guarantees that two identical questions asked a
 * month apart produce the same figure. No tool may call a model.
 */
export interface AnalysisTool<P = Record<string, never>> {
  name: string;
  version: string;
  /** Description handed to the model for tool selection. Written for the model to read. */
  description: string;
  params: Record<string, ToolParamSpec>;
  /** Read-only tools answer; acting tools mutate and require human confirmation. */
  kind: 'read' | 'act';
  run(params: P, ds: ClubDataset): Evidence;
}

/** Stable, order-independent serialisation so evidence IDs are reproducible. */
export function canonicalise(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  return JSON.stringify(keys.map((k) => [k, params[k]]));
}

export function evidenceId(
  tool: string,
  version: string,
  params: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(`${tool}@${version}:${canonicalise(params)}`)
    .digest('hex')
    .slice(0, 16);
}

/** Helper used by every tool so the Evidence shape is constructed one way only. */
export function makeEvidence(args: {
  tool: string;
  version: string;
  params: Record<string, unknown>;
  value: EvidenceValue;
  unit: Unit;
  method: string;
  rowIds: string[];
}): Evidence {
  return {
    id: evidenceId(args.tool, args.version, args.params),
    tool: args.tool,
    toolVersion: args.version,
    params: args.params,
    value: args.value,
    unit: args.unit,
    method: args.method,
    // Receipts stay legible: cap the stored row list, but never lie about the true count.
    rowIds: args.rowIds.slice(0, 500),
    rowCount: args.rowIds.length,
    computedAt: new Date().toISOString(),
  };
}

/** Extracts the scalar from an Evidence record, or throws — used by the verifier. */
export function scalarOf(e: Evidence): number {
  if (e.value.kind !== 'scalar') {
    throw new Error(`evidence ${e.id} is ${e.value.kind}, not scalar`);
  }
  return e.value.n;
}
