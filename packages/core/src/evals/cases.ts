import { getDataset, PLANTED_ANOMALIES } from '../data/index.js';
import { assessChurn } from '../scoring/churn.js';
import { detectInsights } from '../insights/index.js';
import { runScriptedTurn } from '../assistant/scripted-runner.js';
import { SCRIPTED_TURNS, getTurn } from '../assistant/turns.js';
import { TOOL_REGISTRY } from '../tools/index.js';

/**
 * The eval suite.
 *
 * ## What this measures, and what it deliberately does not
 *
 * With no model API key configured, the assistant runs scripted: which tools to call and how
 * to phrase the answer are fixed in advance. That makes two classes of eval meaningful and
 * one class meaningless, and pretending otherwise would be the exact dishonesty this whole
 * project argues against.
 *
 * **Meaningful today (deterministic):**
 *  - groundedness — does every figure survive recomputation from source
 *  - the negative control — does the verifier actually catch a fabricated figure
 *  - refusal hygiene — do out-of-coverage questions produce no invented numbers
 *  - determinism — is the same question answered identically twice
 *  - detection — do the insight detectors find the planted anomalies, and stay quiet otherwise
 *  - scoring separation — does the churn model separate real leavers from stayers
 *
 * **Only meaningful in live mode (model-dependent), and therefore reported as `skipped`
 * rather than silently passed:**
 *  - tool selection — did the model choose the right tool for a question it had not seen
 *  - phrasing quality, refusal judgement on novel questions, cost and latency per case
 *
 * A suite that reports 100% while quietly skipping the hard half is worse than no suite. The
 * runner prints the skipped set every time, with the reason.
 */

export type EvalCategory =
  | 'groundedness'
  | 'negative-control'
  | 'refusal'
  | 'determinism'
  | 'detection'
  | 'scoring';

export interface EvalResult {
  id: string;
  category: EvalCategory;
  description: string;
  status: 'pass' | 'fail' | 'skip';
  /** Human-readable evidence for the verdict. Always populated, pass or fail. */
  detail: string;
  metrics?: Record<string, number | string>;
  durationMs: number;
}

export interface EvalCase {
  id: string;
  category: EvalCategory;
  description: string;
  run(): Omit<EvalResult, 'id' | 'category' | 'description' | 'durationMs'>;
}

const ds = () => getDataset();
const tools = () => TOOL_REGISTRY;

/** Turns that should answer with grounded figures: everything bar refusals and the poison. */
const answeringTurns = () =>
  SCRIPTED_TURNS.filter((t) => !t.refusal && !t.poison);

