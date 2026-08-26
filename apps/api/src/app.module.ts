import { Module } from '@nestjs/common';

import { AssistantModule } from './assistant/assistant.module';
import { ClubModule } from './club/club.module';
import { DatasetModule } from './dataset/dataset.module';
import { HealthModule } from './health/health.module';
import { InsightsModule } from './insights/insights.module';
import { MembersModule } from './members/members.module';
import { ToolsModule } from './tools/tools.module';
import { VerificationModule } from './verification/verification.module';

/**
 * Modules follow the architecture rather than the URL space: one per layer of the grounding
 * contract, so a reader can find the verifier by looking for the thing called the verifier.
 *
 * `DatasetModule` is listed first because everything else reads through it — it is the only
 * module that knows the dataset is generated rather than fetched, which is what would make
 * swapping in a real club database a single-file change.
 */
@Module({
  imports: [
    DatasetModule,
    HealthModule,
    ClubModule,
    MembersModule,
    InsightsModule,
    ToolsModule,
    AssistantModule,
    VerificationModule,
  ],
})
export class AppModule {}
