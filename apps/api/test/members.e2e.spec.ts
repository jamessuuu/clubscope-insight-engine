import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assessChurn, getDataset } from '../src/clubscope-core';
import { closeTestApp, testServer } from './harness';

interface MemberRow {
  id: string;
  name: string;
  memberNo: string;
  email: string;
  status: string;
  category: string;
  risk: { score: number; band: string };
}

describe('GET /members', () => {
  let server: Server;

  beforeAll(async () => {
    server = await testServer();
  });

  afterAll(closeTestApp);

  it('applies sane defaults and reports a total that matches the roll', async () => {
    const res = await request(server).get('/members').expect(200);

    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(25);
    expect(res.body.meta.total).toBe(getDataset().members.length);
    expect(res.body.items).toHaveLength(25);
    expect(res.body.meta.totalPages).toBe(Math.ceil(res.body.meta.total / 25));
  });

  it('pages without overlap or gaps', async () => {
    const first = await request(server).get('/members?page=1&pageSize=10').expect(200);
    const second = await request(server).get('/members?page=2&pageSize=10').expect(200);

    expect(first.body.items).toHaveLength(10);
    expect(second.body.items).toHaveLength(10);

    const firstIds = new Set(first.body.items.map((m: MemberRow) => m.id));
    const overlap = second.body.items.filter((m: MemberRow) => firstIds.has(m.id));
    expect(overlap).toEqual([]);
  });

  it('returns a short final page rather than padding it', async () => {
    const total = getDataset().members.length;
    const pageSize = 100;
    const lastPage = Math.ceil(total / pageSize);
    const res = await request(server)
      .get(`/members?page=${lastPage}&pageSize=${pageSize}`)
      .expect(200);

    expect(res.body.items).toHaveLength(total - (lastPage - 1) * pageSize);
  });

  it('rejects out-of-bounds paging instead of silently clamping it', async () => {
    await request(server).get('/members?page=0').expect(400);
    await request(server).get('/members?pageSize=101').expect(400);
    await request(server).get('/members?pageSize=notanumber').expect(400);
  });

  it('rejects an unknown query parameter, because a silently ignored filter is a wrong answer with a 200 beside it', async () => {
    const res = await request(server).get('/members?statuss=active').expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.path).toContain('/members');
  });

  it('filters by status', async () => {
    const res = await request(server).get('/members?status=resigned&pageSize=100').expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const m of res.body.items as MemberRow[]) expect(m.status).toBe('resigned');
    expect(res.body.meta.total).toBeLessThan(getDataset().members.length);
  });

  it('filters by membership category', async () => {
    const res = await request(server).get('/members?category=social&pageSize=100').expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const m of res.body.items as MemberRow[]) expect(m.category).toBe('social');
  });

  it('treats riskBand as "at or above", so one parameter produces a retention worklist', async () => {
    const res = await request(server).get('/members?riskBand=elevated&pageSize=100').expect(200);
    for (const m of res.body.items as MemberRow[]) {
      expect(['elevated', 'critical']).toContain(m.risk.band);
    }

    const critical = await request(server).get('/members?riskBand=critical&pageSize=100').expect(200);
    expect(critical.body.meta.total).toBeLessThanOrEqual(res.body.meta.total);
  });

  it('combines filters rather than letting the last one win', async () => {
    const res = await request(server)
      .get('/members?status=active&category=full-golf&riskBand=watch&pageSize=100')
      .expect(200);

    for (const m of res.body.items as MemberRow[]) {
      expect(m.status).toBe('active');
      expect(m.category).toBe('full-golf');
      expect(['watch', 'elevated', 'critical']).toContain(m.risk.band);
    }
  });

  it('searches across name, member number and email', async () => {
    const target = getDataset().members[7];
    const res = await request(server)
      .get(`/members?search=${encodeURIComponent(target.lastName)}&pageSize=100`)
      .expect(200);

    expect(res.body.meta.total).toBeGreaterThan(0);
    expect((res.body.items as MemberRow[]).some((m) => m.id === target.id)).toBe(true);

    const byNumber = await request(server)
      .get(`/members?search=${encodeURIComponent(target.memberNo)}`)
      .expect(200);
    expect((byNumber.body.items as MemberRow[]).some((m) => m.id === target.id)).toBe(true);
  });

  it('sorts by risk score, worst first by default', async () => {
    const res = await request(server).get('/members?pageSize=100').expect(200);
    const scores = (res.body.items as MemberRow[]).map((m) => m.risk.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    const asc = await request(server).get('/members?sort=risk&order=asc&pageSize=100').expect(200);
    const ascScores = (asc.body.items as MemberRow[]).map((m) => m.risk.score);
    expect(ascScores).toEqual([...ascScores].sort((a, b) => a - b));
  });

  it('is stable: the same request twice returns the same page in the same order', async () => {
    const [a, b] = await Promise.all([
      request(server).get('/members?page=3&pageSize=25'),
      request(server).get('/members?page=3&pageSize=25'),
    ]);
    expect((a.body.items as MemberRow[]).map((m) => m.id)).toEqual(
      (b.body.items as MemberRow[]).map((m) => m.id),
    );
  });
});

