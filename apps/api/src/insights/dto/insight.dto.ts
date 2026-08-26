import { ApiProperty } from '@nestjs/swagger';

import { EvidenceDto, VerificationReportDto } from '../../common/dto/evidence.dto';

export class SuggestedActionDto {
  @ApiProperty({
    enum: ['create_task', 'draft_member_outreach', 'flag_member_for_review', 'schedule_report'],
    example: 'create_task',
  })
  kind!: string;

  @ApiProperty({ example: 'Create a retention task for the Membership Director' })
  label!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  args!: Record<string, unknown>;
}

export class InsightDto {
  @ApiProperty({
    example: 'churn-cohort-2026-08',
    description: 'Stable across runs for the same dataset, so a dismissal could persist in a real build.',
  })
  id!: string;

  @ApiProperty({ enum: ['churn', 'revenue', 'utilisation', 'membership', 'engagement'] })
  kind!: string;

  @ApiProperty({ enum: ['critical', 'elevated', 'informational'] })
  severity!: string;

  @ApiProperty({ example: 'Dues exposure is concentrated in a small elevated-risk cohort' })
  headline!: string;

  @ApiProperty({
    example: 'Thirty-one members sit at elevated risk or worse, carrying [[e:1a2b3c4d5e6f7a8b|$412k]] in annual dues.',
    description:
      'Prose with `[[e:evidenceId|figure]]` citation markers. Every marker was recomputed from source before this response was built; the renderer turns each one into a click-through receipt.',
  })
  narrative!: string;

  @ApiProperty({ example: 'Have the Membership Director call the eleven critical-band members this week.' })
  recommendation!: string;

  @ApiProperty({
    type: [EvidenceDto],
    description: 'Every computation behind the narrative, complete with the source row ids.',
  })
  evidence!: EvidenceDto[];

  @ApiProperty({
    type: VerificationReportDto,
    description:
      'A blocked insight is returned rather than filtered out. Hiding it would make the feed look perfect while suppressing the single most important signal this system produces - that something in the pipeline is lying.',
  })
  verification!: VerificationReportDto;

  @ApiProperty({
    example: 'dues-at-risk',
    description: 'Which detector fired, named so a reviewer can find it in the source.',
  })
  detector!: string;

  @ApiProperty({ example: '2026-08-26T09:41:12.004Z' })
  detectedAt!: string;

  @ApiProperty({ type: [SuggestedActionDto] })
  suggestedActions!: SuggestedActionDto[];
}

export class InsightFeedResponseDto {
  @ApiProperty({ type: [InsightDto] })
  items!: InsightDto[];

  @ApiProperty({ example: 6, description: 'Insights that fired. An empty feed is a valid answer - a quiet club should produce a quiet screen.' })
  total!: number;

  @ApiProperty({ example: 6 })
  verified!: number;

  @ApiProperty({ example: 0, description: 'Insights whose own narrative failed recomputation. Should be zero; is reported rather than assumed.' })
  blocked!: number;

  @ApiProperty({ example: 'a3f1c0d21e9b4477', description: 'Dataset fingerprint these insights were detected against.' })
  datasetFingerprint!: string;
}
