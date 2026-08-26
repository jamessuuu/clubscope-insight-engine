import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeTestApp, testServer } from './harness';

interface Evidence {
  id: string;
  tool: string;
  toolVersion: string;
  params: Record<string, unknown>;
  value: { kind: string; n: number };
  unit: string;
}

/**
 * The gate, attacked directly.
 *
 * Every case here starts by asking the API for a real Evidence record and then writes a
 * sentence about it — one truthful, one fabricated. That is deliberately the same path a
 * reviewer would take by hand with curl, because a verifier test that constructs its own
 * fixtures can pass while the endpoint a human actually touches is broken.
 */
describe('POST /verify', () => {
  let server: Server;
  let memberCount: Evidence;

  beforeAll(async () => {
    server = await testServer();
    const res = await request(server)
      .post('/tools/member_count/run')
      .send({ params: { status: 'active' } })
      .expect(200);
    memberCount = res.body;
  });

  afterAll(closeTestApp);

  it('verifies a narrative whose figure matches the recomputed value', async () => {
    const truth = memberCount.value.n;
    const res = await request(server)
      .post('/verify')
      .send({
        narrative: `The club currently has [[e:${memberCount.id}|${truth}]] active members.`,
        evidence: [memberCount],
      })
      .expect(200);

    expect(res.body.status).toBe('verified');
    expect(res.body.citedCount).toBe(1);
    expect(res.body.matchedCount).toBe(1);
    expect(res.body.groundedRate).toBe(1);
    expect(res.body.undeclaredCount).toBe(0);
    expect(res.body.recomputedCount).toBe(1);
    expect(res.body.checks[0].outcome).toBe('match');
    expect(res.body.checks[0].actual).toBe(truth);
  });

  it('blocks a fabricated figure and reports what the source actually computes', async () => {
    const truth = memberCount.value.n;
    const fabricated = truth + 137;

    const res = await request(server)
      .post('/verify')
      .send({
        narrative: `The club currently has [[e:${memberCount.id}|${fabricated}]] active members.`,
        evidence: [memberCount],
      })
      .expect(200);

    expect(res.body.status).toBe('blocked');
    expect(res.body.matchedCount).toBe(0);
    expect(res.body.groundedRate).toBe(0);

    const [check] = res.body.checks;
    expect(check.outcome).toBe('mismatch');
    expect(check.written).toBe(String(fabricated));
    expect(check.actual).toBe(truth);
    expect(check.detail).toContain(String(truth));
  });

  it('blocks a figure that carries no citation at all', async () => {
    const res = await request(server)
      .post('/verify')
      .send({
        narrative: 'Dining revenue fell by $48,200 last quarter.',
        evidence: [],
      })
      .expect(200);

    expect(res.body.status).toBe('blocked');
    expect(res.body.undeclaredCount).toBeGreaterThan(0);
    expect(res.body.checks.some((c: { outcome: string }) => c.outcome === 'undeclared')).toBe(true);
  });

  it('blocks a citation to evidence that was never produced', async () => {
    const res = await request(server)
      .post('/verify')
      .send({
        narrative: 'The club has [[e:0123456789abcdef|420]] members.',
        evidence: [],
      })
      .expect(200);

    expect(res.body.status).toBe('blocked');
    expect(res.body.checks[0].outcome).toBe('unknown-evidence');
  });

  it('will not be talked past by a tampered value: recomputation ignores what was submitted', async () => {
    const lie = memberCount.value.n + 500;
    const res = await request(server)
      .post('/verify')
      .send({
        // The evidence payload itself claims the wrong number, and the narrative agrees with
        // it. Both are ignored: the verifier re-runs the tool and compares against that.
        narrative: `The club has [[e:${memberCount.id}|${lie}]] active members.`,
        evidence: [{ ...memberCount, value: { kind: 'scalar', n: lie } }],
      })
      .expect(200);

    expect(res.body.status).toBe('blocked');
    expect(res.body.checks[0].actual).toBe(memberCount.value.n);
  });

  it('refuses to recompute across a tool version change rather than comparing different logic', async () => {
    const res = await request(server)
      .post('/verify')
      .send({
        narrative: `The club has [[e:${memberCount.id}|${memberCount.value.n}]] active members.`,
        evidence: [{ ...memberCount, toolVersion: '99.0.0' }],
      })
      .expect(200);

    expect(res.body.status).toBe('blocked');
    expect(res.body.checks[0].outcome).toBe('recompute-failed');
    expect(res.body.checks[0].detail).toContain('version');
  });

  it('400s on a malformed request body', async () => {
    await request(server).post('/verify').send({ evidence: [] }).expect(400);
    await request(server).post('/verify').send({ narrative: 'x' }).expect(400);
    await request(server)
      .post('/verify')
      .send({ narrative: 'x', evidence: [{ id: 'not-a-hash', tool: 't', toolVersion: '1', params: {} }] })
      .expect(400);
  });
});
