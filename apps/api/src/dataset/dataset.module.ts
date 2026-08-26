import { Global, Module } from '@nestjs/common';

import { DatasetService } from './dataset.service';

/**
 * Global because the dataset is genuinely a singleton read model: every feature module
 * needs it, and there is exactly one correct instance. Marking it `@Global()` is the
 * honest expression of that, rather than importing the same module into six others and
 * pretending they are independent.
 */
@Global()
@Module({
  providers: [DatasetService],
  exports: [DatasetService],
})
export class DatasetModule {}
