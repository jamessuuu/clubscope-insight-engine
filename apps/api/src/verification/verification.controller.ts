import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { API_TAGS } from '../app.constants';
import { TOOL_REGISTRY, verifyNarrative, type Evidence, type VerificationReport } from '../clubscope-core';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { VerificationReportDto } from '../common/dto/evidence.dto';
import { DatasetService } from '../dataset/dataset.service';
import { VerifyRequestDto } from './dto/verify.dto';

/**
 * The gate, exposed on its own.
 *
 * Everything else in this API runs the verifier on the caller's behalf and hands back the
 * result. This endpoint hands over the verifier itself, so the central claim of the
 * prototype can be attacked directly rather than taken on trust: take an Evidence record
 * from `POST /tools/{name}/run`, cite it in a sentence with a number that is *wrong*, and
 * watch the report come back `blocked` with the true value beside the fabricated one.
 */
@ApiTags(API_TAGS.verification)
@Controller('verify')
export class VerificationController {
  constructor(private readonly datasets: DatasetService) {}

  @Post()
  // 200: verification is a pure computation over the submitted narrative. Nothing is stored.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-derive every cited figure in a narrative from source',
    description: [
      'Each citation is checked by re-executing the named tool with the named arguments against the live dataset and comparing the result to the figure the prose actually claims. Recomputation, rather than trusting the evidence carried in the request, is what makes the check meaningful: a tampered or stale payload cannot pass.',
      '',
      'The comparison is rounding-aware. `$1.2M` legitimately asserts a value in [1.15M, 1.25M), so it is accepted for 1,241,880; `420` asserts exactly 420. A naive verifier would either reject readable prose or wave through real fabrication - this one infers the precision the writer claimed and holds them to it.',
      '',
      '**What this does and does not prove.** It proves the numbers in the prose came from the data. It does not prove the tool logic is correct (that is what the tools\' unit tests are for), nor that the right tool was chosen for the question (that is what the eval suite measures). Three guarantees, three mechanisms; any system claiming one gate covers all three is overselling.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: VerificationReportDto,
    description: 'Returned for both outcomes. A blocked narrative is a successful verification, not a failed request.',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  verify(@Body() body: VerifyRequestDto): VerificationReport {
    // The DTO carries only what the verifier consumes plus optional passthrough fields; the
    // cast is safe because recomputation reads `tool`, `toolVersion` and `params` and
    // nothing else. Anything the caller invented in the other fields is ignored by design.
    const evidence = new Map<string, Evidence>(
      body.evidence.map((e) => [e.id, e as unknown as Evidence]),
    );

    return verifyNarrative({
      narrative: body.narrative,
      evidence,
      dataset: this.datasets.dataset(),
      tools: TOOL_REGISTRY,
    });
  }
}
