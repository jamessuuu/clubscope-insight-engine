import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class ToolParamDto {
  @ApiProperty({ example: 'from' })
  name!: string;

  @ApiProperty({ enum: ['string', 'number', 'boolean', 'enum'], example: 'string' })
  type!: string;

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({
    example: 'Inclusive start of the period, ISO date (YYYY-MM-DD).',
    description: 'Written for a language model to read, because tool *selection* is the one part of this pipeline the verifier cannot check.',
  })
  description!: string;

  @ApiPropertyOptional({ type: [String], example: ['dues', 'dining', 'bar'] })
  enum?: string[];

  @ApiPropertyOptional({ example: 10 })
  default?: unknown;
}

export class ToolCatalogueEntryDto {
  @ApiProperty({ example: 'revenue_total' })
  name!: string;

  @ApiProperty({ example: '1.0.0' })
  version!: string;

  @ApiProperty({
    enum: ['read', 'act'],
    example: 'read',
    description:
      'Read tools answer questions. Acting tools are never executable from here: the assistant runtime intercepts them into proposals that a human confirms.',
  })
  kind!: string;

  @ApiProperty({ example: 'Total revenue in dollars over a date range, optionally for one category.' })
  description!: string;

  @ApiProperty({ type: [ToolParamDto] })
  params!: ToolParamDto[];

  @ApiPropertyOptional({
    enum: ['usd', 'count', 'percent', 'days', 'minutes', 'score', 'ratio', 'none'],
    nullable: true,
    example: 'usd',
    description:
      'Unit of the Evidence this tool produces. It is a property of the computation rather than of the declaration, so it is observed by running the tool once against the loaded dataset - null if that probe could not build a valid argument set.',
  })
  resultUnit!: string | null;

  @ApiPropertyOptional({
    enum: ['scalar', 'text', 'series', 'table'],
    nullable: true,
    description: 'Shape of the value the tool returns. Only `scalar` results can be cited in a narrative, because only a scalar can be compared against a written figure.',
  })
  resultKind!: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { from: '2024-09-01', to: '2026-08-31', category: 'dues' },
    description: 'A valid argument set for this tool against the loaded dataset. Paste it straight into POST /tools/{name}/run.',
  })
  exampleParams!: Record<string, unknown> | null;
}

export class ToolCatalogueResponseDto {
  @ApiProperty({
    example: 16,
    description: 'Size of the registry. This is the assistant’s entire capability surface - a question that cannot be expressed as a call into this list is one it must decline.',
  })
  count!: number;

  @ApiProperty({ type: [ToolCatalogueEntryDto] })
  tools!: ToolCatalogueEntryDto[];
}

export class RunToolRequestDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { from: '2026-02-01', to: '2026-08-31', category: 'dining' },
    description:
      'Arguments for the tool. Validated by the tool itself, which fails loudly on a bad argument rather than letting it become a NaN that flows silently into a receipt.',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
