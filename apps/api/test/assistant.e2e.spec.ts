import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeTestApp, testServer } from './harness';

interface TurnSummary {
  id: string;
  question: string;
  topic: string;
  suggested: boolean;
  refusal: boolean;
  poisoned: boolean;
  tools: string[];
}

describe('GET /assistant/turns', () => {
  let server: Server;
  let turns: TurnSummary[];

  beforeAll(async () => {
    server = await testServer();
    const res = await request(server).get('/assistant/turns').expect(200);
    turns = res.body.turns;
    expect(res.body.count).toBe(turns.length);
  });

  afterAll(closeTestApp);

  it('publishes a question library including the refusals', async () => {
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn.id).toBeTruthy();
      expect(turn.question).toBeTruthy();
      expect(turn.topic).toBeTruthy();
      expect(Array.isArray(turn.tools)).toBe(true);
    }

    // A library with no refusals in it would be a library that cannot demonstrate the most
    // important behaviour the assistant has.
    expect(turns.some((t) => t.refusal)).toBe(true);
  });

  it('reports replay mode when no model key is configured', async () => {
    const res = await request(server).get('/assistant/turns').expect(200);
    const expected = (process.env.ANTHROPIC_API_KEY ?? '').trim() === '' ? 'replay' : 'live';
    expect(res.body.mode).toBe(expected);
  });
});

describe('POST /assistant/ask', () => {
  let server: Server;
  let turns: TurnSummary[];

  beforeAll(async () => {
    server = await testServer();
    turns = (await request(server).get('/assistant/turns').expect(200)).body.turns;
  });

  it('answers every honest turn with a verified, cited narrative', async () => {
    const honest = turns.filter((t) => !t.poisoned);
    expect(honest.length).toBeGreaterThan(0);

    for (const turn of honest) {
      const res = await request(server)
        .post('/assistant/ask')
        .send({ turnId: turn.id })
        .expect(200);

      expect(res.body.status, `${turn.id} was blocked`).toBe('answered');
      expect(res.body.verification.status).toBe('verified');
      expect(res.body.servedBy).toBe('replay');
      expect(res.body.raw).toBeTruthy();
      expect(Array.isArray(res.body.segments)).toBe(true);

      // Every evidence id the narrative cites must appear in the evidence it returns, or
      // the receipt drawer would open on nothing.
      const attached = new Set((res.body.evidence as Array<{ id: string }>).map((e) => e.id));
      for (const segment of res.body.segments as Array<{ kind: string; evidenceId?: string }>) {
        if (segment.kind === 'figure') expect(attached.has(segment.evidenceId!)).toBe(true);
      }
    }
  });

  it('blocks the poisoned turn, which is the whole point of having one', async () => {
    const poisoned = turns.filter((t) => t.poisoned);
    for (const turn of poisoned) {
      const res = await request(server)
        .post('/assistant/ask')
        .send({ turnId: turn.id })
        .expect(200);

      expect(res.body.status).toBe('blocked');
      expect(res.body.verification.status).toBe('blocked');
      expect(
        (res.body.verification.checks as Array<{ outcome: string }>).some(
          (c) => c.outcome !== 'match',
        ),
      ).toBe(true);
    }
  });

  it('proposes actions without executing them', async () => {
    const acting = turns.find((t) => !t.poisoned);
    const res = await request(server)
      .post('/assistant/ask')
      .send({ turnId: acting!.id })
      .expect(200);

    for (const action of res.body.proposedActions as Array<Record<string, unknown>>) {
      expect(action.id).toBeTruthy();
      expect(action.title).toBeTruthy();
      expect(action.rationale).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(action.impact);
      // Nothing here has run: a proposal carries no result and no confirmation.
      expect(action).not.toHaveProperty('result');
      expect(action).not.toHaveProperty('confirmedAt');
    }
  });

  it('404s on an unknown turn id', async () => {
    const res = await request(server)
      .post('/assistant/ask')
      .send({ turnId: 'no-such-turn' })
      .expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(String(res.body.message)).toContain('no-such-turn');
  });

  it('400s on a malformed body', async () => {
    await request(server).post('/assistant/ask').send({}).expect(400);
    await request(server).post('/assistant/ask').send({ turnId: '' }).expect(400);
    await request(server)
      .post('/assistant/ask')
      .send({ turnId: 'dining-decline', extra: 1 })
      .expect(400);
  });
});

describe('GET /club', () => {
  let server: Server;

  beforeAll(async () => {
    server = await testServer();
  });

  it('states the coverage bounds the assistant must refuse outside of', async () => {
    const res = await request(server).get('/club').expect(200);

    expect(res.body.club.name).toBeTruthy();
    expect(res.body.coverage.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.coverage.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.coverage.days).toBeGreaterThan(0);
    expect(res.body.coverage.months[0]).toBe(res.body.coverage.from.slice(0, 7));
    expect(res.body.coverage.months.at(-1)).toBe(res.body.coverage.to.slice(0, 7));

    const byCategory = res.body.byCategory as Array<{ key: string; count: number }>;
    const summed = byCategory.reduce((a, b) => a + b.count, 0);
    expect(summed).toBe(res.body.coverage.rows.members);
  });
});
