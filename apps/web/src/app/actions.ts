'use server';

import {
  confirmAction,
  proposeAction,
  rejectAction,
  SessionStore,
  type ActionKind,
  type AuditEntry,
  type ProposedAction,
} from '@clubscope/core/assistant';
import { runTurn } from '@/lib/turns';
import type { TurnPayload } from '@/lib/types';

/**
 * Server actions for the assistant surface.
 *
 * ## Why confirmation crosses the wire at all, when nothing persists
 *
 * The audit log on the Ask page lives in React state and dies with the tab, and the UI says
 * so. These functions still run the real `confirmAction` path in core against a `SessionStore`
 * that is created, written to, and discarded inside the call. That is deliberate: the entry
 * a visitor sees — its id, timestamp, actor, assistant-origination flag and result sentence —
 * is produced by the same code a production deployment would run, rather than by a
 * lookalike written for the demo. The only thing thrown away is the persistence.
 *
 * The alternative, hand-writing an audit entry in the browser, would make the most
 * accountability-sensitive surface in the product the one piece of it that was faked.
 */

export async function runTurnAction(turnId: string): Promise<TurnPayload | null> {
  return runTurn(turnId);
}

export async function proposeFromSuggestion(
  kind: ActionKind,
  args: Record<string, unknown>,
  rationale: string,
): Promise<ProposedAction> {
  return proposeAction(kind, args, rationale);
}

export async function confirmProposal(action: ProposedAction): Promise<AuditEntry> {
  return confirmAction(action, 'You', new SessionStore());
}

export async function rejectProposal(action: ProposedAction): Promise<AuditEntry> {
  return rejectAction(action, 'You', new SessionStore());
}
