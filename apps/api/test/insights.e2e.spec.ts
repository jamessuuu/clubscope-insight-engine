import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeTestApp, testServer } from './harness';

interface InsightRow {
  id: string;
  kind: string;
  severity: string;
  headline: string;
  narrative: string;
  recommendation: string;
  detector: string;
  detectedAt: string;
  evidence: Array<{ id: string; tool: string; method: string; rowCount: number }>;
  verification: {
    status: string;
    checks: Array<{ outcome: string; written: string; evidenceId?: string }>;
    citedCount: number;
    matchedCount: number;
  };
}

const CITATION_RE = /\[\[e:([a-f0-9]{16})\|([^\]]+)\]\]/g;

describe('GET /insights', () => {
  let server: Server;
  let items: InsightRow[];

  beforeAll(async () => {
    server = await testServer();
    const res = await request(server).get('/insights').expect(200);
    items = res.body.items;
    expect(res.body.total).toBe(items.length);
  });

  afterAll(closeTestApp);

  it('returns a non-empty feed with a fingerprint tying it to the dataset', async () => {
    const res = await request(server).get('/insights').expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.datasetFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(res.body.verified + res.body.blocked).toBe(res.body.total);
  });

  /**
   * The headline guarantee. Every figure in every insight was re-derived from source before
   * the response was built; if one had drifted, this feed would ship a `blocked` item rather
   * than a wrong number, and this assertion is what would catch it in CI.
   */
  it('ships nothing that failed verification', async () => {
    const res = await request(server).get('/insights').expect(200);
    expect(res.body.blocked).toBe(0);

    for (const insight of items) {
      expect(insight.verification.status, `${insight.id} was blocked`).toBe('verified');
      expect(insight.verification.matchedCount).toBe(insight.verification.citedCount);
      for (const check of insight.verification.checks) {
        expect(check.outcome, `${insight.id}: ${check.written}`).toBe('match');
      }
    }
  });

  it('attaches a real receipt to every insight', async () => {
    for (const insight of items) {
      expect(insight.evidence.length).toBeGreaterThan(0);
      expect(insight.detector).toBeTruthy();
      expect(insight.headline).toBeTruthy();
      expect(insight.recommendation).toBeTruthy();
      expect(['critical', 'elevated', 'informational']).toContain(insight.severity);
      expect(['churn', 'revenue', 'utilisation', 'membership', 'engagement']).toContain(
        insight.kind,
      );

      for (const ev of insight.evidence) {
        expect(ev.id).toMatch(/^[a-f0-9]{16}$/);
        expect(ev.method).toBeTruthy();
        expect(ev.rowCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('cites only evidence it also hands to the reader', async () => {
    for (const insight of items) {
      const attached = new Set(insight.evidence.map((e) => e.id));
      for (const match of insight.narrative.matchAll(CITATION_RE)) {
        expect(attached.has(match[1]), `${insight.id} cites ${match[1]} without attaching it`).toBe(
          true,
        );
      }
    }
  });

  it('is ordered severity-first, so the feed leads with what matters', async () => {
    const rank: Record<string, number> = { critical: 0, elevated: 1, informational: 2 };
    const ranks = items.map((i) => rank[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('is deterministic across requests', async () => {
    const [a, b] = await Promise.all([
      request(server).get('/insights'),
      request(server).get('/insights'),
    ]);
    expect((a.body.items as InsightRow[]).map((i) => i.id)).toEqual(
      (b.body.items as InsightRow[]).map((i) => i.id),
    );
  });
});
