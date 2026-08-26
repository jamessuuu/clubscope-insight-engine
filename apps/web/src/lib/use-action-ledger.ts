'use client';

import { useCallback, useState } from 'react';
import { confirmProposal, proposeFromSuggestion, rejectProposal } from '@/app/actions';
import type { ActionState } from '@/components/ActionCard';
import type { AuditEntry, ProposedAction, SuggestedAction } from './types';

/**
 * Propose, confirm, reject, record.
 *
 * State is React state and nothing else. That is a real limitation of a demo without a
 * backing store, and the pages say so in plain words rather than implying a durable log.
 * What is not faked is the shape: proposals and audit entries are built by core's own action
 * definitions on the server, so what a visitor sees is the artefact a production deployment
 * would write, minus the writing.
 */
export function useActionLedger() {
  const [proposals, setProposals] = useState<ProposedAction[]>([]);
  const [states, setStates] = useState<Record<string, ActionState>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const addProposals = useCallback((incoming: readonly ProposedAction[]) => {
    if (incoming.length === 0) return;
    setProposals((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const next = incoming.filter((p) => !seen.has(p.id));
      return next.length === 0 ? prev : [...prev, ...next];
    });
  }, []);

  const proposeSuggestion = useCallback(
    async (suggestion: SuggestedAction, rationale: string) => {
      const action = await proposeFromSuggestion(
        suggestion.kind,
        suggestion.args,
        rationale,
      );
      setProposals((prev) => [...prev, action]);
      return action;
    },
    [],
  );

  const confirm = useCallback(async (action: ProposedAction) => {
    setBusyId(action.id);
    try {
      const entry = await confirmProposal(action);
      setStates((prev) => ({ ...prev, [action.id]: 'confirmed' }));
      setAudit((prev) => [entry, ...prev]);
    } finally {
      setBusyId(null);
    }
  }, []);

  const reject = useCallback(async (action: ProposedAction) => {
    setBusyId(action.id);
    try {
      const entry = await rejectProposal(action);
      setStates((prev) => ({ ...prev, [action.id]: 'rejected' }));
      setAudit((prev) => [entry, ...prev]);
    } finally {
      setBusyId(null);
    }
  }, []);

  const reset = useCallback(() => {
    setProposals([]);
    setStates({});
  }, []);

  return {
    proposals,
    states,
    audit,
    busyId,
    addProposals,
    proposeSuggestion,
    confirm,
    reject,
    reset,
    stateOf: (id: string): ActionState => states[id] ?? 'pending',
  };
}
