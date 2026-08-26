import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

/**
 * The documented shape of an Evidence record.
 *
 * These classes exist for OpenAPI, not for construction: the real records are built inside
 * `@clubscope/core` by `makeEvidence`, which is the only place allowed to mint one. Keeping
 * a documentation mirror here rather than decorating the domain type is the trade that keeps
 * `packages/core` free of framework imports and independently unit-testable — the property
 * the whole grounding argument leans on.
 */

export class ScalarEvidenceValueDto {
  @ApiProperty({ enum: ['scalar'] })
  kind!: 'scalar';

  @ApiProperty({ example: 381_204.5 })
  n!: number;
}

export class TextEvidenceValueDto {
  @ApiProperty({ enum: ['text'] })
  kind!: 'text';

  @ApiProperty({ example: 'Windermere Hills Country Club' })
  s!: string;
}

export class SeriesPointDto {
  @ApiProperty({ example: '2026-03' })
  label!: string;

  @ApiProperty({ example: 48_112 })
  n!: number;
}

export class SeriesEvidenceValueDto {
  @ApiProperty({ enum: ['series'] })
  kind!: 'series';

  @ApiProperty({ type: [SeriesPointDto] })
  points!: SeriesPointDto[];
}

export class TableEvidenceValueDto {
  @ApiProperty({ enum: ['table'] })
  kind!: 'table';

  @ApiProperty({ type: [String], example: ['memberId', 'name', 'spend'] })
  columns!: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  })
  rows!: Array<Array<string | number>>;
}

export const EVIDENCE_VALUE_DTOS = [
  ScalarEvidenceValueDto,
  TextEvidenceValueDto,
  SeriesEvidenceValueDto,
  TableEvidenceValueDto,
];

export class EvidenceDto {
  @ApiProperty({
    example: '9655f4a4bed82b8b',
    description:
      'Deterministic: a hash of tool name, tool version and the canonicalised params. The same question asked twice produces the same id, which is what lets a narrative cite a computation rather than a value.',
  })
  id!: string;

  @ApiProperty({ example: 'revenue_total' })
  tool!: string;

  @ApiProperty({
    example: '1.0.0',
    description:
      'The verifier refuses to recompute across a version change rather than comparing against different logic and calling it a match.',
  })
  toolVersion!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { from: '2026-02-01', to: '2026-08-31', category: 'dining' },
    description: 'Exactly the arguments the tool was called with. Recomputation replays these.',
  })
  params!: Record<string, unknown>;

  @ApiProperty({
    description: 'The computed result. Scalars for headline figures, series or table for breakdowns.',
    oneOf: EVIDENCE_VALUE_DTOS.map((dto) => ({ $ref: getSchemaPath(dto) })),
  })
  value!: unknown;

  @ApiProperty({
    enum: ['usd', 'count', 'percent', 'days', 'minutes', 'score', 'ratio', 'none'],
    example: 'usd',
  })
  unit!: string;

  @ApiProperty({
    example:
      'Sum of transaction amounts in category "dining" between 2026-02-01 and 2026-08-31 inclusive.',
    description: 'Plain-English derivation, shown in the receipt drawer. Written for a club GM to read.',
  })
  method!: string;

  @ApiProperty({
    type: [String],
    description:
      'Ids of the exact source rows consumed. Capped at 500 for legibility - rowCount is never capped, so the receipt is readable without ever understating its own scope.',
  })
  rowIds!: string[];

  @ApiProperty({ example: 4_182, description: 'True number of rows consumed, uncapped.' })
  rowCount!: number;

  @ApiProperty({ example: '2026-08-26T09:41:12.004Z' })
  computedAt!: string;
}

export class FigureCheckDto {
  @ApiProperty({ example: '$381k', description: 'The figure exactly as the narrative wrote it.' })
  written!: string;

  @ApiPropertyOptional({ example: '9655f4a4bed82b8b' })
  evidenceId?: string;

  @ApiPropertyOptional({
    example: 381_204.5,
    description: 'What the tool returns when re-run from source, right now.',
  })
  actual?: number;

  @ApiProperty({
    enum: ['match', 'mismatch', 'unknown-evidence', 'recompute-failed', 'unsupported-shape', 'undeclared'],
    example: 'match',
    description:
      '`undeclared` means a figure appeared in prose with no citation at all, which fails the narrative just as hard as a wrong number - an uncited figure is an unverifiable one.',
  })
  outcome!: string;

  @ApiPropertyOptional({ example: 'narrative says 9999, source computes 420' })
  detail?: string;
}

export class VerificationReportDto {
  @ApiProperty({
    enum: ['verified', 'blocked'],
    description: 'Blocked if any single check failed. The gate fails closed; there is no partial pass.',
  })
  status!: string;

  @ApiProperty({ type: [FigureCheckDto] })
  checks!: FigureCheckDto[];

  @ApiProperty({ example: 3, description: 'Figures in the narrative that carried a citation.' })
  citedCount!: number;

  @ApiProperty({ example: 3, description: 'Cited figures that survived recomputation.' })
  matchedCount!: number;

  @ApiProperty({ example: 1, description: 'matchedCount / citedCount.' })
  groundedRate!: number;

  @ApiProperty({ example: 0, description: 'Figures found in prose with no citation at all.' })
  undeclaredCount!: number;

  @ApiProperty({ example: 3, description: 'Tool executions performed by this verification pass.' })
  recomputedCount!: number;

  @ApiProperty({ example: 4 })
  durationMs!: number;
}
