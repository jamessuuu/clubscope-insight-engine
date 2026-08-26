import { randomUUID } from 'node:crypto';
import type { ToolSpec } from './provider.js';

/**
 * Actions — the half of the brief that says assistants should "take actions".
 *
 * ## The design position
 *
 * An assistant that can only answer is a search box with better manners. An assistant that
 * can act without a gate is an unbounded liability the first time it misreads a question.
 * The useful middle is **propose-and-confirm**: the model composes a fully-formed action
 * with real arguments, a human approves it in one click, and the system records who
 * approved what, when, and on whose suggestion.
 *
 * That last clause is the part teams forget. If an action can be traced only to "the AI",
 * nobody owns the outcome, and the first bad action ends the programme. Every entry in this
 * audit log names a human actor and marks the assistant as the originator — so
 * accountability is preserved without pretending a person typed it.
 *
 * Actions are therefore **never** exposed to the model as executable tools. The model emits
 * a proposal; execution is a separate, human-triggered code path.
 */

export type ActionKind =
  | 'create_task'
  | 'draft_member_outreach'
  | 'flag_member_for_review'
  | 'schedule_report';

/**
 * Reversibility, which is what should actually drive confirmation friction — not how
 * impressive the action sounds. Drafting an email a human still has to send is low impact;
 * anything that touches a member record is not.
 */
export type Impact = 'low' | 'medium' | 'high';

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  /** One-line human summary shown on the confirmation card. */
  title: string;
  args: Record<string, unknown>;
  /** Why the assistant thinks this is warranted. Shown so the human can disagree. */
  rationale: string;
  impact: Impact;
  proposedAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  /** The human who made the call. Actions never have a non-human actor. */
  actor: string;
  /** True when the assistant originated the proposal, which is almost always. */
  originatedByAssistant: boolean;
  action: ProposedAction;
  outcome: 'confirmed' | 'rejected';
  /** What actually happened, recorded after execution. */
  result?: string;
}

export interface ActionDefinition {
  kind: ActionKind;
  description: string;
  impact: Impact;
  params: Record<string, { type: 'string' | 'number'; description: string; required: boolean }>;
  /** Builds the human-readable title from the arguments. */
  title(args: Record<string, unknown>): string;
  /** Executes only after human confirmation. Returns a description of what happened. */
  execute(args: Record<string, unknown>, store: SessionStore): string;
}

export interface Task {
  id: string;
  title: string;
  assignee: string;
  dueDate: string;
  notes: string;
  createdAt: string;
}

