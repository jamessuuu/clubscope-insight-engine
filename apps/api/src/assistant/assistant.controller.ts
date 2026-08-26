import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { API_TAGS } from '../app.constants';
import type { AssistantTurn } from '../clubscope-core';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { EVIDENCE_VALUE_DTOS } from '../common/dto/evidence.dto';
import { AssistantService } from './assistant.service';
import { AskRequestDto, AssistantTurnDto, TurnLibraryResponseDto } from './dto/assistant.dto';

const REPLAY_NOTE = [
  '**Replay mode.** With no `ANTHROPIC_API_KEY` configured the assistant answers from the',
  'scripted turn library rather than from a live model, and `GET /health` reports which mode',
  'is active. What "scripted" does and does not mean is worth being precise about, because a',
  'reviewer who finds one undisclosed limitation stops believing the disclosed parts too:',
  '',
  '- **Real on every request** — the tool calls execute against the dataset, the Evidence',
  '  records (values, methods, row ids) are computed fresh, the figures in the prose are the',
  '  values those tools actually returned, and the groundedness verifier runs its full',
  '  recomputation pass over the result. A turn whose figures stopped matching would come',
  '  back `blocked`, exactly as a live model\'s would.',
  '- **Fixed in advance** — which tools to call, and the wording of the sentences around the',
  '  figures.',
  '',
  'Every response carries `servedBy`, so the mode is never inferred.',
].join('\n');

@ApiTags(API_TAGS.assistant)
@ApiExtraModels(...EVIDENCE_VALUE_DTOS)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('turns')
  @ApiOperation({
    summary: 'The scripted question library',
    description: `The questions this assistant can be asked in replay mode, including the ones whose correct answer is a refusal.\n\n${REPLAY_NOTE}`,
  })
  @ApiOkResponse({ type: TurnLibraryResponseDto })
  turns(): TurnLibraryResponseDto {
    return this.assistant.library();
  }

  @Post('ask')
  // 200 rather than 201: asking a question creates no resource. Actions are *proposed* in
  // the response body and still require a separate human confirmation to exist at all.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask a question and receive a verified, cited answer',
    description: `Returns the complete turn: the narrative with its citation markers, the split segments for rendering, every Evidence record behind it, the tool-call trace, the verification report, and any proposed actions.\n\nActions are proposed and never executed. The model composes a fully-formed action with real arguments; a human approves it; the audit log records who approved what, when, and on whose suggestion. An assistant that can only answer is a search box with better manners, and one that can act without a gate is an unbounded liability the first time it misreads a question.\n\n${REPLAY_NOTE}`,
  })
  @ApiOkResponse({ type: AssistantTurnDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No scripted turn with that id.' })
  ask(@Body() body: AskRequestDto): AssistantTurn {
    return this.assistant.ask(body.turnId);
  }
}
