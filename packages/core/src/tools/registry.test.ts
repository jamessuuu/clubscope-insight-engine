import { describe, expect, it } from 'vitest';
import type { Evidence } from './evidence.js';
import { scalarOf } from './evidence.js';
import { verifyNarrative } from '../verify/verifier.js';
import { TOOL_REGISTRY, getTool, toolSpecsForModel } from './index.js';
import { allRowIds, makeFixture, makeWideFixture, M1, Q1, Q2, FULL_YEAR } from './fixture.js';

const ds = makeFixture();

/**
 * One representative call per registered tool.
 *
 * The registry-wide properties below - purity, receipt integrity - are only worth as much
 * as this table's coverage, so a test further down asserts that every tool in the registry
 * appears here. Adding a tool without adding a call fails the suite rather than quietly
 * shrinking what is guaranteed.
 */
const CALLS: Record<string, Record<string, unknown>> = {
  data_coverage: {},
  revenue_total: { ...Q1 },
  revenue_by_category: { ...Q1 },
  revenue_trend: { ...Q2 },
  revenue_monthly_series: { ...Q1 },
  member_count: { status: 'active' },
  churn_cohort_size: { band: 'elevated' },
  dues_at_risk: { band: 'watch' },
  member_churn_score: { memberId: M1 },
  facility_utilisation: { facility: 'tennis-court', ...Q1, dayOfWeek: 'weekday' },
  visit_trend: { ...Q2 },
  event_attendance_rate: { ...Q1 },
  avg_discretionary_spend: { ...Q1 },
  top_members_by_spend: { ...Q1, limit: 3 },
  search_member_notes: { query: 'slow' },
  cohort_retention: { ...FULL_YEAR },
};

describe('registry shape', () => {
  it('registers all sixteen analysis tools, keyed by name', () => {
    expect(TOOL_REGISTRY.size).toBe(16);
    for (const [name, tool] of TOOL_REGISTRY) expect(tool.name).toBe(name);
  });

  it('exposes only read tools; acting is a separate, human-confirmed surface', () => {
    for (const tool of TOOL_REGISTRY.values()) expect(tool.kind).toBe('read');
  });

  it('resolves tools by name and returns undefined for anything else', () => {
    expect(getTool('revenue_total')).toBe(TOOL_REGISTRY.get('revenue_total'));
    expect(getTool('revenue_totals')).toBeUndefined();
  });

  it('has a representative call for every registered tool', () => {
    expect(Object.keys(CALLS).sort()).toEqual([...TOOL_REGISTRY.keys()].sort());
  });

  it('gives every tool a version and a model-facing description', () => {
    for (const tool of TOOL_REGISTRY.values()) {
      expect(tool.version).toMatch(/^\d+\.\d+\.\d+$/);
      // Short descriptions are the single biggest cause of wrong tool selection, and tool
      // selection is the one thing the verifier cannot catch.
      expect(tool.description.length).toBeGreaterThan(80);
    }
  });
});

/**
 * Purity is the load-bearing property of this whole architecture.
 *
 * The verifier re-executes a tool from the params stored on its Evidence record, possibly
 * on a different machine and minutes later, and compares the result with the number in the
 * narrative. Any dependence on the clock, the timezone, randomness, or mutation of the
 * dataset would make an honest figure look fabricated - or, far worse, let a fabricated one
 * pass on a lucky re-run.
 */
describe('purity and determinism', () => {
  it('produces an identical value and evidence id on a second run', () => {
    for (const [name, params] of Object.entries(CALLS)) {
      const tool = TOOL_REGISTRY.get(name)!;
      const first = tool.run(params, ds);
      const second = tool.run(params, ds);
      expect(second.value, `${name} value drifted between runs`).toEqual(first.value);
      expect(second.id, `${name} evidence id drifted between runs`).toBe(first.id);
      expect(second.rowIds, `${name} rowIds drifted between runs`).toEqual(first.rowIds);
    }
  });

  it('leaves the dataset untouched', () => {
    const before = JSON.stringify(ds);
    for (const [name, params] of Object.entries(CALLS)) TOOL_REGISTRY.get(name)!.run(params, ds);
    expect(JSON.stringify(ds)).toBe(before);
  });

  it('derives the evidence id from the params alone, not from call order', () => {
    // Same query, argument keys written in a different order: canonicalisation must collapse
    // them to one id, or the receipt drawer would show two receipts for one fact.
    const a = TOOL_REGISTRY.get('revenue_total')!.run({ from: Q1.from, to: Q1.to }, ds);
    const b = TOOL_REGISTRY.get('revenue_total')!.run({ to: Q1.to, from: Q1.from }, ds);
    expect(b.id).toBe(a.id);
  });
});

