import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { API_TAGS, API_VERSION } from '../app.constants';
import { DEFAULT_SEED, TOOL_REGISTRY } from '../clubscope-core';
import { DatasetService } from '../dataset/dataset.service';
import { HealthResponseDto } from './dto/health.dto';

@ApiTags(API_TAGS.health)
@Controller('health')
export class HealthController {
  constructor(private readonly datasets: DatasetService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness plus a statement of what this instance is serving',
    description:
      'Answers three questions a reviewer actually has: is it up, which dataset is loaded, ' +
      'and is the assistant running live or on scripted replay. The model API key is ' +
      'reported only as a boolean — it is never returned, logged, or echoed anywhere.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): HealthResponseDto {
    const ds = this.datasets.dataset();
    // Presence only. Reading the value into a response body — even truncated — is how keys
    // end up in screenshots and log aggregators.
    const modelKeyConfigured = (process.env.ANTHROPIC_API_KEY ?? '').trim() !== '';

    return {
      status: 'ok',
      service: '@clubscope/api',
      version: API_VERSION,
      uptimeSeconds: Number(process.uptime().toFixed(1)),
      dataset: {
        fingerprint: this.datasets.fingerprint(),
        seed: DEFAULT_SEED,
        from: ds.club.dataFrom,
        to: ds.club.dataTo,
        rows: this.datasets.rowCounts(),
      },
      toolsRegistered: TOOL_REGISTRY.size,
      assistant: {
        mode: modelKeyConfigured ? 'live' : 'replay',
        modelKeyConfigured,
      },
    };
  }
}
