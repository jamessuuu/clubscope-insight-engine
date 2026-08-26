import { EVAL_CASES, type EvalCase, type EvalCategory, type EvalResult } from './cases.js';

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  byCategory: Record<string, { passed: number; failed: number; skipped: number }>;
}

export interface EvalReport {
  results: EvalResult[];
  summary: EvalSummary;
  /** Headline figures the UI shows without recomputing them from results. */
  headline: {
    citedFigures: number;
    matchedFigures: number;
    groundedRate: number;
    recomputations: number;
    fabricationCaught: boolean;
    plantedAnomaliesFound: string;
  };
  generatedAt: string;
  durationMs: number;
}

function runCase(c: EvalCase): EvalResult {
  const started = Date.now();
  try {
    const outcome = c.run();
    return {
      id: c.id,
      category: c.category,
      description: c.description,
      durationMs: Date.now() - started,
      ...outcome,
    };
  } catch (err) {
    // A throwing case is a failing case. Swallowing the error and reporting a pass is the
    // single most common way an eval suite starts lying to the team that depends on it.
    return {
      id: c.id,
      category: c.category,
      description: c.description,
      status: 'fail',
      detail: `Case threw: ${(err as Error).message}`,
      durationMs: Date.now() - started,
    };
  }
}

export function runEvals(cases: EvalCase[] = EVAL_CASES): EvalReport {
  const started = Date.now();
  const results = cases.map(runCase);

  const byCategory: EvalSummary['byCategory'] = {};
  for (const r of results) {
    const bucket = (byCategory[r.category] ??= { passed: 0, failed: 0, skipped: 0 });
    if (r.status === 'pass') bucket.passed++;
    else if (r.status === 'fail') bucket.failed++;
    else bucket.skipped++;
  }

  const find = (id: string) => results.find((r) => r.id === id);
  const grounded = find('groundedness.all-turns-verify');
  const negative = find('negative-control.verifier-catches-fabrication');
  const detection = find('detection.planted-anomalies-found');

  const num = (r: EvalResult | undefined, key: string): number => {
    const v = r?.metrics?.[key];
    return typeof v === 'number' ? v : 0;
  };

  return {
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skip').length,
      byCategory,
    },
    headline: {
      citedFigures: num(grounded, 'citedFigures'),
      matchedFigures: num(grounded, 'matchedFigures'),
      groundedRate: num(grounded, 'groundedRate'),
      recomputations: num(grounded, 'recomputations'),
      fabricationCaught: negative?.status === 'pass',
      plantedAnomaliesFound: `${num(detection, 'found')}/${num(detection, 'planted')}`,
    },
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

export type { EvalCase, EvalCategory, EvalResult };