export interface OutreachDraft {
  id: string;
  memberId: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface MemberFlag {
  id: string;
  memberId: string;
  reason: string;
  createdAt: string;
}

export interface ScheduledReport {
  id: string;
  name: string;
  cadence: string;
  recipients: string;
  createdAt: string;
}

/**
 * Per-session state.
 *
 * Deliberately in-memory and session-scoped. This is a demonstration artifact: every
 * visitor should get a clean club to explore, and nothing anyone does here should persist
 * or leak into anyone else's session. A real deployment swaps this for the product's own
 * persistence without touching the action definitions above.
 */
export class SessionStore {
  tasks: Task[] = [];
  outreach: OutreachDraft[] = [];
  flags: MemberFlag[] = [];
  reports: ScheduledReport[] = [];
  audit: AuditEntry[] = [];
  readonly createdAt = new Date().toISOString();
}

function str(args: Record<string, unknown>, key: string, fallback = ''): string {
  const v = args[key];
  return typeof v === 'string' ? v : fallback;
}

export const ACTION_DEFINITIONS: Record<ActionKind, ActionDefinition> = {
  create_task: {
    kind: 'create_task',
    description:
      'Create a task for a member of staff to follow up on something identified in the data. Use when an insight needs human work rather than a message to a member.',
    impact: 'low',
    params: {
      title: { type: 'string', description: 'Short imperative title for the task.', required: true },
      assignee: {
        type: 'string',
        description: 'Role or person the task is for, e.g. "Membership Director".',
        required: true,
      },
      dueDate: { type: 'string', description: 'ISO date the task is due.', required: true },
      notes: { type: 'string', description: 'Context, including the figures that justify it.', required: false },
    },
    title: (a) => `Create task: ${str(a, 'title')} → ${str(a, 'assignee')}`,
    execute: (a, store) => {
      const task: Task = {
        id: randomUUID(),
        title: str(a, 'title'),
        assignee: str(a, 'assignee'),
        dueDate: str(a, 'dueDate'),
        notes: str(a, 'notes'),
        createdAt: new Date().toISOString(),
      };
      store.tasks.unshift(task);
      return `Task "${task.title}" assigned to ${task.assignee}, due ${task.dueDate}.`;
    },
  },

  draft_member_outreach: {
    kind: 'draft_member_outreach',
    description:
      'Draft a personal message to a specific member, for a human to review and send. Use for retention contact with an at-risk member. This drafts only; it never sends.',
    impact: 'medium',
    params: {
      memberId: { type: 'string', description: 'The member id to contact.', required: true },
      subject: { type: 'string', description: 'Subject line.', required: true },
      body: {
        type: 'string',
        description:
          'The message. Warm and specific, referencing what the member actually uses. Never mention a risk score to the member.',
        required: true,
      },
    },
    title: (a) => `Draft outreach to member ${str(a, 'memberId')}: "${str(a, 'subject')}"`,
    execute: (a, store) => {
      const draft: OutreachDraft = {
        id: randomUUID(),
        memberId: str(a, 'memberId'),
        subject: str(a, 'subject'),
        body: str(a, 'body'),
        createdAt: new Date().toISOString(),
      };
      store.outreach.unshift(draft);
      return `Draft saved for member ${draft.memberId}. Nothing has been sent; it is queued for human review.`;
    },
  },

  flag_member_for_review: {
    kind: 'flag_member_for_review',
    description:
      'Flag a member for membership-committee review. Use sparingly, for genuine retention risk that warrants a personal approach from leadership.',
    impact: 'high',
    params: {
      memberId: { type: 'string', description: 'The member id to flag.', required: true },
      reason: { type: 'string', description: 'Why, citing the evidence.', required: true },
    },
    title: (a) => `Flag member ${str(a, 'memberId')} for committee review`,
    execute: (a, store) => {
      const flag: MemberFlag = {
        id: randomUUID(),
        memberId: str(a, 'memberId'),
        reason: str(a, 'reason'),
        createdAt: new Date().toISOString(),
      };
      store.flags.unshift(flag);
      return `Member ${flag.memberId} flagged for review.`;
    },
  },

  schedule_report: {
    kind: 'schedule_report',
    description:
      'Schedule a recurring report to be delivered to named recipients. Use when a manager wants ongoing visibility rather than a one-off answer.',
    impact: 'low',
    params: {
      name: { type: 'string', description: 'Report name.', required: true },
      cadence: { type: 'string', description: 'e.g. "weekly on Monday", "first of the month".', required: true },
      recipients: { type: 'string', description: 'Comma-separated roles or addresses.', required: true },
    },
    title: (a) => `Schedule "${str(a, 'name')}" (${str(a, 'cadence')})`,
    execute: (a, store) => {
      const report: ScheduledReport = {
        id: randomUUID(),
        name: str(a, 'name'),
        cadence: str(a, 'cadence'),
        recipients: str(a, 'recipients'),
        createdAt: new Date().toISOString(),
      };
      store.reports.unshift(report);
      return `"${report.name}" scheduled ${report.cadence} for ${report.recipients}.`;
    },
  },
};

/**
 * Action specs handed to the model.
 *
 * They are described as *proposal* tools, and the runtime intercepts them before anything
 * runs. The model is told the truth about this in the system prompt rather than being
 * tricked, because a model that believes it has executed something will report that it did.
 */
export function actionSpecsForModel(): ToolSpec[] {
  return Object.values(ACTION_DEFINITIONS).map((def) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [name, p] of Object.entries(def.params)) {
      properties[name] = { type: p.type, description: p.description };
      if (p.required) required.push(name);
    }
    return {
      name: `propose_${def.kind}`,
      description: `${def.description} This PROPOSES the action for human confirmation; it does not perform it.`,
      input_schema: { type: 'object' as const, properties, required },
    };
  });
}

export function isActionToolName(name: string): boolean {
  return name.startsWith('propose_');
}

export function actionKindFromToolName(name: string): ActionKind | null {
  const kind = name.replace(/^propose_/, '') as ActionKind;
  return kind in ACTION_DEFINITIONS ? kind : null;
}

export function proposeAction(
  kind: ActionKind,
  args: Record<string, unknown>,
  rationale: string,
): ProposedAction {
  const def = ACTION_DEFINITIONS[kind];
  return {
    id: randomUUID(),
    kind,
    title: def.title(args),
    args,
    rationale,
    impact: def.impact,
    proposedAt: new Date().toISOString(),
  };
}

/** The only path by which an action ever runs. Always records an audit entry. */
export function confirmAction(
  action: ProposedAction,
  actor: string,
  store: SessionStore,
): AuditEntry {
  const result = ACTION_DEFINITIONS[action.kind].execute(action.args, store);
  const entry: AuditEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor,
    originatedByAssistant: true,
    action,
    outcome: 'confirmed',
    result,
  };
  store.audit.unshift(entry);
  return entry;
}

/** Rejections are audited too — knowing what staff decline is how the prompt improves. */
export function rejectAction(
  action: ProposedAction,
  actor: string,
  store: SessionStore,
): AuditEntry {
  const entry: AuditEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor,
    originatedByAssistant: true,
    action,
    outcome: 'rejected',
  };
  store.audit.unshift(entry);
  return entry;
}
