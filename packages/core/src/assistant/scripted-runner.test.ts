import { describe, expect, it } from 'vitest';
import { getDataset } from '../data/index.js';
import { TOOL_REGISTRY } from '../tools/index.js';
import type { Unit } from '../tools/evidence.js';
import { parseFigure, roundsTo } from '../verify/numbers.js';
import { defaultFormatFor, formatFigure, runScriptedTurn } from './scripted-runner.js';
import type { FigureFormat, ScriptedTurn } from './scripted.js';
import { getTurn, SCRIPTED_TURNS, SUGGESTED_TURNS } from './turns.js';

/**
 * ## What this suite is actually asserting
 *
 * One claim, mostly: **every scripted answer the demo can produce is grounded in a
 * recomputation of the dataset, and the one that is not is caught.** That is a stronger and
 * more useful guarantee than snapshotting the prose, because it survives the tools changing.
 * If someone edits `revenue_total` tomorrow and a figure moves, the narratives move with it
 * and these tests still pass; if someone edits it so that a figure and its receipt disagree,
 * they fail. Snapshot tests get exactly this backwards — they fail on harmless rewording and
 * pass on a broken grounding contract.
 *
 * The library is looped over rather than sampled deliberately. A turn that only verifies on
 * the developer's machine, or only for the six questions someone remembered to test, is not a
 * reliability claim anyone should repeat on a page.
 */

const dataset = getDataset();
const run = (turn: ScriptedTurn) => runScriptedTurn({ turn, dataset, tools: TOOL_REGISTRY });

/**
 * One execution per turn, shared by every assertion that only reads the result.
 *
 * A turn touches ~120,000 rows across its tool calls and then the verifier re-runs all of
 * them, so re-executing the library once per assertion turns a fast suite into a slow one
 * for no additional signal — the runs are pure and identical by construction, which the
 * determinism block below proves separately with deliberately uncached runs.
 */
const cache = new Map<string, ReturnType<typeof run>>();
const resultFor = (turn: ScriptedTurn) => {
  const hit = cache.get(turn.id);
  if (hit) return hit;
  const fresh = run(turn);
  cache.set(turn.id, fresh);
  return fresh;
};

const POISONED = SCRIPTED_TURNS.filter((t) => t.poison !== undefined);
const CLEAN = SCRIPTED_TURNS.filter((t) => t.poison === undefined);

describe('the scripted turn library', () => {
  it('holds at least twelve turns covering distinct topics', () => {
    expect(SCRIPTED_TURNS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SCRIPTED_TURNS.map((t) => t.topic)).size).toBeGreaterThanOrEqual(5);
  });

  it('exposes every turn by id, and nothing else', () => {
    for (const turn of SCRIPTED_TURNS) expect(getTurn(turn.id)).toBe(turn);
    expect(getTurn('no-such-turn')).toBeUndefined();
  });

  it('offers suggested turns as a subset of the library', () => {
    expect(SUGGESTED_TURNS.length).toBeGreaterThan(0);
    for (const turn of SUGGESTED_TURNS) {
      expect(turn.suggested).toBe(true);
      expect(SCRIPTED_TURNS).toContain(turn);
    }
  });

  it('carries no literal figure in any template', () => {
    // The load-bearing invariant of the whole file: a turn cannot state a number, only ask
    // for one. Two exceptions, both of which name a point in time rather than assert a
    // measurement — a bare year and a clock hour. Anything else would be a quantity the
    // reader has no receipt for, and the verifier would block the narrative for it anyway.
    for (const turn of SCRIPTED_TURNS) {
      const prose = turn.template
        .replace(/\{\{[^}]+\}\}/g, ' ')
        .replace(/\b\d{1,2}(?:am|pm)\b/g, ' ');
      // Decimals are part of a numeral; a sentence-ending period is not.
      const numerals = [...prose.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]);
      const notAYear = numerals.filter((n) => !/^(19|20)\d{2}$/.test(n));
      expect(notAYear, `literal figure in template "${turn.id}"`).toEqual([]);
    }
  });

  it('runs every turn against the real dataset without throwing', () => {
    for (const turn of SCRIPTED_TURNS) {
      expect(() => run(turn), `turn "${turn.id}" threw`).not.toThrow();
    }
  });

  it('proposes only actions that carry the arguments they need', () => {
    for (const turn of SCRIPTED_TURNS) {
      for (const action of resultFor(turn).proposedActions) {
        expect(action.id).toMatch(/[0-9a-f-]{36}/);
        expect(action.title.length).toBeGreaterThan(0);
        expect(action.rationale.length).toBeGreaterThan(0);
        expect(Date.parse(action.proposedAt)).not.toBeNaN();
      }
    }
    // At least one turn of each shape the brief calls for, so a refactor cannot quietly drop
    // the acting half of the demo.
    const kinds = new Set(SCRIPTED_TURNS.flatMap((t) => (t.proposes ?? []).map((p) => p.kind)));
    expect(kinds).toContain('create_task');
    expect(kinds).toContain('draft_member_outreach');
  });
});

