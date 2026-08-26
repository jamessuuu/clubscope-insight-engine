import type { ClubDataset } from '../domain/types.js';
import type { AnalysisTool } from '../tools/evidence.js';
import type { ProposedAction } from './actions.js';
import type { AssistantTurn } from './runtime.js';

/**
 * Scripted turns — how the assistant behaves with no model API key configured.
 *
 * ## What is real here and what is not
 *
 * Real, on every request: the tool calls execute against the dataset, the Evidence records
 * (values, methods, row ids) are computed fresh, the figures rendered into the prose are the
 * values those tools actually returned, and the groundedness verifier runs the full
 * recomputation pass over the result. If a tool's logic changed and a figure moved, the
 * scripted narrative would be blocked exactly as a model's would.
 *
 * Not real: the *wording*. Which tools to call and how to phrase the answer are fixed in
 * advance rather than chosen by a model.
 *
 * That boundary is stated on the page, not buried here, because a reviewer who discovers an
 * undisclosed limitation stops believing the disclosed parts too. With `ANTHROPIC_API_KEY`
 * set, the identical pipeline runs with Claude choosing the tools and writing the prose, and
 * it must satisfy the same citation contract to render.
 */

export interface ScriptedToolCall {
  /** Key referenced by the template, e.g. `dining`. */
  key: string;
  tool: string;
  params: Record<string, unknown>;
}

/**
 * How a cited figure should be written. The verifier is rounding-aware, so a template may
 * legitimately render `usdCompact` ("$381k") over an exact value — and that path is worth
 * exercising precisely because it is the one a real model takes.
 */
export type FigureFormat =
  | 'usd'
  | 'usdCompact'
  | 'percent'
  | 'percentSigned'
  | 'count'
  | 'score'
  | 'raw';

export interface ScriptedTurn {
  id: string;
  /** The question as shown in the suggested-question list. */
  question: string;
  /** Shown as a starter chip on the Ask page. */
  suggested: boolean;
  /** Short label for grouping in the UI. */
  topic: string;
  calls: ScriptedToolCall[];
  /**
   * Narrative template. `{{key}}` renders the cited figure for that call using the call's
   * default format; `{{key|percentSigned}}` overrides the format. Everything else is prose.
   */
  template: string;
  /** Per-call default formats. */
  formats?: Record<string, FigureFormat>;
  /** Actions this turn proposes, awaiting human confirmation like any other. */
  proposes?: Array<Omit<ProposedAction, 'id' | 'proposedAt' | 'title' | 'impact'>>;
  /**
   * Marks a turn that deliberately answers with a refusal. Used for out-of-coverage
   * questions, and scored as a correct answer by the eval suite.
   */
  refusal?: boolean;
  /**
   * Deliberately corrupts the rendered figure for this key by the given multiplier, to
   * demonstrate the verifier blocking a fabricated number. Only used on the Reliability
   * page; never in the normal Ask flow.
   */
  poison?: { key: string; multiplier: number };
}

export interface ScriptedRunInput {
  turn: ScriptedTurn;
  dataset: ClubDataset;
  tools: Map<string, AnalysisTool<any>>;
}

/** Implemented in `scripted-runner.ts`; declared here so the contract is single-sourced. */
export type RunScriptedTurn = (input: ScriptedRunInput) => AssistantTurn;
