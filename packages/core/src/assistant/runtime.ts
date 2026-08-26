import type { ClubDataset } from '../domain/types.js';
import type { AnalysisTool, Evidence } from '../tools/evidence.js';
import { toSegments, verifyNarrative, type NarrativeSegment, type VerificationReport } from '../verify/verifier.js';
import {
  actionKindFromToolName,
  actionSpecsForModel,
  isActionToolName,
  proposeAction,
  type ProposedAction,
} from './actions.js';
import { buildRepairPrompt, buildSystemPrompt } from './prompt.js';
import type { ContentBlock, Message, ModelProvider, ToolSpec } from './provider.js';

/**
 * The agent loop.
 *
 * Three deliberate constraints, each one a lesson from shipping this kind of feature:
 *
 *  - **Bounded tool rounds.** A model that cannot answer in six tool calls is not going to
 *    find it on the twentieth; it is going to spend money discovering that. Cap it and say
 *    so out loud rather than letting latency drift into a minute.
 *  - **Exactly one repair attempt.** When verification fails, the model gets one chance with
 *    precise feedback about which figures failed. If it fails again, we surface the failure
 *    to the user instead of grinding. Unbounded self-correction reliably converges on
 *    confident nonsense.
 *  - **Actions are intercepted, never executed.** The loop turns an action tool call into a
 *    proposal object and tells the model that is what happened, so it never reports work as
 *    done that a human has not approved.
 */

export interface AssistantTurnInput {
  question: string;
  /** Prior turns, already in provider message format. */
  history?: Message[];
  dataset: ClubDataset;
  tools: Map<string, AnalysisTool<any>>;
  provider: ModelProvider;
  model?: string;
  maxToolRounds?: number;
  allowRepair?: boolean;
}

export interface ToolCallRecord {
  name: string;
  params: Record<string, unknown>;
  evidenceId?: string;
  ok: boolean;
  error?: string;
  ms: number;
}

export interface AssistantTurn {
  status: 'answered' | 'blocked';
  /** Raw narrative including citation markers, kept for evals and debugging. */
  raw: string;
  segments: NarrativeSegment[];
  verification: VerificationReport;
  evidence: Evidence[];
  toolCalls: ToolCallRecord[];
  proposedActions: ProposedAction[];
  usage: { inputTokens: number; outputTokens: number };
  servedBy: 'anthropic' | 'replay';
  /** True when the first attempt failed verification and the repair round ran. */
  repaired: boolean;
  totalMs: number;
  messages: Message[];
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** Converts the analysis registry into the model's tool schema, plus the action proposals. */
export function buildToolSpecs(tools: Map<string, AnalysisTool<any>>): ToolSpec[] {
  const analysis: ToolSpec[] = [...tools.values()].map((t) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [name, spec] of Object.entries(t.params)) {
      properties[name] =
        spec.type === 'enum'
          ? { type: 'string', enum: spec.enum ?? [], description: spec.description }
          : { type: spec.type, description: spec.description };
      if (spec.required) required.push(name);
    }
    return {
      name: t.name,
      description: t.description,
      input_schema: { type: 'object' as const, properties, required },
    };
  });
  return [...analysis, ...actionSpecsForModel()];
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * What the model sees after a tool runs.
 *
 * The evidenceId is listed first and labelled unmistakably, because everything downstream
 * depends on the model citing it. Value is rendered in a compact, unambiguous form — a
 * model that has to parse its own tool output is a model that will misread it.
 */
function renderToolResult(ev: Evidence): string {
  const value =
    ev.value.kind === 'scalar'
      ? String(ev.value.n)
      : ev.value.kind === 'text'
        ? ev.value.s
        : JSON.stringify(ev.value);
  return JSON.stringify(
    {
      evidenceId: ev.id,
      value,
      unit: ev.unit,
      method: ev.method,
      rowsUsed: ev.rowCount,
      citeAs: `[[e:${ev.id}|<figure>]]`,
    },
    null,
    0,
  );
}