describe('GET /members/:id', () => {
  let server: Server;

  beforeAll(async () => {
    server = await testServer();
  });

  it('returns the profile, the churn assessment and recent activity', async () => {
    const member = getDataset().members[0];
    const res = await request(server).get(`/members/${member.id}`).expect(200);

    expect(res.body.member.id).toBe(member.id);
    expect(res.body.member.name).toBe(`${member.firstName} ${member.lastName}`);

    expect(res.body.churn.memberId).toBe(member.id);
    expect(res.body.churn.score).toBeGreaterThanOrEqual(0);
    expect(res.body.churn.score).toBeLessThanOrEqual(100);
    expect(['low', 'watch', 'elevated', 'critical']).toContain(res.body.churn.band);
    expect(Array.isArray(res.body.churn.contributions)).toBe(true);

    // Every contribution has to be explainable, or the score is not defensible to the
    // member it describes.
    for (const c of res.body.churn.contributions) {
      expect(c.signal).toBeTruthy();
      expect(c.detail).toBeTruthy();
      expect(typeof c.points).toBe('number');
    }

    expect(Array.isArray(res.body.recentVisits)).toBe(true);
    expect(res.body.recentVisits.length).toBeLessThanOrEqual(20);
    expect(res.body.recentTransactions.length).toBeLessThanOrEqual(20);
    expect(res.body.recentNotes.length).toBeLessThanOrEqual(10);
  });

  it('orders recent activity newest first', async () => {
    const member = getDataset().members[3];
    const res = await request(server).get(`/members/${member.id}`).expect(200);

    const times = (res.body.recentVisits as Array<{ at: string }>).map((v) => Date.parse(v.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('404s on an unknown id, in the standard error envelope', async () => {
    const res = await request(server).get('/members/m-does-not-exist').expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(res.body.error).toBe('Not Found');
    expect(String(res.body.message)).toContain('m-does-not-exist');
    expect(res.body.path).toBe('/members/m-does-not-exist');
    expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
  });

  /**
   * Pins the optimisation in `DatasetService.churnTable()`, which scores each member against
   * a dataset view holding only their own rows. That is claimed to be behaviour-preserving;
   * this is the claim being checked rather than asserted, against the unmodified core
   * function run over the whole dataset.
   */
  it('scores identically to assessChurn run over the full dataset', async () => {
    const ds = getDataset();
    for (const member of [ds.members[0], ds.members[42], ds.members[199], ds.members[400]]) {
      const res = await request(server).get(`/members/${member.id}`).expect(200);
      const expected = assessChurn(member, ds);

      expect(res.body.churn.score).toBe(expected.score);
      expect(res.body.churn.band).toBe(expected.band);
      expect(res.body.churn.contributions).toEqual(expected.contributions);
    }
  });
});