describe('evidence integrity', () => {
  const realIds = allRowIds(ds);

  it('cites only row ids that actually exist in the dataset', () => {
    for (const [name, params] of Object.entries(CALLS)) {
      const e = TOOL_REGISTRY.get(name)!.run(params, ds);
      for (const id of e.rowIds) {
        expect(realIds.has(id), `${name} cited a row id that is not in the dataset: ${id}`).toBe(
          true,
        );
      }
    }
  });

  it('reports a row count equal to the rows it consumed', () => {
    for (const [name, params] of Object.entries(CALLS)) {
      const e = TOOL_REGISTRY.get(name)!.run(params, ds);
      // Every fixture result is well under the 500-row display cap, so here the two agree.
      expect(e.rowIds.length, `${name} row accounting is inconsistent`).toBe(e.rowCount);
      expect(new Set(e.rowIds).size, `${name} cited a row twice`).toBe(e.rowIds.length);
    }
  });

  it('keeps rowCount truthful when the displayed rowIds are capped at 500', () => {
    // 640 transactions in January, each $10. The receipt shows 500 ids because a longer
    // list is unreadable, but it must never claim the figure was computed from 500 rows.
    const wide = makeWideFixture(640);
    const e = TOOL_REGISTRY.get('revenue_total')!.run({ ...Q1 }, wide);
    expect(scalarOf(e)).toBe(6_400);
    expect(e.rowIds).toHaveLength(500);
    expect(e.rowCount).toBe(640);
  });

  it('gives every tool a unit and a method sentence written for a human', () => {
    for (const [name, params] of Object.entries(CALLS)) {
      const e = TOOL_REGISTRY.get(name)!.run(params, ds);
      expect(e.unit, `${name} has no unit`).toBeTruthy();
      // The method is displayed verbatim in the receipt drawer, so it has to read as prose.
      expect(e.method.length, `${name} method is too terse to explain anything`).toBeGreaterThan(
        60,
      );
      expect(e.method.trim().endsWith('.'), `${name} method is not a sentence`).toBe(true);
    }
  });
});

describe('toolSpecsForModel', () => {
  const specs = toolSpecsForModel();

  it('emits one Anthropic tool definition per registered tool', () => {
    expect(specs).toHaveLength(TOOL_REGISTRY.size);
    expect(specs.map((s) => s.name).sort()).toEqual([...TOOL_REGISTRY.keys()].sort());
  });

  it('renders an enum param as a constrained string, which is what JSON Schema has', () => {
    const facility = specs.find((s) => s.name === 'facility_utilisation')!;
    expect(facility.input_schema.properties.facility).toEqual({
      type: 'string',
      description: expect.stringContaining('golf-course'),
      enum: [
        'golf-course',
        'tennis-court',
        'dining-room',
        'fitness-centre',
        'pool',
        'marina-berth',
      ],
    });
  });

  it('marks exactly the required params as required', () => {
    const facility = specs.find((s) => s.name === 'facility_utilisation')!;
    expect(facility.input_schema.required.sort()).toEqual(['facility', 'from', 'to']);
    expect(Object.keys(facility.input_schema.properties).sort()).toEqual(
      ['dayOfWeek', 'facility', 'from', 'hourFrom', 'hourTo', 'to'].sort(),
    );
  });

  it('carries defaults through to the model', () => {
    const facility = specs.find((s) => s.name === 'facility_utilisation')!;
    expect(facility.input_schema.properties.dayOfWeek).toMatchObject({ default: 'all' });
    // A param with no default must not sprout a null one, which some models read as a value.
    expect(facility.input_schema.properties.from).not.toHaveProperty('default');
  });

  it('gives the argument-free coverage tool a valid empty schema', () => {
    const coverage = specs.find((s) => s.name === 'data_coverage')!;
    expect(coverage.input_schema).toEqual({ type: 'object', properties: {}, required: [] });
  });
});

