import { Logger } from '@nestjs/common';

import { DEFAULT_PORT, SWAGGER_PATH } from './app.constants';
import { createApp } from './bootstrap';

/**
 * Local entry point. The serverless entry lives in `api/index.ts` and shares `createApp()`,
 * so the two deployments cannot drift apart in how the application is configured.
 */
async function main(): Promise<void> {
  const app = await createApp();
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`ClubScope Insight Engine API listening on http://localhost:${port}`);
  logger.log(`OpenAPI documentation at http://localhost:${port}/${SWAGGER_PATH}`);
}

main().catch((error: unknown) => {
  // Failing loudly and exiting non-zero matters: a process that logs a stack trace and then
  // sits there is a health check that passes while nothing works.
  new Logger('Bootstrap').error('Failed to start', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
