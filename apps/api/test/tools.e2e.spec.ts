import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDataset, TOOL_REGISTRY } from '../src/clubscope-core';
import { closeTestApp, testServer } from './harness';

interface CatalogueEntry {
  name: string;
  version: string;
  kind: string;
  description: string;
  params: Array<{ name: string; type: string; required: boolean; description: string }>;
  resultUnit: string | null;
  resultKind: string | null;
  exampleParams: Record<string, unknown> | null;
}

const UNITS = ['usd', 'count', 'percent', 'days', 'minutes', 'score', 'ratio', 'none'];

describe('GET /tools', () => {
  let server: Server;

  beforeAll(async () => {
    server = await testServer();
  });

  afterAll(closeTestApp);

  it('publishes the whole registry and nothing else', async () => {
    const res = await request(server).get('/tools').expect(200);

    expect(res.body.count).toBe(TOOL_REGISTRY.size);
    expect(res.body.tools).toHaveLength(TOOL_REGISTRY.size);

    const published = (res.body.tools as CatalogueEntry[]).map((t) => t.name).sort();
    expect(published).toEqual([...TOOL_REGISTRY.keys()].sort());
  });

  it('describes every parameter of every tool', async () => {
    const res = await request(server).get('/tools').expect(200);

    for (const entry of res.body.tools as CatalogueEntry[]) {
      const tool = TOOL_REGISTRY.get(entry.name);
      expect(tool).toBeDefined();
      expect(entry.version).toBe(tool!.version);
      expect(entry.kind).toBe(tool!.kind);
      expect(entry.description).toBe(tool!.description);

      expect(entry.params.map((p) => p.name).sort()).toEqual(Object.keys(tool!.params).sort());
      for (const param of entry.params) {
        expect(param.description).toBeTruthy();
        expect(['string', 'number', 'boolean', 'enum']).toContain(param.type);
      }
    }
  });

  /**
   * The catalogue advertises a runnable example for each tool. If one of those examples did
   * not actually run, the endpoint that exists to make the grounding layer inspectable would
   * be handing reviewers something that 400s.
   */
  it('advertises example parameters that genuinely execute', async () => {
    const res = await request(server).get('/tools').expect(200);
    const entries = res.body.tools as CatalogueEntry[];

    expect(entries.every((e) => e.exampleParams !== null)).toBe(true);

    for (const entry of entries) {
      const run = await request(server)
        .post(`/tools/${entry.name}/run`)
        .send({ params: entry.exampleParams })
        .expect(200);

      expect(run.body.tool).toBe(entry.name);
      expect(run.body.unit).toBe(entry.resultUnit);
      expect(run.body.value.kind).toBe(entry.resultKind);
    }
  });
});

describe('POST /tools/:name/run', () => {
  let server: Server;

  beforeAll(async () => {
    server = await testServer();
  });

  it('returns a well-formed Evidence record', async () => {
    const ds = getDataset();
    const res = await request(server)
      .post('/tools/revenue_total/run')
      .send({ params: { from: ds.club.dataFrom, to: ds.club.dataTo, category: 'dues' } })
      .expect(200);

    const evidence = res.body;
    expect(evidence.id).toMatch(/^[a-f0-9]{16}$/);
    expect(evidence.tool).toBe('revenue_total');
    expect(evidence.toolVersion).toBe(TOOL_REGISTRY.get('revenue_total')!.version);
    expect(evidence.params).toEqual({
      from: ds.club.dataFrom,
      to: ds.club.dataTo,
      category: 'dues',
    });
    expect(evidence.value.kind).toBe('scalar');
    expect(evidence.value.n).toBeGreaterThan(0);
    expect(UNITS).toContain(evidence.unit);
    expect(evidence.method).toBeTruthy();
    expect(Array.isArray(evidence.rowIds)).toBe(true);

    // The stored row list is capped for legibility; the count never is. A receipt may be
    // abbreviated but must not understate its own scope.
    expect(evidence.rowIds.length).toBeLessThanOrEqual(500);
    expect(evidence.rowCount).toBeGreaterThanOrEqual(evidence.rowIds.length);
    expect(() => new Date(evidence.computedAt).toISOString()).not.toThrow();
  });

  it('produces the same evidence id for the same question asked twice', async () => {
    const body = { params: { status: 'active' } };
    const [a, b] = await Promise.all([
      request(server).post('/tools/member_count/run').send(body),
      request(server).post('/tools/member_count/run').send(body),
    ]);

    expect(a.body.id).toBe(b.body.id);
    expect(a.body.value.n).toBe(b.body.value.n);
  });

  it('400s on an unparseable date, carrying the tool’s own message', async () => {
    const res = await request(server)
      .post('/tools/revenue_total/run')
      .send({ params: { from: 'last-tuesday', to: '2026-08-31' } })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(String(res.body.message)).toMatch(/from/i);
  });

  it('400s on a value outside a tool’s enum', async () => {
    await request(server)
      .post('/tools/member_count/run')
      .send({ params: { status: 'lapsed' } })
      .expect(400);
  });

  it('400s when a required argument is missing', async () => {
    await request(server).post('/tools/revenue_total/run').send({ params: {} }).expect(400);
  });

  it('400s on an unknown body property rather than ignoring it', async () => {
    await request(server)
      .post('/tools/member_count/run')
      .send({ params: {}, pleaseIgnoreMe: true })
      .expect(400);
  });

  it('404s on a tool that is not registered', async () => {
    const res = await request(server)
      .post('/tools/predict_the_future/run')
      .send({ params: {} })
      .expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(String(res.body.message)).toContain('predict_the_future');
  });
});
