import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { MEMBER_STATUSES, MEMBERSHIP_CATEGORIES, RISK_BANDS } from '../../clubscope-core';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Sort keys are enumerated rather than free-form. An open `sortBy` string is an injection
 * surface the moment this sits in front of a real query language, and enumerating the
 * options keeps the API honest about which orderings it genuinely supports rather than
 * implying any column will work.
 */
export const MEMBER_SORT_FIELDS = ['risk', 'name', 'joined', 'dues'] as const;
export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class ListMembersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [...MEMBER_STATUSES],
    description: 'Membership status. Omit to include every status.',
  })
  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: (typeof MEMBER_STATUSES)[number];

  @ApiPropertyOptional({
    enum: [...MEMBERSHIP_CATEGORIES],
    description:
      'Membership category. Category drives dues and expected usage, so it is usually the first cut a membership director makes.',
  })
  @IsOptional()
  @IsIn(MEMBERSHIP_CATEGORIES)
  category?: (typeof MEMBERSHIP_CATEGORIES)[number];

  @ApiPropertyOptional({
    enum: [...RISK_BANDS],
    description:
      'Churn risk band, matched at or above the band given: `elevated` returns elevated and critical. Bands are ordered, so a retention worklist is one parameter rather than a set.',
  })
  @IsOptional()
  @IsIn(RISK_BANDS)
  riskBand?: (typeof RISK_BANDS)[number];

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match across name, member number and email.',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({
    enum: [...MEMBER_SORT_FIELDS],
    default: 'risk',
    description: 'Sort key. Defaults to risk, because that is the list staff actually act on.',
  })
  @IsOptional()
  @IsIn(MEMBER_SORT_FIELDS)
  sort: MemberSortField = 'risk';

  @ApiPropertyOptional({
    enum: [...SORT_ORDERS],
    description:
      'Sort direction. Defaults to desc for risk (worst first) and asc for every other key, because that is what each one is asked for.',
  })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;
}
