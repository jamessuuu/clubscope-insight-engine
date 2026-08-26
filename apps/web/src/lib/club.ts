import { once } from './once';
import { getDataset } from '@clubscope/core/data';
import { TOOL_REGISTRY } from '@clubscope/core/tools';
import { assessChurn } from '@clubscope/core/scoring';
import type { ClubDataset } from '@clubscope/core/domain';
import type { Evidence } from '@clubscope/core/tools';
import type { ChurnAssessment } from '@clubscope/core/scoring';
import { shiftDays } from './format';

/**
 * Server-side access to the club.
 *
 * `getDataset()` in core is already memoised at module scope. Re-wrapping it in `once()`
 * here is not belt-and-braces: it keeps every derived view — the churn assessments, the
 * roster, the risk distribution — behind the same single-evaluation discipline as the data
 * itself, so no page can accidentally pay the ~300ms scoring cost twice in one render.
 */
export const club = once((): ClubDataset => getDataset());

/**
 * Every member's churn assessment, computed exactly once.
 *
 * The roster table, the risk-distribution donut and the cohort headline all want the same
 * 420 assessments. Scoring them costs ~300ms; doing it three times costs a second of
 * time-to-first-byte for no new information.
 */
export const assessments = once((): Map<string, ChurnAssessment> => {
  const ds = club();
  return new Map(ds.members.map((m) => [m.id, assessChurn(m, ds)]));
});

/**
 * Runs a registry tool and returns its Evidence.
 *
 * Every figure the UI prints goes through here rather than being computed inline in a
 * component. That is the whole grounding contract expressed as a code path: if a number
 * cannot be produced by a registered, versioned, recomputable tool, there is nowhere in
 * this application to render it.
 */
export function evidenceFrom(tool: string, params: Record<string, unknown>): Evidence {
  const impl = TOOL_REGISTRY.get(tool);
  if (!impl) throw new Error(`no analysis tool named "${tool}" is registered`);
  return impl.run(params, club());
}

/** The last 90 days the dataset covers, as an inclusive tool period. */
export const recentWindow = once((): { from: string; to: string } => {
  const to = club().club.dataTo;
  return { from: shiftDays(to, -89), to };
});

export type RiskBand = ChurnAssessment['band'];

export const RISK_BAND_ORDER: readonly RiskBand[] = ['critical', 'elevated', 'watch', 'low'];

/** Counts of active members per risk band, heaviest first. */
export const riskDistribution = once((): Array<{ band: RiskBand; count: number }> => {
  const scored = assessments();
  const counts = new Map<RiskBand, number>(RISK_BAND_ORDER.map((b) => [b, 0]));
  for (const m of club().members) {
    if (m.status !== 'active') continue;
    const a = scored.get(m.id);
    if (!a) continue;
    counts.set(a.band, (counts.get(a.band) ?? 0) + 1);
  }
  return RISK_BAND_ORDER.map((band) => ({ band, count: counts.get(band) ?? 0 }));
});

/**
 * The scalar behind an Evidence record, or 0 for the non-scalar shapes.
 *
 * Series and table evidence exist for breakdowns and are rendered by the chart components;
 * anywhere a single headline figure is printed, the evidence is a scalar by construction.
 */
export function scalarValue(evidence: Evidence): number {
  return evidence.value.kind === 'scalar' ? evidence.value.n : 0;
}