describe('grounding', () => {
  /**
   * The headline guarantee, asserted across the whole library rather than on a sample.
   *
   * Every figure in every non-poisoned answer is re-derived from the dataset by the verifier
   * and has to agree with what the prose says — and no figure may appear uncited. If this
   * passes, "the scripted answers are grounded" is a measured statement about all of them.
   */
  it('verifies every non-poisoned turn', () => {
    const failures: string[] = [];

    for (const turn of CLEAN) {
      const result = resultFor(turn);
      if (result.status !== 'answered' || result.verification.status !== 'verified') {
        const why = result.verification.checks
          .filter((c) => c.outcome !== 'match')
          .map((c) => `${c.outcome} on "${c.written}"${c.detail ? ` (${c.detail})` : ''}`)
          .join('; ');
        failures.push(`${turn.id}: ${why}`);
      }
    }

    expect(failures).toEqual([]);
    expect(CLEAN.length).toBe(SCRIPTED_TURNS.length - POISONED.length);
  });

  it('reports honest replay metadata on every turn', () => {
    for (const turn of SCRIPTED_TURNS) {
      const result = resultFor(turn);
      expect(result.servedBy).toBe('replay');
      // Replay costs no tokens. Inventing a plausible count here would corrupt the only
      // place the eval suite reports cost.
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(result.repaired).toBe(false);
      expect(result.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.toolCalls).toHaveLength(turn.calls.length);
      for (const call of result.toolCalls) {
        expect(call.ok).toBe(true);
        expect(call.evidenceId).toBeDefined();
        expect(call.ms).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('cites every figure it renders, and renders every figure it cites', () => {
    for (const turn of CLEAN) {
      const result = resultFor(turn);
      const cited = result.segments.filter((s) => s.kind === 'figure');
      expect(result.verification.citedCount).toBe(cited.length);
      expect(result.verification.undeclaredCount).toBe(0);
      for (const segment of cited) {
        if (segment.kind !== 'figure') continue;
        // Every chip resolves to evidence carried on the turn, so the receipt drawer can
        // never open on nothing.
        expect(result.evidence.some((e) => e.id === segment.evidenceId)).toBe(true);
      }
    }
  });

  it('reflects the tool result in the prose, not a value carried alongside it', () => {
    // Proves the figure comes from the tool on this request rather than from the fixture: a
    // fresh run of the same tool with the same params must produce what the narrative says.
    for (const turn of CLEAN) {
      const result = resultFor(turn);
      for (const check of result.verification.checks) {
        if (check.actual === undefined) continue;
        const figure = parseFigure(check.written);
        expect(figure, `unparseable citation "${check.written}" in ${turn.id}`).not.toBeNull();
        expect(roundsTo(figure!, check.actual)).toBe(true);
      }
    }
  });
});

describe('refusals', () => {
  const refusals = SCRIPTED_TURNS.filter((t) => t.refusal === true);

  it('includes a refusal for out-of-coverage dates and one for data the club does not hold', () => {
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    // Both must consult coverage rather than declining on a hunch. A refusal that is not
    // itself grounded is just a disclaimer, and users learn to route around those.
    for (const turn of refusals) {
      expect(turn.calls.some((c) => c.tool === 'data_coverage')).toBe(true);
    }
  });

  it('produces no cited figure and invents nothing', () => {
    for (const turn of refusals) {
      const result = resultFor(turn);
      expect(result.status).toBe('answered');
      expect(result.verification.citedCount).toBe(0);
      expect(result.verification.undeclaredCount).toBe(0);
      expect(result.segments.every((s) => s.kind === 'text')).toBe(true);
      expect(result.raw).not.toContain('[[e:');
      expect(result.raw.length).toBeGreaterThan(0);
    }
  });
});

describe('the poisoned turn', () => {
  it('is exactly one, and is never offered as a starter question', () => {
    expect(POISONED).toHaveLength(1);
    expect(POISONED[0].suggested).toBe(false);
  });

  it('is blocked, with the true tool value reported beside the fabricated one', () => {
    const turn = POISONED[0];
    const result = resultFor(turn);

    expect(result.status).toBe('blocked');
    expect(result.verification.status).toBe('blocked');

    const mismatches = result.verification.checks.filter((c) => c.outcome === 'mismatch');
    expect(mismatches).toHaveLength(1);
    const [mismatch] = mismatches;

    // The verifier's `actual` is what the tool computes now, from source.
    const call = turn.calls.find((c) => c.key === turn.poison?.key)!;
    const truth = TOOL_REGISTRY.get(call.tool)!.run(call.params as never, dataset);
    expect(truth.value.kind).toBe('scalar');
    expect(mismatch.actual).toBe(truth.value.kind === 'scalar' ? truth.value.n : NaN);

    // The citation still points at the real evidence record. That is the point of the
    // demonstration: the failure is not a broken link the UI could spot, it is a true
    // receipt attached to a false number — which is exactly how this fails in production.
    expect(mismatch.evidenceId).toBe(truth.id);
    expect(result.evidence.some((e) => e.id === truth.id)).toBe(true);

    // And the fabrication is genuinely outside what the written precision could excuse.
    const written = parseFigure(mismatch.written)!;
    expect(roundsTo(written, mismatch.actual!)).toBe(false);

    // One bad claim, not a wholesale failure: the untouched figure still passes, so the
    // groundedness rate on the Reliability page is a real measurement.
    expect(result.verification.checks.filter((c) => c.outcome === 'match')).toHaveLength(1);
    expect(result.verification.groundedRate).toBeCloseTo(0.5);
  });
});

describe('determinism', () => {
  /**
   * Replay's second job, after "the demo works without a network": an eval suite scored
   * against a moving target measures sampling noise, not regression. These turns have to be
   * byte-identical run to run for a failing eval case to mean the code changed.
   */
  it('produces identical narrative, evidence ids and verdict on a repeat run', () => {
    for (const turn of SCRIPTED_TURNS) {
      const first = run(turn);
      const second = run(turn);

      expect(second.raw).toBe(first.raw);
      expect(second.status).toBe(first.status);
      expect(second.verification.status).toBe(first.verification.status);
      expect(second.evidence.map((e) => e.id)).toEqual(first.evidence.map((e) => e.id));
      expect(second.segments).toEqual(first.segments);
      expect(second.verification.checks.map((c) => [c.written, c.outcome, c.actual])).toEqual(
        first.verification.checks.map((c) => [c.written, c.outcome, c.actual]),
      );
    }
  });

  it('does not let a proposed action leak between runs', () => {
    // Proposals carry a fresh id and timestamp each time, because each is a distinct thing a
    // human is being asked to approve. Everything a reviewer reads must still be identical.
    const turn = SCRIPTED_TURNS.find((t) => (t.proposes?.length ?? 0) > 0)!;
    const [first] = run(turn).proposedActions;
    const [second] = run(turn).proposedActions;

    expect(second.id).not.toBe(first.id);
    expect(second.kind).toBe(first.kind);
    expect(second.title).toBe(first.title);
    expect(second.args).toEqual(first.args);
  });
});

describe('formatFigure', () => {
  /**
   * The formatter's only real contract: whatever it writes, the verifier must be able to
   * parse it and accept the true value against it. Every case below is asserted that way
   * rather than by string equality alone, because string equality would let a "correct
   * looking" output that the gate rejects slip through — and a figure the gate rejects
   * blocks the entire narrative it appears in.
   */
  const roundTrips = (written: string, truth: number) => {
    const parsed = parseFigure(written);
    expect(parsed, `verifier cannot parse "${written}"`).not.toBeNull();
    expect(roundsTo(parsed!, truth), `"${written}" does not round-trip to ${truth}`).toBe(true);
  };

  const cases: Array<{ value: number; unit: Unit; format: FigureFormat; expected: string }> = [
    { value: 381204, unit: 'usd', format: 'usd', expected: '$381,204' },
    { value: 847, unit: 'usd', format: 'usd', expected: '$847' },
    { value: 5537.22, unit: 'usd', format: 'usd', expected: '$5,537' },
    { value: -12480, unit: 'usd', format: 'usd', expected: '-$12,480' },

    { value: 381204, unit: 'usd', format: 'usdCompact', expected: '$381k' },
    { value: 1241880, unit: 'usd', format: 'usdCompact', expected: '$1.2M' },
    { value: 4941004, unit: 'usd', format: 'usdCompact', expected: '$4.9M' },
    { value: 999600, unit: 'usd', format: 'usdCompact', expected: '$1.0M' },
    { value: 847, unit: 'usd', format: 'usdCompact', expected: '$847' },
    { value: 2_400_000_000, unit: 'usd', format: 'usdCompact', expected: '$2.4B' },
    { value: -577638, unit: 'usd', format: 'usdCompact', expected: '-$578k' },

    { value: 22.34, unit: 'percent', format: 'percent', expected: '22%' },
    { value: 86.9, unit: 'percent', format: 'percent', expected: '87%' },
    { value: 70.97, unit: 'percent', format: 'percent', expected: '71%' },
    { value: -21.6, unit: 'percent', format: 'percent', expected: '-22%' },

    { value: -22.13, unit: 'percent', format: 'percentSigned', expected: '-22.1%' },
    { value: -25.81, unit: 'percent', format: 'percentSigned', expected: '-25.8%' },
    { value: 23.51, unit: 'percent', format: 'percentSigned', expected: '23.5%' },

    { value: 47, unit: 'count', format: 'count', expected: '47' },
    { value: 2326, unit: 'count', format: 'count', expected: '2,326' },
    { value: 0, unit: 'count', format: 'count', expected: '0' },

    { value: 73, unit: 'score', format: 'score', expected: '73' },
    { value: 100, unit: 'score', format: 'score', expected: '100' },

    { value: 577638, unit: 'usd', format: 'raw', expected: '$577638' },
    { value: 5537.22, unit: 'usd', format: 'raw', expected: '$5537.22' },
    { value: 86.81, unit: 'percent', format: 'raw', expected: '86.81%' },
    { value: -1.05, unit: 'percent', format: 'raw', expected: '-1.05%' },
    { value: 12.5, unit: 'days', format: 'raw', expected: '12.5' },
  ];

  for (const { value, unit, format, expected } of cases) {
    it(`renders ${value} as ${format} → ${expected}, and it round-trips`, () => {
      const written = formatFigure(value, unit, format);
      expect(written).toBe(expected);
      roundTrips(written, value);
    });
  }

  it('never writes a leading plus, which the verifier cannot parse', () => {
    // Worth pinning: "+8%" reads better and fails closed as an unsupported shape, taking the
    // whole narrative down with it. The direction belongs in the prose.
    for (const value of [0.4, 8.2, 23.51, 99]) {
      for (const format of ['percent', 'percentSigned'] as const) {
        const written = formatFigure(value, 'percent', format);
        expect(written.startsWith('+')).toBe(false);
        roundTrips(written, value);
      }
    }
  });

  it('never drops a sign, which would turn a decline into a fabrication', () => {
    for (const value of [-0.9, -12.4, -25.81, -99.5]) {
      for (const format of ['percent', 'percentSigned'] as const) {
        const written = formatFigure(value, 'percent', format);
        // The one exception: a value that legitimately rounds to zero is written "0%", and
        // "-0%" would be nonsense. It still has to round-trip, and it does.
        if (!written.startsWith('0')) expect(written.startsWith('-')).toBe(true);
        roundTrips(written, value);
      }
    }
  });

  it('round-trips every format against a spread of real-shaped values', () => {
    const formats: FigureFormat[] = [
      'usd',
      'usdCompact',
      'percent',
      'percentSigned',
      'count',
      'score',
      'raw',
    ];
    const values = [0, 1, 47, 99.5, 284519, 577638, 4941004, 1241880, -25.81, -577638];

    for (const format of formats) {
      for (const value of values) {
        const unit: Unit = format.startsWith('percent')
          ? 'percent'
          : format.startsWith('usd')
            ? 'usd'
            : 'count';
        roundTrips(formatFigure(value, unit, format), value);
      }
    }
  });

  it('picks a sensible default format from the evidence unit', () => {
    expect(defaultFormatFor('usd')).toBe('usd');
    expect(defaultFormatFor('percent')).toBe('percent');
    expect(defaultFormatFor('count')).toBe('count');
    expect(defaultFormatFor('score')).toBe('score');
    // No house style for these, so the number is reported exactly as computed rather than
    // rounded by a convention the reader has no way to check.
    expect(defaultFormatFor('days')).toBe('raw');
    expect(defaultFormatFor('ratio')).toBe('raw');
    expect(defaultFormatFor('none')).toBe('raw');
  });
});

describe('authoring mistakes fail loudly', () => {
  /**
   * A scripted turn is a fixture, not a conversation: there is no model to hand an error
   * back to. So the runner throws with the turn id in the message rather than degrading into
   * a thinner answer, and these cases pin that behaviour — a silent degradation in a demo is
   * how a reviewer ends up quoting a figure that was never there.
   */
  const base = getTurn('member-deep-dive')!;

  it('rejects a placeholder with no matching call', () => {
    const turn: ScriptedTurn = { ...base, id: 'broken-key', template: 'Score is {{nope}}.' };
    expect(() => run(turn)).toThrow(/broken-key.*\{\{nope\}\}/s);
  });

  it('rejects citing a series or table, which the verifier could never recompute', () => {
    const turn: ScriptedTurn = {
      ...base,
      id: 'broken-shape',
      calls: [{ key: 'mix', tool: 'revenue_by_category', params: { from: '2025-09-01', to: '2026-08-31' } }],
      template: 'The mix is {{mix}}.',
    };
    expect(() => run(turn)).toThrow(/only scalar evidence/);
  });

  it('rejects an unknown figure format', () => {
    const turn: ScriptedTurn = { ...base, id: 'broken-format', template: '{{score|dollars}}' };
    expect(() => run(turn)).toThrow(/unknown figure format "dollars"/);
  });

  it('rejects a tool that is not in the registry', () => {
    const turn: ScriptedTurn = {
      ...base,
      id: 'broken-tool',
      calls: [{ key: 'x', tool: 'revenue_by_vibes', params: {} }],
      template: 'nothing to see here',
    };
    expect(() => run(turn)).toThrow(/not in the registry/);
  });

  it('rejects arguments the tool refuses, rather than answering around them', () => {
    const turn: ScriptedTurn = {
      ...base,
      id: 'broken-params',
      calls: [{ key: 'score', tool: 'member_churn_score', params: { memberId: 'm-9999' } }],
      template: 'Score is {{score}}.',
    };
    expect(() => run(turn)).toThrow(/no member with id/);
  });

  it('rejects poison aimed at a key no call produces', () => {
    // Otherwise the one page built to demonstrate the gate failing would quietly show a
    // perfectly verified answer.
    const turn: ScriptedTurn = { ...base, id: 'broken-poison', poison: { key: 'ghost', multiplier: 2 } };
    expect(() => run(turn)).toThrow(/poison targets key "ghost"/);
  });
});
