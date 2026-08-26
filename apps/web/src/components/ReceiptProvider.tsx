'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Evidence } from '@/lib/types';
import { ReceiptDrawer } from './ReceiptDrawer';

interface ReceiptApi {
  open: (evidenceId: string) => void;
  has: (evidenceId: string) => boolean;
  /** Adds evidence that arrived after first render, e.g. from an assistant turn. */
  register: (evidence: readonly Evidence[]) => void;
}

const ReceiptContext = createContext<ReceiptApi | null>(null);

/**
 * Every page mounts its own evidence store.
 *
 * Session-wide state would have been less code, but the figures a page can vouch for are
 * exactly the ones it computed, and a chip that opened a drawer populated from another
 * page's evidence would be showing working it never did. Scoping the store to the page keeps
 * "this number can prove itself" literally true rather than approximately true.
 */
export function ReceiptProvider({
  evidence,
  children,
}: {
  evidence: readonly Evidence[];
  children: ReactNode;
}) {
  const [dynamic, setDynamic] = useState<Evidence[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const index = useMemo(() => {
    const map = new Map<string, Evidence>();
    for (const e of evidence) map.set(e.id, e);
    for (const e of dynamic) map.set(e.id, e);
    return map;
  }, [evidence, dynamic]);

  const register = useCallback((next: readonly Evidence[]) => {
    setDynamic((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const additions = next.filter((e) => !seen.has(e.id));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
  }, []);

  const api = useMemo<ReceiptApi>(
    () => ({
      open: (evidenceId: string) => setOpenId(evidenceId),
      has: (evidenceId: string) => index.has(evidenceId),
      register,
    }),
    [index, register],
  );

  return (
    <ReceiptContext.Provider value={api}>
      {children}
      <ReceiptDrawer
        evidence={openId === null ? null : (index.get(openId) ?? null)}
        onClose={() => setOpenId(null)}
      />
    </ReceiptContext.Provider>
  );
}

export function useReceipts(): ReceiptApi {
  const ctx = useContext(ReceiptContext);
  if (!ctx) {
    throw new Error('useReceipts must be used inside a <ReceiptProvider>');
  }
  return ctx;
}
