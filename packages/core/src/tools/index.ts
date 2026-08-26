import type { AnalysisTool, ToolParamSpec } from './evidence.js';
import { dataCoverage } from './coverage.js';
import {
  revenueByCategory,
  revenueMonthlySeries,
  revenueTotal,
  revenueTrend,
} from './revenue.js';
import {
  churnCohortSize,
  cohortRetention,
  duesAtRisk,
  memberChurnScore,
  memberCount,
} from './members.js';
import { eventAttendanceRate, facilityUtilisation, visitTrend } from './engagement.js';
import { avgDiscretionarySpend, topMembersBySpend } from './spend.js';
import { searchMemberNotes } from './notes.js';

export * from './common.js';
export * from './evidence.js';
export * from './coverage.js';
export * from './revenue.js';
export * from './members.js';
export * from './engagement.js';
export * from './spend.js';
export * from './notes.js';

/**
 * The analysis tool registry.
 *
 * This list is the assistant's entire capability surface for answering questions, and the
 * boundary is the point: a question that cannot be expressed as a call into this registry
 * is a question the assistant must decline rather than improvise. The registry is also what
 * the verifier holds - it re-runs tools by name from here, so an evidence record naming a
 * tool that is not in this map fails closed instead of being trusted.
 */
const ALL_TOOLS: Array<AnalysisTool<any>> = [
  dataCoverage,
  revenueTotal,
  revenueByCategory,
  revenueTrend,
  revenueMonthlySeries,
  memberCount,
  churnCohortSize,
  duesAtRisk,
  memberChurnScore,
  facilityUtilisation,
  visitTrend,
  eventAttendanceRate,
  avgDiscretionarySpend,
  topMembersBySpend,
  searchMemberNotes,
  cohortRetention,
];

export const TOOL_REGISTRY: Map<string, AnalysisTool<any>> = new Map(
  ALL_TOOLS.map((tool) => [tool.name, tool]),
);

// Two tools answering to the same name would make evidence ambiguous and recomputation
// silently wrong, so the collision is caught at module load rather than at 3am.
if (TOOL_REGISTRY.size !== ALL_TOOLS.length) {
  throw new Error('duplicate tool name in the analysis tool registry');
}

export function getTool(name: string): AnalysisTool<any> | undefined {
  return TOOL_REGISTRY.get(name);
}

// ─── Model-facing schema ────────────────────────────────────────────────────────────

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean';
  description: string;
  enum?: string[];
  default?: unknown;
}

/** Exactly the shape the Anthropic Messages API expects in its `tools` array. */
export interface ModelToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
  };
}

/**
 * JSON Schema has no enum *type* - an enum is a string constrained by an `enum` keyword.
 * Collapsing our 'enum' kind here, in one place, is what stops a tool author from having to
 * remember it and getting a schema the model quietly ignores.
 */
function toJsonSchema(spec: ToolParamSpec): JsonSchemaProperty {
  const base: JsonSchemaProperty =
    spec.type === 'enum'
      ? { type: 'string', description: spec.description, enum: spec.enum ?? [] }
      : { type: spec.type, description: spec.description };

  return spec.default === undefined ? base : { ...base, default: spec.default };
}

/**
 * Renders the registry as tool definitions for the model.
 *
 * Descriptions are written for a model to read rather than for a developer, because tool
 * *selection* is the one part of this pipeline the verifier cannot check: it can prove the
 * number is real, never that it answers the question asked. Selection quality is bought
 * with unambiguous descriptions here and measured by the eval suite, not by the gate.
 */
export function toolSpecsForModel(): ModelToolSpec[] {
  return [...TOOL_REGISTRY.values()].map((tool) => {
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];

    for (const [name, spec] of Object.entries(tool.params)) {
      properties[name] = toJsonSchema(spec);
      if (spec.required === true) required.push(name);
    }

    return {
      name: tool.name,
      description: tool.description,
      input_schema: { type: 'object', properties, required },
    };
  });
}
