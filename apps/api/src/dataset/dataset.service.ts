import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import {
  assessChurn,
  detectInsights,
  getDataset,
  type ChurnAssessment,
  type ClubDataset,
  type Insight,
  type Member,
  type MemberNote,
  type Transaction,
  type Visit,
} from '../clubscope-core';

export interface RowCounts {
  members: number;
  transactions: number;
  visits: number;
  events: number;
  registrations: number;
  notes: number;
  total: number;
}

/**
 * The application's read model over the club dataset.
 *
 * ## Why anything is cached at all
 *
 * `getDataset()` is already memoised inside core, so that part is free. The two expensive
 * things are the ones this service owns:
 *
 * **Churn assessments.** `assessChurn` is a pure function over the whole dataset, and
 * `GET /members` sorts and filters by risk band — which means assessing *every* member on
 * *every* request. Each assessment scans ~120,000 visit and transaction rows, so the naive
 * path is ~420 × 120,000 ≈ 50M row visits per page view. Computed once and held, it is a
 * map lookup.
 *
 * **Insight detection.** `detectInsights` runs every detector across the full dataset. The
 * dataset is deterministic and immutable for the life of the process, so a second run
 * cannot produce a different answer — recomputing it per request would burn CPU to arrive
 * at a value already in memory.
 *
 * Caching is only safe here because of a property core deliberately guarantees: the dataset
 * is generated from a fixed seed and treated as immutable by every consumer. If this were a
 * live club database, this class is exactly where a repository with a real invalidation
 * story would go, and the controllers above it would not change.
 *
 * ## Why the caches are lazy rather than warmed at boot
 *
 * The same image runs as a long-lived server and as a Vercel function. Warming in
 * `onModuleInit` would move this cost into every cold start, including cold starts for
 * `/health`, which exists precisely to answer quickly. Lazy means the first caller to need
 * a thing pays for it once.
 */
@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);

  private churnCache: Map<string, ChurnAssessment> | null = null;
  private insightsCache: Insight[] | null = null;
  private memberIndexCache: Map<string, Member> | null = null;
  private fingerprintCache: string | null = null;

  dataset(): ClubDataset {
    return getDataset();
  }

  rowCounts(): RowCounts {
    const ds = this.dataset();
    const counts = {
      members: ds.members.length,
      transactions: ds.transactions.length,
      visits: ds.visits.length,
      events: ds.events.length,
      registrations: ds.registrations.length,
      notes: ds.notes.length,
    };
    return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  }

  /**
   * Identity of the data every figure in this API was computed against.
   *
   * Surfaced on `/health` so two people comparing screenshots — or a reviewer comparing a
   * cached response against a fresh one — can tell in one glance whether they are looking
   * at the same club. A number without a statement of which dataset produced it is not
   * really evidence.
   */
  fingerprint(): string {
    if (this.fingerprintCache === null) {
      const ds = this.dataset();
      this.fingerprintCache = createHash('sha256')
        .update(
          JSON.stringify({
            club: ds.club,
            counts: this.rowCounts(),
          }),
        )
        .digest('hex')
        .slice(0, 16);
    }
    return this.fingerprintCache;
  }

  member(id: string): Member | undefined {
    if (this.memberIndexCache === null) {
      this.memberIndexCache = new Map(this.dataset().members.map((m) => [m.id, m]));
    }
    return this.memberIndexCache.get(id);
  }

  churn(memberId: string): ChurnAssessment | undefined {
    return this.churnTable().get(memberId);
  }

  /**
   * Every member's churn assessment, computed once.
   *
   * The dataset is partitioned by member *before* scoring, and each member is assessed
   * against a dataset view holding only their own rows. This is behaviour-preserving by
   * construction: `assessChurn` reads exactly three collections — visits, transactions and
   * notes — and filters all three by `member.id` before doing anything with them. Handing
   * it a pre-filtered view produces identical arrays, so identical contributions and an
   * identical score, while turning an O(members × rows) sweep into a single O(rows) pass.
   *
   * Optimising by understanding the library rather than by forking it; the guarantee is
   * pinned by a test in `test/members.e2e.spec.ts`.
   */
  churnTable(): Map<string, ChurnAssessment> {
    if (this.churnCache !== null) return this.churnCache;

    const started = Date.now();
    const ds = this.dataset();

    const visitsBy = groupBy(ds.visits, (v) => v.memberId);
    const txBy = groupBy(ds.transactions, (t) => t.memberId);
    const notesBy = groupBy(ds.notes, (n) => n.memberId);
    const empty = Object.freeze([]) as never[];

    const table = new Map<string, ChurnAssessment>();
    for (const member of ds.members) {
      const view: ClubDataset = {
        ...ds,
        visits: (visitsBy.get(member.id) ?? empty) as Visit[],
        transactions: (txBy.get(member.id) ?? empty) as Transaction[],
        notes: (notesBy.get(member.id) ?? empty) as MemberNote[],
      };
      table.set(member.id, assessChurn(member, view));
    }

    this.churnCache = table;
    this.logger.log(`scored ${table.size} members in ${Date.now() - started}ms`);
    return table;
  }

  insights(): Insight[] {
    if (this.insightsCache === null) {
      const started = Date.now();
      this.insightsCache = detectInsights(this.dataset());
      this.logger.log(
        `detected ${this.insightsCache.length} insights in ${Date.now() - started}ms`,
      );
    }
    return this.insightsCache;
  }

  /** Rows belonging to one member, for the Member 360 view. Cheap enough to do per request. */
  activityFor(memberId: string): {
    visits: Visit[];
    transactions: Transaction[];
    notes: MemberNote[];
  } {
    const ds = this.dataset();
    return {
      visits: ds.visits.filter((v) => v.memberId === memberId),
      transactions: ds.transactions.filter((t) => t.memberId === memberId),
      notes: ds.notes.filter((n) => n.memberId === memberId),
    };
  }
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}
