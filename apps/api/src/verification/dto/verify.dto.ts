import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * The evidence a caller submits alongside a narrative.
 *
 * Only four fields are required — `id`, `tool`, `toolVersion` and `params` — and that is the
 * whole design of the gate rather than an oversight. The verifier does not compare the
 * narrative against the `value` carried in the request; it re-executes the named tool with
 * the named params against the live dataset and compares the narrative against *that*. A
 * caller-supplied value is therefore never trusted, which is exactly what closes the loop: a
 * tampered or stale evidence payload cannot talk its way past the gate.
 *
 * The remaining fields are accepted so a full Evidence record from `POST /tools/{name}/run`
 * can be pasted in unmodified — the global pipe rejects unknown properties, and making a
 * reviewer hand-strip fields would be a pointless obstacle.
 */
export class EvidenceInputDto {
  @ApiProperty({
    example: '9655f4a4bed82b8b',
    description: 'The evidence id cited in the narrative as `[[e:<id>|<figure>]]`.',
  })
  @IsString()
  @Matches(/^[a-f0-9]{16}$/, { message: 'id must be the 16-character evidence hash' })
  id!: string;

  @ApiProperty({ example: 'member_count', description: 'Tool to re-execute. Must be in the registry.' })
  @IsString()
  @IsNotEmpty()
  tool!: string;

  @ApiProperty({
    example: '1.0.0',
    description:
      'Recomputation is refused across a version change rather than silently comparing against different logic.',
  })
  @IsString()
  @IsNotEmpty()
  toolVersion!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { status: 'active' },
    description: 'The exact arguments to replay.',
  })
  @IsObject()
  params!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Accepted so a full Evidence record can be pasted in unchanged. Deliberately not trusted.',
  })
  @IsOptional()
  value?: unknown;

  @ApiPropertyOptional({ example: 'count' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rowIds?: string[];

  @ApiPropertyOptional({ example: 420 })
  @IsOptional()
  @IsInt()
  @Min(0)
  rowCount?: number;

  @ApiPropertyOptional({ example: '2026-08-26T09:41:12.004Z' })
  @IsOptional()
  @IsISO8601()
  computedAt?: string;
}

export class VerifyRequestDto {
  @ApiProperty({
    example: 'The club has [[e:9655f4a4bed82b8b|420]] members on the roll.',
    description:
      'Prose in which every figure is written as `[[e:<evidenceId>|<figure>]]`. A figure left bare is reported as `undeclared` and fails the narrative just as hard as a wrong one - an uncited figure is an unverifiable one.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  narrative!: string;

  @ApiProperty({
    type: [EvidenceInputDto],
    description: 'The evidence the narrative cites. Anything cited but not supplied comes back as `unknown-evidence`.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EvidenceInputDto)
  evidence!: EvidenceInputDto[];
}
