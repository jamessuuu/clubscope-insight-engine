import type { Evidence } from '@clubscope/core/tools';
import type { NarrativeSegment, VerificationReport } from '@clubscope/core/verify';
import type {
  ActionKind,
  AuditEntry,
  ProposedAction,
  ToolCallRecord,
} from '@clubscope/core/assistant';
import type { Insight, SuggestedAction } from '@clubscope/core/insights';

/**
 * The wire shapes between server and client.
 *
 * Kept in their own module, importing nothing but types, so a client component can name them
 * without dragging `packages/core` into the browser bundle. Core reaches for `node:crypto`,
 * so a stray value import from a `'use client'` file is a build failure, and a types-only
 * module makes that mistake hard to make by accident.
 */

/**
 * The result of re-running a tool, returned by `/api/receipt`.
 *
 * Deliberately reports what the source computes and stops there. Whether that agrees with
 * the figure on screen is decided in the component, against the evidence the page already
 * holds — so the verdict is never something the browser asked a server to assert on its
 * behalf, it is a comparison the reader could do themselves from what is displayed.
 */
export type RecomputeResult =
  | {
      ok: true;
      /** Null for series and table evidence, which have no single scalar to compare. */
      value: number | null;
      kind: string;
      rowCount: number;
      detail: string;
      ms: number;
    }
  | { ok: false; detail: string; ms: number };

/** One assistant turn, flattened for the client. */
export interface TurnPayload {
  turnId: string;
  question: string;
  topic: string;
  status: 'answered' | 'blocked';
  segments: NarrativeSegment[];
  verification: VerificationReport;
  toolCalls: ToolCallRecord[];
  proposedActions: ProposedAction[];
  evidence: Evidence[];
  servedBy: string;
  totalMs: number;
  /** True when this turn is one of the deliberate out-of-coverage refusals. */
  refusal: boolean;
}

export type {
  ActionKind,
  AuditEntry,
  Evidence,
  Insight,
  NarrativeSegment,
  ProposedAction,
  SuggestedAction,
  ToolCallRecord,
  VerificationReport,
};
