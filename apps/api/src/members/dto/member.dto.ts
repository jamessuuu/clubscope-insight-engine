import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { MEMBER_STATUSES, MEMBERSHIP_CATEGORIES, RISK_BANDS } from '../../clubscope-core';
import { PageMetaDto } from '../../common/dto/pagination.dto';

export class RiskDto {
  @ApiProperty({ example: 62, minimum: 0, maximum: 100 })
  score!: number;

  @ApiProperty({ enum: [...RISK_BANDS], example: 'elevated' })
  band!: string;
}

export class MemberSummaryDto {
  @ApiProperty({ example: 'm-0184' })
  id!: string;

  @ApiProperty({ example: 'WH-0184', description: 'The number staff use when they talk about a member.' })
  memberNo!: string;

  @ApiProperty({ example: 'Marguerite Ellery' })
  name!: string;

  @ApiProperty({ example: 'marguerite.ellery@example.com' })
  email!: string;

  @ApiProperty({ enum: [...MEMBERSHIP_CATEGORIES], example: 'full-golf' })
  category!: string;

  @ApiProperty({ enum: [...MEMBER_STATUSES], example: 'active' })
  status!: string;

  @ApiProperty({ example: '2016-04-11' })
  joinedAt!: string;

  @ApiProperty({ example: 10.4, description: 'Years of membership as at the dataset end date.' })
  tenureYears!: number;

  @ApiProperty({ example: 12400, description: 'Annual dues in whole dollars.' })
  annualDues!: number;

  @ApiProperty({ type: RiskDto })
  risk!: RiskDto;
}

export class MemberListResponseDto {
  @ApiProperty({ type: [MemberSummaryDto] })
  items!: MemberSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class ContributionDto {
  @ApiProperty({ example: 'Visit cadence falling' })
  signal!: string;

  @ApiProperty({
    example: 31,
    description: 'Signed points added to the score. Negative values are protective.',
  })
  points!: number;

  @ApiProperty({
    example: '4 visits in the last 90 days against a personal baseline of 10.6 - down 62%.',
    description:
      'Shown to the user verbatim. A score that drives retention spend has to be defensible to the member it describes.',
  })
  detail!: string;
}

export class ChurnAssessmentDto {
  @ApiProperty({ example: 'm-0184' })
  memberId!: string;

  @ApiProperty({
    example: '1.2.0',
    description: 'Version of the scoring model. A score without its model version is not reproducible.',
  })
  modelVersion!: string;

  @ApiProperty({ example: 62, minimum: 0, maximum: 100 })
  score!: number;

  @ApiProperty({ enum: [...RISK_BANDS], example: 'elevated' })
  band!: string;

  @ApiProperty({
    type: [ContributionDto],
    description: 'Every signal that moved the score, heaviest first. This is the entire model; nothing is hidden.',
  })
  contributions!: ContributionDto[];

  @ApiProperty({ example: '2026-08-31', description: 'The date the assessment was computed against.' })
  asOf!: string;
}

export class VisitDto {
  @ApiProperty({ example: 'v-039114' })
  id!: string;

  @ApiProperty({ example: '2026-08-19T14:05:00.000Z' })
  at!: string;

  @ApiProperty({ example: 'golf-course' })
  facility!: string;

  @ApiProperty({ example: 2 })
  guests!: number;

  @ApiProperty({ example: 245 })
  durationMin!: number;
}

export class TransactionDto {
  @ApiProperty({ example: 't-118402' })
  id!: string;

  @ApiProperty({ example: '2026-08-19' })
  date!: string;

  @ApiProperty({ example: 'dining' })
  category!: string;

  @ApiProperty({ example: 84 })
  amount!: number;
}

export class MemberNoteDto {
  @ApiProperty({ example: 'n-00412' })
  id!: string;

  @ApiProperty({ example: '2026-07-02' })
  date!: string;

  @ApiProperty({ example: 'Front Desk' })
  author!: string;

  @ApiProperty({ example: 'front-desk' })
  channel!: string;

  @ApiProperty({ enum: ['positive', 'neutral', 'negative'], example: 'negative' })
  sentiment!: string;

  @ApiProperty({ example: 'Raised the tee-time booking window again.' })
  body!: string;
}

export class SpendByCategoryDto {
  @ApiProperty({ example: 'dining' })
  category!: string;

  @ApiProperty({ example: 4820 })
  amount!: number;
}

export class MemberActivityDto {
  @ApiProperty({ example: 214, description: 'Visits across the whole coverage window.' })
  visitsTotal!: number;

  @ApiProperty({ example: 4, description: 'Visits in the 90 days ending at the dataset end date.' })
  visitsLast90Days!: number;

  @ApiPropertyOptional({ example: '2026-06-28T15:20:00.000Z', nullable: true })
  lastVisitAt!: string | null;

  @ApiProperty({ example: 11, description: 'Event registrations that were actually attended.' })
  eventsAttended!: number;

  @ApiProperty({
    type: [SpendByCategoryDto],
    description:
      'Lifetime spend split by revenue category. Dues are contractual and keep posting right up to the resignation letter, so the discretionary categories are the leading indicator.',
  })
  spendByCategory!: SpendByCategoryDto[];
}

export class MemberProfileResponseDto {
  @ApiProperty({ type: MemberSummaryDto })
  member!: MemberSummaryDto;

  @ApiProperty({ example: '35-49' })
  ageBand!: string;

  @ApiProperty({ example: 3 })
  householdSize!: number;

  @ApiProperty({ example: 'Asheville' })
  homeCity!: string;

  @ApiProperty({ example: 'referral' })
  joinedVia!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  resignedAt!: string | null;

  @ApiProperty({
    type: ChurnAssessmentDto,
    description:
      'Computed by arithmetic, not by a language model - reproducible on Tuesday and on Thursday, and decomposable when a member disputes it.',
  })
  churn!: ChurnAssessmentDto;

  @ApiProperty({ type: MemberActivityDto })
  activity!: MemberActivityDto;

  @ApiProperty({ type: [VisitDto], description: 'Twenty most recent visits, newest first.' })
  recentVisits!: VisitDto[];

  @ApiProperty({ type: [TransactionDto], description: 'Twenty most recent transactions, newest first.' })
  recentTransactions!: TransactionDto[];

  @ApiProperty({ type: [MemberNoteDto], description: 'Ten most recent staff notes, newest first.' })
  recentNotes!: MemberNoteDto[];
}
