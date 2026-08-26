import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { API_TAGS } from '../app.constants';
import { MEMBER_STATUSES, MEMBERSHIP_CATEGORIES } from '../clubscope-core';
import { DatasetService } from '../dataset/dataset.service';
import { BreakdownEntryDto, ClubResponseDto } from './dto/club.dto';

const DAY_MS = 86_400_000;

@ApiTags(API_TAGS.club)
@Controller('club')
export class ClubController {
  constructor(private readonly datasets: DatasetService) {}

  @Get()
  @ApiOperation({
    summary: 'Club profile and the exact bounds of the data',
    description:
      'The coverage window is the assistant\'s hard boundary: a question about a date outside ' +
      '`from`..`to` must be refused rather than answered. Publishing the bounds here lets a ' +
      'client show the constraint instead of discovering it as a refusal.',
  })
  @ApiOkResponse({ type: ClubResponseDto })
  club(): ClubResponseDto {
    const ds = this.datasets.dataset();
    const from = Date.parse(`${ds.club.dataFrom}T00:00:00.000Z`);
    const to = Date.parse(`${ds.club.dataTo}T00:00:00.000Z`);

    return {
      club: {
        name: ds.club.name,
        kind: ds.club.kind,
        city: ds.club.city,
        foundedYear: ds.club.foundedYear,
      },
      coverage: {
        from: ds.club.dataFrom,
        to: ds.club.dataTo,
        days: Math.round((to - from) / DAY_MS) + 1,
        months: monthsBetween(ds.club.dataFrom, ds.club.dataTo),
        rows: this.datasets.rowCounts(),
      },
      // Ordered by the domain's own enum rather than by count, so a client can rely on a
      // stable row order and the absence of a category reads as a real zero.
      byCategory: tally(
        MEMBERSHIP_CATEGORIES,
        ds.members.map((m) => m.category),
      ),
      byStatus: tally(
        MEMBER_STATUSES,
        ds.members.map((m) => m.status),
      ),
      datasetFingerprint: this.datasets.fingerprint(),
    };
  }
}

function tally(keys: readonly string[], values: readonly string[]): BreakdownEntryDto[] {
  const counts = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count }));
}

/**
 * Month buckets are produced by slicing the ISO strings rather than by walking `Date`
 * objects, matching how core buckets months. Anything that goes through the local timezone
 * would bucket differently on a machine in Sydney than on one in London, and the two would
 * disagree about which month a figure belongs to.
 */
function monthsBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let [year, month] = fromIso.split('-').map(Number) as [number, number];
  const [endYear, endMonth] = toIso.split('-').map(Number) as [number, number];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    if (++month === 13) {
      month = 1;
      year++;
    }
  }
  return out;
}
