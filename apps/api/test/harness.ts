import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { createApp } from '../src/bootstrap';

/**
 * Boots the real application, configured exactly as `main.ts` and the serverless entry
 * configure it.
 *
 * Deliberately not a hand-assembled `TestingModule` with a hand-applied validation pipe.
 * Tests that build their own approximation of the app verify the approximation: the pipe
 * options, the exception filter and the OpenAPI document are part of the behaviour under
 * test, and the fastest way to ship a broken 400 is to test against a pipeline that does not
 * have the real one in it.
 *
 * Vitest isolates each test file's module graph, so this promise is a per-file singleton:
 * one boot per spec file, and `close()` in that file cannot pull the app out from under
 * another.
 */
let booting: Promise<INestApplication> | null = null;

export function testApp(): Promise<INestApplication> {
  booting ??= createApp().then(async (app) => {
    await app.init();
    return app;
  });
  return booting;
}

export async function testServer(): Promise<Server> {
  const app = await testApp();
  return app.getHttpServer() as Server;
}

export async function closeTestApp(): Promise<void> {
  if (booting === null) return;
  const app = await booting;
  booting = null;
  await app.close();
}
