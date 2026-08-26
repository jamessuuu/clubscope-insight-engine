import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TOOL_REGISTRY } from '../src/clubscope-core';
import { closeTestApp, testServer } from './harness';

describe('GET /health', () => {
  let server: Server;

  beforeAll(async () => {
    server = await testServer();
  });

  afterAll(closeTestApp);

  it('reports status, dataset identity and row counts', async () => {
    const res = await request(server).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('@clubscope/api');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);

    const { dataset } = res.body;
    expect(dataset.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(dataset.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataset.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(dataset.from)).toBeLessThan(Date.parse(dataset.to));

    // The reported total has to be the sum of the parts, or the number is decorative.
    const { total, ...collections } = dataset.rows;
    const summed = Object.values(collections).reduce<number>((a, b) => a + Number(b), 0);
    expect(total).toBe(summed);
    expect(collections.members).toBeGreaterThan(0);
  });

  it('reports the tool registry size, so the grounding surface is never a mystery', async () => {
    const res = await request(server).get('/health').expect(200);
    expect(res.body.toolsRegistered).toBe(TOOL_REGISTRY.size);
  });

  it('reports whether a model key is configured without ever exposing it', async () => {
    const res = await request(server).get('/health').expect(200);

    expect(typeof res.body.assistant.modelKeyConfigured).toBe('boolean');
    expect(res.body.assistant.mode).toBe(
      res.body.assistant.modelKeyConfigured ? 'live' : 'replay',
    );

    // The assistant block carries exactly two fields. Pinning the shape is how a key-shaped
    // value gets caught the day somebody "helpfully" adds a masked preview of it.
    expect(Object.keys(res.body.assistant).sort()).toEqual(['mode', 'modelKeyConfigured']);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-ant|api[_-]?key"\s*:\s*"/i);
  });

  it('is deterministic: the fingerprint does not move between requests', async () => {
    const [first, second] = await Promise.all([
      request(server).get('/health'),
      request(server).get('/health'),
    ]);
    expect(first.body.dataset.fingerprint).toBe(second.body.dataset.fingerprint);
  });
});

describe('OpenAPI documentation', () => {
  let server: Server;

  beforeAll(async () => {
    server = await testServer();
  });

  it('serves the Swagger UI at /docs', async () => {
    const res = await request(server).get('/docs').redirects(1).expect(200);
    expect(res.text).toContain('swagger');
  });

  it('publishes the raw document at /docs/json with a tag per module', async () => {
    const res = await request(server).get('/docs/json').expect(200);

    expect(res.body.info.title).toBe('ClubScope Insight Engine API');
    const tags = (res.body.tags as Array<{ name: string }>).map((t) => t.name);
    expect(tags).toEqual(
      expect.arrayContaining([
        'health',
        'club',
        'members',
        'insights',
        'tools',
        'assistant',
        'verification',
      ]),
    );

    // Every documented path must carry a summary. An OpenAPI document with bare operation
    // ids is a document nobody reads.
    for (const [path, methods] of Object.entries(res.body.paths as Record<string, object>)) {
      for (const [method, op] of Object.entries(methods as Record<string, { summary?: string }>)) {
        expect(op.summary, `${method.toUpperCase()} ${path} has no summary`).toBeTruthy();
      }
    }
  });
});
