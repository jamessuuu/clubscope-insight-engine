import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { EvidenceDto, VerificationReportDto } from '../../common/dto/evidence.dto';

export class ScriptedTurnSummaryDto {
  @ApiProperty({ example: 'dining-decline' })
  id!: string;

  @ApiProperty({ example: 'Why is dining revenue down?' })
  question!: string;

  @ApiProperty({ example: 'Revenue', description: 'Grouping label for the question library.' })
  topic!: string;

  @ApiProperty({ example: true, description: 'Whether this shows as a starter chip on the Ask page.' })
  suggested!: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when the correct answer is a refusal - a question outside the data coverage. The refusals are load-bearing: an assistant that cannot decline is untrustworthy on the questions it can answer, because the user has no way to tell the two apart.',
  })
  refusal!: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when the turn deliberately corrupts one figure to demonstrate the verifier blocking it. Used by the reliability panel, never in the normal Ask flow.',
  })
  poisoned!: boolean;

  @ApiProperty({
    type: [String],
    example: ['revenue_total', 'revenue_trend'],
    description: 'The analysis tools this turn executes, in order.',
  })
  tools!: string[];
}

export class TurnLibraryResponseDto {
  @ApiProperty({ example: 12 })
  count!: number;

  @ApiProperty({
    enum: ['live', 'replay'],
    example: 'replay',
    description: 'Mirrors GET /health. Replay when no model API key is configured.',
  })
  mode!: string;

  @ApiProperty({ type: [ScriptedTurnSummaryDto] })
  turns!: ScriptedTurnSummaryDto[];
}

export class AskRequestDto {
  @ApiProperty({
    example: 'dining-decline',
    description: 'Id of a turn from GET /assistant/turns.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  turnId!: string;
}

export class NarrativeSegmentDto {
  @ApiProperty({ enum: ['text', 'figure'] })
  kind!: string;

  @ApiProperty({ example: '$381k' })
  text!: string;

  @ApiPropertyOptional({
    example: '9655f4a4bed82b8b',
    description: 'Present on figure segments. The UI hangs a click-through receipt off this.',
  })
  evidenceId?: string;
}

export class ToolCallRecordDto {
  @ApiProperty({ example: 'revenue_total' })
  name!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  params!: Record<string, unknown>;

  @ApiPropertyOptional({ example: '9655f4a4bed82b8b' })
  evidenceId?: string;

  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiPropertyOptional({ example: '"from" is not a parseable ISO date: 2026-13-01' })
  error?: string;

  @ApiProperty({ example: 3 })
  ms!: number;
}

export class ProposedActionDto {
  @ApiProperty({ example: '6f1c2f1e-1f7a-4a2e-9a1e-6c1a2f1e9a1e' })
  id!: string;

  @ApiProperty({
    enum: ['create_task', 'draft_member_outreach', 'flag_member_for_review', 'schedule_report'],
  })
  kind!: string;

  @ApiProperty({ example: 'Create task: Call the eleven critical-band members → Membership Director' })
  title!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  args!: Record<string, unknown>;

  @ApiProperty({ description: 'Why the assistant thinks this is warranted, shown so a human can disagree.' })
  rationale!: string;

  @ApiProperty({
    enum: ['low', 'medium', 'high'],
    description: 'Reversibility, which is what should drive confirmation friction - not how impressive the action sounds.',
  })
  impact!: string;

  @ApiProperty({ example: '2026-08-26T09:41:12.004Z' })
  proposedAt!: string;
}

export class UsageDto {
  @ApiProperty({ example: 0 })
  inputTokens!: number;

  @ApiProperty({ example: 0 })
  outputTokens!: number;
}

export class AssistantTurnDto {
  @ApiProperty({
    enum: ['answered', 'blocked'],
    description: 'Blocked when verification failed. A blocked turn is returned rather than swallowed, so the failure is visible instead of looking like an outage.',
  })
  status!: string;

  @ApiProperty({
    example: 'Dining revenue is [[e:9655f4a4bed82b8b|$381k]] over the period.',
    description: 'The narrative with citation markers intact, kept for evals and debugging.',
  })
  raw!: string;

  @ApiProperty({ type: [NarrativeSegmentDto], description: 'The same narrative split for rendering.' })
  segments!: NarrativeSegmentDto[];

  @ApiProperty({ type: VerificationReportDto })
  verification!: VerificationReportDto;

  @ApiProperty({ type: [EvidenceDto] })
  evidence!: EvidenceDto[];

  @ApiProperty({ type: [ToolCallRecordDto] })
  toolCalls!: ToolCallRecordDto[];

  @ApiProperty({
    type: [ProposedActionDto],
    description:
      'Actions are proposed, never executed. The model composes a fully-formed action; a human approves it; the audit log records who approved what and on whose suggestion. Nothing here has run.',
  })
  proposedActions!: ProposedActionDto[];

  @ApiProperty({ type: UsageDto, description: 'Token spend. Replay spends none and reports none.' })
  usage!: UsageDto;

  @ApiProperty({
    enum: ['anthropic', 'replay'],
    description: 'Which provider actually served this turn. Surfaced rather than hidden.',
  })
  servedBy!: string;

  @ApiProperty({ example: false, description: 'True when a first attempt failed verification and the single repair round ran.' })
  repaired!: boolean;

  @ApiProperty({ example: 18 })
  totalMs!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'The conversation as it actually happened, with no synthetic tool_use blocks implying a model chose these calls.',
  })
  messages!: unknown[];
}
