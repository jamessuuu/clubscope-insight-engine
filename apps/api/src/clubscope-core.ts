/**
 * The single seam between this HTTP layer and `@clubscope/core`.
 *
 * Every import of the domain package in this application goes through this file, for two
 * reasons — one practical, one architectural.
 *
 * **Practical.** Core is an ESM package that publishes TypeScript source and writes
 * `.js`-suffixed relative specifiers. Reaching it by relative path (rather than by the
 * `@clubscope/core/*` subpath alias) keeps the specifiers that survive into the emitted
 * CommonJS output *real paths* rather than aliases a runtime would have to be taught to
 * resolve. `tsconfig.json` explains the compile-time half. Concentrating those paths in
 * one file means the awkwardness is stated once, next to its justification, instead of
 * being smeared across thirty controllers.
 *
 * **Architectural.** This file is a readable inventory of exactly what the API consumes
 * from the domain: sixteen analysis tools, a verifier, a churn model, an insight detector
 * and a scripted assistant runner — and nothing else. If a controller ever needs something
 * that is not listed here, that is a design conversation, not an import.
 *
 * The re-exports are deliberately named rather than `export *`: a wildcard would let core's
 * surface widen silently and would make this inventory a lie.
 */

// ─── Domain model ───────────────────────────────────────────────────────────────────
export type {
  ClubDataset,
  ClubEvent,
  ClubKind,
  EventRegistration,
  FacilityKind,
  Member,
  MemberNote,
  MembershipCategory,
  MemberStatus,
  RevenueCategory,
  Transaction,
  Visit,
} from '../../../packages/core/src/domain/types';

// ─── Data ───────────────────────────────────────────────────────────────────────────
export { DEFAULT_SEED, getDataset } from '../../../packages/core/src/data/index';

// ─── Analysis tools (the grounding layer) ───────────────────────────────────────────
export {
  bandAtOrAbove,
  getTool,
  MEMBER_STATUSES,
  MEMBERSHIP_CATEGORIES,
  RISK_BANDS,
  TOOL_REGISTRY,
  toolSpecsForModel,
} from '../../../packages/core/src/tools/index';
export type {
  AnalysisTool,
  Evidence,
  EvidenceValue,
  ModelToolSpec,
  RiskBand,
  ToolParamSpec,
  Unit,
} from '../../../packages/core/src/tools/index';

// ─── Groundedness verifier ──────────────────────────────────────────────────────────
export { verifyNarrative } from '../../../packages/core/src/verify/verifier';
export type {
  FigureCheck,
  NarrativeSegment,
  VerificationReport,
} from '../../../packages/core/src/verify/verifier';

// ─── Deterministic churn model ──────────────────────────────────────────────────────
export {
  assessChurn,
  CHURN_MODEL_VERSION,
} from '../../../packages/core/src/scoring/churn';
export type {
  ChurnAssessment,
  Contribution,
} from '../../../packages/core/src/scoring/churn';

// ─── Insight detection ──────────────────────────────────────────────────────────────
export { detectInsights } from '../../../packages/core/src/insights/index';
export type {
  Insight,
  InsightKind,
  InsightSeverity,
  SuggestedAction,
} from '../../../packages/core/src/insights/types';

// ─── Assistant (replay / scripted path) ─────────────────────────────────────────────
export type { ProposedAction } from '../../../packages/core/src/assistant/actions';
export type {
  AssistantTurn,
  ToolCallRecord,
} from '../../../packages/core/src/assistant/runtime';
export type { ScriptedTurn } from '../../../packages/core/src/assistant/scripted';
export {
  SCRIPTED_TURNS,
  getTurn,
} from '../../../packages/core/src/assistant/turns';
export { runScriptedTurn } from '../../../packages/core/src/assistant/scripted-runner';
