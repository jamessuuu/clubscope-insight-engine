import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { API_TAGS } from '../app.constants';
import type { Evidence } from '../clubscope-core';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { EVIDENCE_VALUE_DTOS, EvidenceDto } from '../common/dto/evidence.dto';
import { RunToolRequestDto, ToolCatalogueResponseDto } from './dto/tool.dto';
import { ToolsService } from './tools.service';

/**
 * The grounding layer, exposed directly.
 *
 * Most AI demos ask you to trust that a number came from the data. These two endpoints are
 * the answer to that: the catalogue shows exactly what the assistant is able to compute, and
 * running a tool returns the Evidence record — value, unit, derivation in plain English, and
 * the ids of the precise rows consumed. A reviewer can therefore check any figure in this
 * product without reading a line of the source.
 */
@ApiTags(API_TAGS.tools)
@ApiExtraModels(...EVIDENCE_VALUE_DTOS)
@Controller('tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  @ApiOperation({
    summary: 'The analysis tool registry',
    description:
      'The complete set of computations available to the assistant. The boundary is the point: a question that cannot be expressed as a call into this registry is a question the assistant must decline rather than improvise. Each entry carries an `exampleParams` set that is valid against the loaded dataset, so it can be pasted straight into the run endpoint below.',
  })
  @ApiOkResponse({ type: ToolCatalogueResponseDto })
  catalogue(): ToolCatalogueResponseDto {
    return this.tools.catalogue();
  }

  @Post(':name/run')
  // 200 rather than 201: this executes a pure read-only computation and creates nothing.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute one analysis tool and receive its Evidence',
    description:
      'Tools are pure functions of (params, dataset). The same arguments produce the same Evidence id on any machine and in any month, which is what makes the verifier’s recomputation meaningful rather than decorative. Bad arguments are rejected by the tool itself and returned as a 400 carrying its own message.',
  })
  @ApiParam({ name: 'name', example: 'revenue_total', description: 'Tool name from GET /tools.' })
  @ApiOkResponse({ type: EvidenceDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'The tool rejected those arguments.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No tool by that name is registered.' })
  run(@Param('name') name: string, @Body() body: RunToolRequestDto): Evidence {
    return this.tools.run(name, body.params ?? {});
  }
}
