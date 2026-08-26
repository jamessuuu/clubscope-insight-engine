import { ApiProperty } from '@nestjs/swagger';

/**
 * The one error shape this API ever returns.
 *
 * A client that has to branch on which of three error envelopes came back is a client that
 * will get it wrong, so the filter in `common/filters/all-exceptions.filter.ts` normalises
 * everything — framework 404s, validation failures, tool argument errors and unhandled
 * exceptions — into exactly this. `path` and `timestamp` are included because the first
 * question about a failed request is always "which one, and when".
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 400, description: 'HTTP status code, mirrored in the response status.' })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request', description: 'Short, stable machine-readable reason.' })
  error!: string;

  @ApiProperty({
    example: ['page must not be less than 1'],
    description:
      'Human-readable detail. An array when a validation pipe reports several failures at once.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];

  @ApiProperty({ example: '/members?page=0' })
  path!: string;

  @ApiProperty({ example: '2026-08-26T09:41:12.004Z' })
  timestamp!: string;
}
