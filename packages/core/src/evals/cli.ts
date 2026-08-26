/**
 * Terminal eval runner. Exits non-zero on any failure so it can gate CI.
 *
 * Skips are printed loudly rather than folded into the pass count: a suite that reports
 * green while quietly omitting the model-dependent half would be exactly the kind of
 * comfortable dishonesty this project exists to argue against.
 */
import { runEvals } from './runner.js';

const B = '\x1b[1m';
const DIM = '\x1b[2m';
const R = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

const report = runEvals();

console.log(`\n${B}ClubScope Insight Engine - eval suite${R}`);
console.log(`${DIM}${report.generatedAt}${R}\n`);

for (const r of report.results) {
  const mark =
    r.status === 'pass' ? `${GREEN}PASS${R}` : r.status === 'fail' ? `${RED}FAIL${R}` : `${YELLOW}SKIP${R}`;
  console.log(`${mark}  ${B}${r.id}${R} ${DIM}(${r.durationMs}ms)${R}`);
  console.log(`      ${r.detail}`);
  if (r.metrics) {
    const pairs = Object.entries(r.metrics)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ');
    console.log(`      ${DIM}${pairs}${R}`);
  }
  console.log('');
}

const { summary, headline } = report;
console.log(`${B}Headline${R}`);
console.log(`  figures cited and recomputed   ${headline.matchedFigures}/${headline.citedFigures}`);
console.log(`  groundedness rate              ${(headline.groundedRate * 100).toFixed(1)}%`);
console.log(`  recomputations performed       ${headline.recomputations}`);
console.log(`  fabricated figure caught       ${headline.fabricationCaught ? 'yes' : 'NO'}`);
console.log(`  planted anomalies found        ${headline.plantedAnomaliesFound}`);

console.log(`\n${B}Summary${R}`);
console.log(
  `  ${GREEN}${summary.passed} passed${R}  ${summary.failed > 0 ? RED : DIM}${summary.failed} failed${R}  ${YELLOW}${summary.skipped} skipped${R}  ${DIM}in ${report.durationMs}ms${R}`,
);

if (summary.skipped > 0) {
  console.log(
    `\n${YELLOW}${summary.skipped} case(s) skipped${R} because they require a model API key. They are listed above with the reason; none of them are counted as passing.`,
  );
}

process.exit(summary.failed > 0 ? 1 : 0);
