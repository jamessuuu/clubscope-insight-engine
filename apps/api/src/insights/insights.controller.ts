import { Controller, Get } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { API_TAGS } from '../app.constants';
import { EVIDENCE_VALUE_DTOS } from '../common/dto/evidence.dto';
import { DatasetService } from '../dataset/dataset.service';
import { InsightFeedResponseDto } from './dto/insight.dto';

@ApiTags(API_TAGS.insights)
@ApiExtraModels(...EVIDENCE_VALUE_DTOS)
@Controller('insights')
export class InsightsController {
  constructor(private readonly datasets: DatasetService) {}

  @Get()
  @ApiOperation({
    summary: 'The detected insight feed, with evidence and verification attached',
    description:
      'Insights are *detected*, not generated. Asking a model to "find something interesting" produces a different answer every run and invents a trend on a quiet week, because it was asked for a finding and will supply one. Detection here is deterministic code with explicit thresholds: it fires for a stated reason or it does not fire, and it can be regression-tested against a fixture where the right answer is known. The model narrates a fired detector; it never decides that one fired.',
  })
  @ApiOkResponse({ type: InsightFeedResponseDto })
  feed(): InsightFeedResponseDto {
    const items = this.datasets.insights();
    const verified = items.filter((i) => i.verification.status === 'verified').length;

    // Cast at the boundary: the DTO classes are an OpenAPI mirror of core's domain types,
    // structurally identical but deliberately declared here so `packages/core` never has to
    // import a web framework to be documentable.
    return {
      items: items as unknown as InsightFeedResponseDto['items'],
      total: items.length,
      verified,
      blocked: items.length - verified,
      datasetFingerprint: this.datasets.fingerprint(),
    };
  }
}
