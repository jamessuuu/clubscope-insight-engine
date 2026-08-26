import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Offset pagination, with bounds rather than trust.
 *
 * `pageSize` is capped at 100 deliberately. The members collection is ~420 rows and every
 * row carries a churn assessment, so an uncapped `pageSize` is an invitation to ask for the
 * whole table on every poll. Offset (rather than cursor) pagination is the right call at
 * this scale and would be the wrong one at a million rows; that is a trade worth naming
 * rather than defaulting into.
 *
 * `@Type(() => Number)` is required because query strings arrive as strings — without it
 * `@IsInt()` would reject every request, which is the classic first bug in a Nest API.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, description: '1-based page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 25,
    description: 'Rows per page. Capped at 100 to keep a single request bounded.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}

/** Envelope shared by every paginated collection, so clients learn one shape. */
export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 420, description: 'Total rows matching the filters, before paging.' })
  total!: number;

  @ApiProperty({ example: 17 })
  totalPages!: number;
}

export function pageMeta(page: number, pageSize: number, total: number): PageMetaDto {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