export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurn> {
  const started = Date.now();
  const maxRounds = input.maxToolRounds ?? 6;
  const allowRepair = input.allowRepair ?? true;
  const system = buildSystemPrompt(input.dataset);
  const toolSpecs = buildToolSpecs(input.tools);

  const evidence = new Map<string, Evidence>();
  const toolCalls: ToolCallRecord[] = [];
  const proposedActions: ProposedAction[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let servedBy: 'anthropic' | 'replay' = 'replay';

  const messages: Message[] = [
    ...(input.history ?? []),
    { role: 'user', content: [{ type: 'text', text: input.question }] },
  ];

  let narrative = '';

  const runRounds = async (): Promise<void> => {
    for (let round = 0; round < maxRounds; round++) {
      const res = await input.provider.complete({
        system,
        messages,
        tools: toolSpecs,
        maxTokens: 2048,
        temperature: 0,
        model: input.model ?? DEFAULT_MODEL,
      });

      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      servedBy = res.servedBy;

      const toolUses = res.content.filter(
        (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        narrative = textOf(res.content);
        return;
      }

      messages.push({ role: 'assistant', content: res.content });

      const results: ContentBlock[] = [];
      for (const call of toolUses) {
        const t0 = Date.now();

        // Acting tools are intercepted here and never reach an executor.
        if (isActionToolName(call.name)) {
          const kind = actionKindFromToolName(call.name);
          if (!kind) {
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: `Unknown action "${call.name}".`,
              is_error: true,
            });
            toolCalls.push({ name: call.name, params: call.input, ok: false, error: 'unknown action', ms: Date.now() - t0 });
            continue;
          }
          const action = proposeAction(kind, call.input, textOf(res.content) || 'Proposed from the current analysis.');
          proposedActions.push(action);
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: `Proposal recorded and shown to the user for confirmation. It has NOT been executed. Do not tell the user it is done; tell them it awaits their approval.`,
          });
          toolCalls.push({ name: call.name, params: call.input, ok: true, ms: Date.now() - t0 });
          continue;
        }

        const tool = input.tools.get(call.name);
        if (!tool) {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: `No tool named "${call.name}" exists. Available: ${[...input.tools.keys()].join(', ')}.`,
            is_error: true,
          });
          toolCalls.push({ name: call.name, params: call.input, ok: false, error: 'unknown tool', ms: Date.now() - t0 });
          continue;
        }

        try {
          const ev = tool.run(call.input as any, input.dataset);
          evidence.set(ev.id, ev);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: renderToolResult(ev) });
          toolCalls.push({ name: call.name, params: call.input, evidenceId: ev.id, ok: true, ms: Date.now() - t0 });
        } catch (err) {
          // Errors go back to the model as text so it can correct its arguments, rather
          // than the whole turn dying on one bad parameter.
          const message = (err as Error).message;
          results.push({ type: 'tool_result', tool_use_id: call.id, content: `Tool error: ${message}`, is_error: true });
          toolCalls.push({ name: call.name, params: call.input, ok: false, error: message, ms: Date.now() - t0 });
        }
      }

      messages.push({ role: 'user', content: results });
    }

    // Ran out of rounds without a final answer. Say so; do not fabricate a conclusion.
    narrative =
      narrative ||
      'I was not able to reach a grounded answer within the tool-call budget for this question. Try narrowing it to a single metric or period.';
  };

  await runRounds();

  let verification = verifyNarrative({
    narrative,
    evidence,
    dataset: input.dataset,
    tools: input.tools,
  });

  let repaired = false;
  if (verification.status === 'blocked' && allowRepair) {
    const failures = verification.checks
      .filter((c) => c.outcome !== 'match')
      .map((c) => ({
        written: c.written,
        reason:
          c.outcome === 'mismatch'
            ? `source computes ${c.actual}`
            : c.outcome === 'undeclared'
              ? 'no evidence citation'
              : (c.detail ?? c.outcome),
      }));

    messages.push({ role: 'assistant', content: [{ type: 'text', text: narrative }] });
    messages.push({ role: 'user', content: [{ type: 'text', text: buildRepairPrompt(failures) }] });

    repaired = true;
    await runRounds();
    verification = verifyNarrative({
      narrative,
      evidence,
      dataset: input.dataset,
      tools: input.tools,
    });
  }

  return {
    status: verification.status === 'verified' ? 'answered' : 'blocked',
    raw: narrative,
    segments: toSegments(narrative),
    verification,
    evidence: [...evidence.values()],
    toolCalls,
    proposedActions,
    usage,
    servedBy,
    repaired,
    totalMs: Date.now() - started,
    messages,
  };
}