export const EVAL_CASES: EvalCase[] = [
  // ── Groundedness ──────────────────────────────────────────────────────────
  {
    id: 'groundedness.all-turns-verify',
    category: 'groundedness',
    description:
      'Every answering turn passes the verifier: each cited figure is recomputed from source and matches, and no figure appears uncited.',
    run() {
      const failures: string[] = [];
      let cited = 0;
      let matched = 0;
      let recomputed = 0;

      for (const turn of answeringTurns()) {
        const result = runScriptedTurn({ turn, dataset: ds(), tools: tools() });
        cited += result.verification.citedCount;
        matched += result.verification.matchedCount;
        recomputed += result.verification.recomputedCount;
        if (result.verification.status !== 'verified') {
          const bad = result.verification.checks
            .filter((c) => c.outcome !== 'match')
            .map((c) => `${c.written} (${c.outcome})`)
            .join(', ');
          failures.push(`${turn.id}: ${bad}`);
        }
      }

      return {
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `${answeringTurns().length} turns verified, ${matched}/${cited} cited figures recomputed and matched.`
            : `Blocked turns: ${failures.join(' | ')}`,
        metrics: {
          turns: answeringTurns().length,
          citedFigures: cited,
          matchedFigures: matched,
          recomputations: recomputed,
          groundedRate: cited === 0 ? 1 : Number((matched / cited).toFixed(4)),
        },
      };
    },
  },

  {
    id: 'groundedness.insights-verify',
    category: 'groundedness',
    description:
      'Every insight in the feed passes the verifier before it is eligible to render.',
    run() {
      const insights = detectInsights(ds());
      const blocked = insights.filter((i) => i.verification.status !== 'verified');
      return {
        status: blocked.length === 0 && insights.length > 0 ? 'pass' : 'fail',
        detail:
          insights.length === 0
            ? 'No insights were produced, so the guarantee is vacuous.'
            : blocked.length === 0
              ? `${insights.length} insights produced, all verified.`
              : `Blocked: ${blocked.map((i) => i.detector).join(', ')}`,
        metrics: { insights: insights.length, blocked: blocked.length },
      };
    },
  },

  // ── Negative control: the suite's most important case ─────────────────────
  {
    id: 'negative-control.verifier-catches-fabrication',
    category: 'negative-control',
    description:
      'A deliberately fabricated figure is blocked. If this case ever passes silently, every other groundedness result in this suite is worthless.',
    run() {
      const turn = SCRIPTED_TURNS.find((t) => t.poison);
      if (!turn) {
        return { status: 'fail', detail: 'No poisoned turn is defined, so the gate is untested.' };
      }
      const result = runScriptedTurn({ turn, dataset: ds(), tools: tools() });
      const mismatch = result.verification.checks.find((c) => c.outcome === 'mismatch');
      const caught = result.verification.status === 'blocked' && mismatch !== undefined;
      return {
        status: caught ? 'pass' : 'fail',
        detail: caught
          ? `Blocked. Narrative claimed ${mismatch!.written}; source recomputes ${mismatch!.actual}.`
          : 'The fabricated figure was NOT blocked. The grounding guarantee is broken.',
        metrics: mismatch
          ? { claimed: mismatch.written, recomputed: String(mismatch.actual ?? '') }
          : undefined,
      };
    },
  },

  // ── Refusal hygiene ───────────────────────────────────────────────────────
  {
    id: 'refusal.no-invented-figures',
    category: 'refusal',
    description:
      'Questions outside the dataset coverage are refused without inventing a single figure. A correct refusal is a correct answer.',
    run() {
      const refusals = SCRIPTED_TURNS.filter((t) => t.refusal);
      const offenders: string[] = [];
      for (const turn of refusals) {
        const result = runScriptedTurn({ turn, dataset: ds(), tools: tools() });
        const undeclared = result.verification.undeclaredCount;
        if (undeclared > 0) offenders.push(`${turn.id} leaked ${undeclared} uncited figure(s)`);
        if (result.verification.status !== 'verified') offenders.push(`${turn.id} failed verification`);
      }
      return {
        status: refusals.length > 0 && offenders.length === 0 ? 'pass' : 'fail',
        detail:
          refusals.length === 0
            ? 'No refusal cases defined.'
            : offenders.length === 0
              ? `${refusals.length} refusal cases answered with no fabricated figures.`
              : offenders.join(' | '),
        metrics: { refusalCases: refusals.length },
      };
    },
  },

  // ── Determinism ───────────────────────────────────────────────────────────
  {
    id: 'determinism.identical-across-runs',
    category: 'determinism',
    description:
      'The same question answered twice produces byte-identical narrative and evidence ids. Without this, a failing eval cannot be distinguished from sampling noise.',
    run() {
      const drifted: string[] = [];
      for (const turn of SCRIPTED_TURNS) {
        const a = runScriptedTurn({ turn, dataset: ds(), tools: tools() });
        const b = runScriptedTurn({ turn, dataset: ds(), tools: tools() });
        if (a.raw !== b.raw) drifted.push(`${turn.id}: narrative drift`);
        const idsA = a.evidence.map((e) => e.id).join(',');
        const idsB = b.evidence.map((e) => e.id).join(',');
        if (idsA !== idsB) drifted.push(`${turn.id}: evidence id drift`);
      }
      return {
        status: drifted.length === 0 ? 'pass' : 'fail',
        detail:
          drifted.length === 0
            ? `${SCRIPTED_TURNS.length} turns reproduced identically.`
            : drifted.join(' | '),
        metrics: { turns: SCRIPTED_TURNS.length },
      };
    },
  },

  // ── Detection: recall against known ground truth ──────────────────────────
  {
    id: 'detection.planted-anomalies-found',
    category: 'detection',
    description:
      'Each planted anomaly is surfaced by at least one detector. The dataset knows the right answer, so this is real recall rather than a vibe check.',
    run() {
      const insights = detectInsights(ds());
      const haystack = insights
        .map((i) => `${i.detector} ${i.headline} ${i.narrative} ${i.recommendation}`)
        .join(' ')
        .toLowerCase();

      // Matched on the subject of each anomaly rather than on exact phrasing, so a reworded
      // narrative does not fail the eval while a genuinely missed anomaly still does.
      const probes: Record<string, string[]> = {
        'dining-decline-2026': ['dining'],
        'tennis-weekday-mornings': ['tennis', 'court'],
        'q1-2025-joiner-cohort': ['cohort', 'joiner'],
        'guest-fee-surge-2026': ['guest'],
      };

      // A probe map keyed on an id that does not exist would silently fall back to a loose
      // token match and pass for the wrong reason - a test that is green because it is not
      // really looking. Assert the map covers the anomaly set exactly, so renaming an
      // anomaly breaks this case loudly instead of quietly weakening it.
      const unmapped = PLANTED_ANOMALIES.filter((a) => probes[a.id] === undefined);
      if (unmapped.length > 0) {
        return {
          status: 'fail',
          detail: `Probe map is stale: no probe defined for ${unmapped
            .map((a) => a.id)
            .join(', ')}. Fix the map rather than relying on a fallback match.`,
        };
      }

      const missed = PLANTED_ANOMALIES.filter(
        (a) => !(probes[a.id] ?? []).some((t) => haystack.includes(t.toLowerCase())),
      );

      return {
        status: missed.length === 0 ? 'pass' : 'fail',
        detail:
          missed.length === 0
            ? `All ${PLANTED_ANOMALIES.length} planted anomalies surfaced by the feed.`
            : `Missed: ${missed.map((a) => a.id).join(', ')}`,
        metrics: {
          planted: PLANTED_ANOMALIES.length,
          found: PLANTED_ANOMALIES.length - missed.length,
          insightsProduced: insights.length,
        },
      };
    },
  },

  // ── Scoring separation, reported honestly ─────────────────────────────────
  {
    id: 'scoring.churn-separates-leavers-from-stayers',
    category: 'scoring',
    description:
      'The churn model scores members who actually resigned materially higher than long-tenured members who stayed. Asserts separation only; no recall target, because tuning the fixture to hit one would be measuring the data rather than the model.',
    run() {
      const dataset = ds();
      const resigned = dataset.members.filter((m) => m.status === 'resigned');
      const stayers = dataset.members.filter(
        (m) => m.status === 'active' && Date.parse(m.joinedAt) < Date.parse('2022-01-01'),
      );

      const median = (xs: number[]) => {
        if (xs.length === 0) return 0;
        const s = [...xs].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)] ?? 0;
      };

      // Resigned members are scored at their resignation date; scoring them at the dataset
      // end would measure a member who has already left, which is not the prediction problem.
      const leaverScores = resigned.map(
        (m) => assessChurn(m, dataset, m.resignedAt ?? dataset.club.dataTo).score,
      );
      const stayerScores = stayers.map((m) => assessChurn(m, dataset).score);

      const leaverMedian = median(leaverScores);
      const stayerMedian = median(stayerScores);
      const separated = leaverMedian > stayerMedian;

      return {
        status: separated ? 'pass' : 'fail',
        detail: separated
          ? `Resigned members score a median of ${leaverMedian} against ${stayerMedian} for long-tenured stayers. Both populations overlap, which is expected and correct: about a third of resignations in this dataset arrive with no warning.`
          : `No separation: leavers ${leaverMedian}, stayers ${stayerMedian}.`,
        metrics: {
          leavers: leaverScores.length,
          stayers: stayerScores.length,
          leaverMedian,
          stayerMedian,
        },
      };
    },
  },

  // ── Explicitly skipped, with the reason stated ────────────────────────────
  {
    id: 'live-only.tool-selection',
    category: 'groundedness',
    description:
      'Does the model pick the correct tool for a question it has not seen before?',
    run: () => ({
      status: 'skip',
      detail:
        'Requires a model API key. In replay mode the tool calls are scripted, so this would measure the script rather than the model, and passing it would be meaningless.',
    }),
  },
  {
    id: 'live-only.novel-refusal-judgement',
    category: 'refusal',
    description:
      'Does the model refuse a novel out-of-coverage question it was not scripted to refuse?',
    run: () => ({
      status: 'skip',
      detail:
        'Requires a model API key. Scripted refusals prove the pipeline handles a refusal, not that the model would decide to refuse.',
    }),
  },
  {
    id: 'live-only.cost-and-latency',
    category: 'determinism',
    description: 'Token cost and latency per case, at normal and abuse-case volume.',
    run: () => ({
      status: 'skip',
      detail: 'Requires a model API key. Replay costs no tokens, so any figure reported here would be fiction.',
    }),
  },
];

export { getTurn };