/**
 * End-to-end proof of the grounding chain.
 *
 * Tools produce evidence, a narrative cites it, and the verifier re-runs each cited tool
 * from its stored params and compares. This is the assertion the whole prototype rests on:
 * a number that survives here was recomputed from source rows, and a number that did not
 * never reaches the screen.
 */
describe('verifier round-trip', () => {
  const revenue = TOOL_REGISTRY.get('revenue_total')!.run({ ...Q1 }, ds);
  const members = TOOL_REGISTRY.get('member_count')!.run({ status: 'active' }, ds);
  const retention = TOOL_REGISTRY.get('cohort_retention')!.run({ ...FULL_YEAR }, ds);

  const evidence = new Map<string, Evidence>(
    [revenue, members, retention].map((e) => [e.id, e]),
  );

  const narrative =
    `Revenue across the first quarter came to [[e:${revenue.id}|$2,500]], and the club ` +
    `currently carries [[e:${members.id}|7]] active members. Of everyone who joined during ` +
    `the year, [[e:${retention.id}|75%]] are still on the roll.`;

  it('verifies a narrative whose figures match their evidence', () => {
    const report = verifyNarrative({ narrative, evidence, dataset: ds, tools: TOOL_REGISTRY });

    expect(report.status).toBe('verified');
    expect(report.citedCount).toBe(3);
    expect(report.matchedCount).toBe(3);
    expect(report.recomputedCount).toBe(3);
    expect(report.groundedRate).toBe(1);
    expect(report.undeclaredCount).toBe(0);
    expect(report.checks.every((c) => c.outcome === 'match')).toBe(true);
  });

  it('blocks the narrative when a figure is altered after the fact', () => {
    // The evidence record is untouched and internally consistent; only the prose lies. This
    // is the exact production failure the gate exists for - the model called the right tool,
    // got the right number, and then wrote a different one.
    const corrupted = narrative.replace(`|$2,500]]`, `|$3,900]]`);
    const report = verifyNarrative({
      narrative: corrupted,
      evidence,
      dataset: ds,
      tools: TOOL_REGISTRY,
    });

    expect(report.status).toBe('blocked');
    const mismatch = report.checks.find((c) => c.outcome === 'mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch!.evidenceId).toBe(revenue.id);
    expect(mismatch!.written).toBe('$3,900');
    expect(mismatch!.actual).toBe(2_500);
    // The other two figures still pass, so the report localises the failure rather than
    // condemning the whole answer wholesale.
    expect(report.matchedCount).toBe(2);
  });

  it('blocks a figure that travels through prose with no citation at all', () => {
    const report = verifyNarrative({
      narrative: 'Revenue across the first quarter came to $2,500.',
      evidence,
      dataset: ds,
      tools: TOOL_REGISTRY,
    });

    expect(report.status).toBe('blocked');
    expect(report.undeclaredCount).toBe(1);
    expect(report.checks[0]).toMatchObject({ written: '$2,500', outcome: 'undeclared' });
  });

  it('blocks evidence produced by a tool the registry no longer recognises', () => {
    // Fails closed on version drift too: if a tool's logic changed under a stored receipt,
    // the honest response is to refuse the claim, not to re-run new code against old params.
    const stale: Evidence = { ...revenue, toolVersion: '0.0.1' };
    const report = verifyNarrative({
      narrative,
      evidence: new Map([...evidence, [stale.id, stale]]),
      dataset: ds,
      tools: TOOL_REGISTRY,
    });

    expect(report.status).toBe('blocked');
    expect(report.checks.some((c) => c.outcome === 'recompute-failed')).toBe(true);
  });
});
