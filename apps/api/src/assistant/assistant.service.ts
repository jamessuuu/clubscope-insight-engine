import { Injectable, NotFoundException } from '@nestjs/common';

import {
  getTurn,
  runScriptedTurn,
  SCRIPTED_TURNS,
  TOOL_REGISTRY,
  type AssistantTurn,
} from '../clubscope-core';
import { DatasetService } from '../dataset/dataset.service';
import type { ScriptedTurnSummaryDto, TurnLibraryResponseDto } from './dto/assistant.dto';

@Injectable()
export class AssistantService {
  constructor(private readonly datasets: DatasetService) {}

  library(): TurnLibraryResponseDto {
    return {
      count: SCRIPTED_TURNS.length,
      mode: modelKeyConfigured() ? 'live' : 'replay',
      turns: SCRIPTED_TURNS.map(summarise),
    };
  }

  /**
   * Runs one scripted turn.
   *
   * What is real on every call: the tool executions, the Evidence records, the figures
   * rendered into the prose, and the full verification pass. Only the choice of tools and
   * the wording are fixed in advance. If a tool's logic changed and a figure moved, this
   * response would come back `blocked` exactly as a live model's would — which is precisely
   * why the scripted path is worth having rather than being a stub.
   */
  ask(turnId: string): AssistantTurn {
    const turn = getTurn(turnId);
    if (!turn) {
      throw new NotFoundException(
        `No scripted turn with id "${turnId}". Call GET /assistant/turns for the library.`,
      );
    }

    return runScriptedTurn({
      turn,
      dataset: this.datasets.dataset(),
      tools: TOOL_REGISTRY,
    });
  }
}

/** Presence only — the value is never read into a response, a log, or an error message. */
function modelKeyConfigured(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim() !== '';
}

function summarise(turn: (typeof SCRIPTED_TURNS)[number]): ScriptedTurnSummaryDto {
  return {
    id: turn.id,
    question: turn.question,
    topic: turn.topic,
    suggested: turn.suggested,
    refusal: turn.refusal === true,
    poisoned: turn.poison !== undefined,
    tools: turn.calls.map((call) => call.tool),
  };
}
