import { ApiProperty } from '@nestjs/swagger';

export class RowCountsDto {
  @ApiProperty({ example: 420 }) members!: number;
  @ApiProperty({ example: 61_884 }) transactions!: number;
  @ApiProperty({ example: 55_310 }) visits!: number;
  @ApiProperty({ example: 96 }) events!: number;
  @ApiProperty({ example: 3_204 }) registrations!: number;
  @ApiProperty({ example: 1_180 }) notes!: number;
  @ApiProperty({ example: 122_094 }) total!: number;
}

export class DatasetHealthDto {
  @ApiProperty({
    example: 'a3f1c0d21e9b4477',
    description:
      'Identity of the loaded dataset: a hash of the club record and every collection size. Two responses carrying the same fingerprint were computed against the same rows.',
  })
  fingerprint!: string;

  @ApiProperty({ example: 20260901, description: 'Generator seed. Fixed, so runs are reproducible.' })
  seed!: number;

  @ApiProperty({ example: '2024-09-01', description: 'Inclusive first date covered by the data.' })
  from!: string;

  @ApiProperty({ example: '2026-08-31', description: 'Inclusive last date covered by the data.' })
  to!: string;

  @ApiProperty({ type: RowCountsDto })
  rows!: RowCountsDto;
}

export class AssistantHealthDto {
  @ApiProperty({
    enum: ['live', 'replay'],
    example: 'replay',
    description:
      'live when a model key is configured; replay when the assistant answers from scripted turns. Tool execution, evidence and verification are real in both modes.',
  })
  mode!: 'live' | 'replay';

  @ApiProperty({
    example: false,
    description:
      'Whether a model API key is present in the environment. The key itself is never read into a response, logged, or exposed by any endpoint.',
  })
  modelKeyConfigured!: boolean;
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: '@clubscope/api' })
  service!: string;

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({ example: 12.4, description: 'Process uptime in seconds. Near zero on a cold serverless invocation.' })
  uptimeSeconds!: number;

  @ApiProperty({ type: DatasetHealthDto })
  dataset!: DatasetHealthDto;

  @ApiProperty({ example: 16, description: 'Analysis tools currently registered.' })
  toolsRegistered!: number;

  @ApiProperty({ type: AssistantHealthDto })
  assistant!: AssistantHealthDto;
}
