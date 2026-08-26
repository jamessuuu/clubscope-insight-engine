import { ApiProperty } from '@nestjs/swagger';

import { RowCountsDto } from '../../health/dto/health.dto';

export class ClubProfileDto {
  @ApiProperty({ example: 'Windermere Hills Country Club' }) name!: string;
  @ApiProperty({ enum: ['country', 'yacht', 'social', 'health'], example: 'country' })
  kind!: string;
  @ApiProperty({ example: 'Asheville' }) city!: string;
  @ApiProperty({ example: 1957 }) foundedYear!: number;
}

export class CoverageDto {
  @ApiProperty({ example: '2024-09-01', description: 'Inclusive first date the data covers.' })
  from!: string;

  @ApiProperty({ example: '2026-08-31', description: 'Inclusive last date the data covers.' })
  to!: string;

  @ApiProperty({ example: 730, description: 'Days spanned, inclusive of both bounds.' })
  days!: number;

  @ApiProperty({
    example: ['2024-09', '2024-10'],
    description: 'Every YYYY-MM bucket in range, so a client can render a dense series with no gaps.',
    type: [String],
  })
  months!: string[];

  @ApiProperty({ type: RowCountsDto })
  rows!: RowCountsDto;
}

export class BreakdownEntryDto {
  @ApiProperty({ example: 'full-golf' }) key!: string;
  @ApiProperty({ example: 168 }) count!: number;
}

export class ClubResponseDto {
  @ApiProperty({ type: ClubProfileDto })
  club!: ClubProfileDto;

  @ApiProperty({ type: CoverageDto })
  coverage!: CoverageDto;

  @ApiProperty({
    type: [BreakdownEntryDto],
    description: 'Members per membership category. Category drives dues, entitlement and expected usage.',
  })
  byCategory!: BreakdownEntryDto[];

  @ApiProperty({ type: [BreakdownEntryDto], description: 'Members per status.' })
  byStatus!: BreakdownEntryDto[];

  @ApiProperty({
    example: 'a3f1c0d21e9b4477',
    description: 'Dataset fingerprint, matching GET /health.',
  })
  datasetFingerprint!: string;
}
