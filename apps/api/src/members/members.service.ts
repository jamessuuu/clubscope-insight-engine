import { Injectable, NotFoundException } from '@nestjs/common';

import {
  bandAtOrAbove,
  type ChurnAssessment,
  type Member,
  type RevenueCategory,
  type RiskBand,
} from '../clubscope-core';
import { pageMeta } from '../common/dto/pagination.dto';
import { DatasetService } from '../dataset/dataset.service';
import type { ListMembersQueryDto, SortOrder } from './dto/list-members.query.dto';
import type {
  MemberListResponseDto,
  MemberProfileResponseDto,
  MemberSummaryDto,
} from './dto/member.dto';

const DAY_MS = 86_400_000;
const RECENT_ACTIVITY_ROWS = 20;
const RECENT_NOTE_ROWS = 10;

@Injectable()
export class MembersService {
  constructor(private readonly datasets: DatasetService) {}

  /**
   * Filter, sort, then page — in that order, because paging before filtering is the classic
   * way to hand a client a page of the wrong rows and a total that is a lie.
   *
   * Risk is a first-class sort key rather than a client-side afterthought: the reason this
   * collection exists is to produce a worklist for whoever owns retention, and that list is
   * ordered by risk or it is not a worklist.
   */
  list(query: ListMembersQueryDto): MemberListResponseDto {
    const churn = this.datasets.churnTable();
    const needle = query.search?.toLowerCase();

    const matched = this.datasets.dataset().members.filter((member) => {
      if (query.status && member.status !== query.status) return false;
      if (query.category && member.category !== query.category) return false;
      if (query.riskBand) {
        const band = churn.get(member.id)?.band;
        if (!band || !bandAtOrAbove(band as RiskBand, query.riskBand as RiskBand)) return false;
      }
      if (needle && !haystack(member).includes(needle)) return false;
      return true;
    });

    // `risk` reads worst-first by default and everything else reads A-to-Z, because that is
    // how each key is actually asked for; an explicit `order` always wins.
    const order: SortOrder = query.order ?? (query.sort === 'risk' ? 'desc' : 'asc');
    const direction = order === 'asc' ? 1 : -1;

    const sorted = [...matched].sort((a, b) => direction * compare(a, b, query.sort, churn));

    const start = (query.page - 1) * query.pageSize;
    return {
      items: sorted
        .slice(start, start + query.pageSize)
        .map((member) => this.summarise(member, churn.get(member.id))),
      meta: pageMeta(query.page, query.pageSize, matched.length),
    };
  }

  profile(id: string): MemberProfileResponseDto {
    const member = this.datasets.member(id);
    // A 404 with the id echoed back is worth more than a bare "Not Found": the caller
    // usually got here by pasting an id from somewhere and needs to see which one missed.
    if (!member) throw new NotFoundException(`No member with id "${id}" exists in this dataset.`);

    const assessment = this.datasets.churn(id);
    const { visits, transactions, notes } = this.datasets.activityFor(id);
    const ds = this.datasets.dataset();

    const asOfMs = Date.parse(`${ds.club.dataTo}T23:59:59.999Z`);
    const windowStart = asOfMs - 90 * DAY_MS;

    const visitsNewestFirst = [...visits].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const txNewestFirst = [...transactions].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const notesNewestFirst = [...notes].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    const spend = new Map<RevenueCategory, number>();
    for (const t of transactions) spend.set(t.category, (spend.get(t.category) ?? 0) + t.amount);

    const attendedEventIds = new Set(
      ds.registrations.filter((r) => r.memberId === id && r.attended).map((r) => r.id),
    );

    return {
      member: this.summarise(member, assessment),
      ageBand: member.ageBand,
      householdSize: member.householdSize,
      homeCity: member.homeCity,
      joinedVia: member.joinedVia,
      resignedAt: member.resignedAt ?? null,
      churn: assessment ?? emptyAssessment(id, ds.club.dataTo),
      activity: {
        visitsTotal: visits.length,
        visitsLast90Days: visits.filter((v) => {
          const t = Date.parse(v.at);
          return t >= windowStart && t <= asOfMs;
        }).length,
        lastVisitAt: visitsNewestFirst[0]?.at ?? null,
        eventsAttended: attendedEventIds.size,
        spendByCategory: [...spend]
          .map(([category, amount]) => ({ category, amount: Math.round(amount) }))
          .sort((a, b) => b.amount - a.amount),
      },
      recentVisits: visitsNewestFirst.slice(0, RECENT_ACTIVITY_ROWS).map((v) => ({
        id: v.id,
        at: v.at,
        facility: v.facility,
        guests: v.guests,
        durationMin: v.durationMin,
      })),
      recentTransactions: txNewestFirst.slice(0, RECENT_ACTIVITY_ROWS).map((t) => ({
        id: t.id,
        date: t.date,
        category: t.category,
        amount: t.amount,
      })),
      recentNotes: notesNewestFirst.slice(0, RECENT_NOTE_ROWS).map((n) => ({
        id: n.id,
        date: n.date,
        author: n.author,
        channel: n.channel,
        sentiment: n.sentiment,
        body: n.body,
      })),
    };
  }

  private summarise(member: Member, assessment: ChurnAssessment | undefined): MemberSummaryDto {
    const dataTo = this.datasets.dataset().club.dataTo;
    return {
      id: member.id,
      memberNo: member.memberNo,
      name: `${member.firstName} ${member.lastName}`,
      email: member.email,
      category: member.category,
      status: member.status,
      joinedAt: member.joinedAt,
      tenureYears: Number(
        ((Date.parse(dataTo) - Date.parse(member.joinedAt)) / (365 * DAY_MS)).toFixed(1),
      ),
      annualDues: member.annualDues,
      risk: { score: assessment?.score ?? 0, band: assessment?.band ?? 'low' },
    };
  }
}

function haystack(member: Member): string {
  return `${member.firstName} ${member.lastName} ${member.memberNo} ${member.email}`.toLowerCase();
}

function compare(
  a: Member,
  b: Member,
  key: ListMembersQueryDto['sort'],
  churn: Map<string, ChurnAssessment>,
): number {
  switch (key) {
    case 'risk': {
      const delta = (churn.get(a.id)?.score ?? 0) - (churn.get(b.id)?.score ?? 0);
      // Ties on a 0-100 integer score are common, so break them on a stable key. Without
      // this, two identical requests can return different pages for the same filters.
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    }
    case 'name': {
      const delta = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    }
    case 'joined':
      return Date.parse(a.joinedAt) - Date.parse(b.joinedAt) || a.id.localeCompare(b.id);
    case 'dues':
      return a.annualDues - b.annualDues || a.id.localeCompare(b.id);
  }
}

/**
 * Only reachable if the churn table and the member index ever disagree, which they cannot
 * while both are built from the same dataset. It exists so the response type stays honest
 * rather than being widened to `| undefined` for a case that cannot occur.
 */
function emptyAssessment(memberId: string, asOf: string): ChurnAssessment {
  return { memberId, modelVersion: 'unavailable', score: 0, band: 'low', contributions: [], asOf };
}
