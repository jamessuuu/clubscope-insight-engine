import type { IncomingMessage, ServerResponse } from 'node:http';

import { createApp } from '../src/bootstrap';

type ExpressHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Vercel serverless entry point.
 *
 * ## Why the handler is cached, and why it is cached as a *promise*
 *
 * A Vercel function is a warm container that survives between invocations. Building the Nest
 * application is the expensive part of a request here — the module graph, the DI container
 * and the OpenAPI document all have to be constructed, and on the first request that also
 * pulls the ~120,000-row synthetic dataset into memory. Doing that once per container rather
 * than once per request turns a multi-hundred-millisecond cold start into a warm path that
 * is just Express routing.
 *
 * The cache holds the in-flight promise rather than the finished handler, which is the part
 * that is easy to get wrong. A cold container can be handed several requests before the
 * first `await` resolves; caching the resolved value would let each of them start its own
 * bootstrap, and the losers' applications would be built, never used, and never released.
 * Caching the promise makes the first caller do the work and everyone else await it.
 *
 * `app.init()` rather than `app.listen()`: the platform owns the socket. What we hand back
 * is the underlying Express instance, which is exactly the `(req, res)` function Vercel
 * expects — so the same configured application serves both deployments with no adapter and
 * no second code path to keep in step.
 */
let bootstrap: Promise<ExpressHandler> | null = null;

function handlerFor(): Promise<ExpressHandler> {
  bootstrap ??= createApp()
    .then(async (app) => {
      await app.init();
      return app.getHttpAdapter().getInstance() as ExpressHandler;
    })
    .catch((error: unknown) => {
      // Clear the cache on failure. A container that fails to boot once — a transient
      // resource limit, say — should be able to try again on the next invocation instead of
      // serving 500s for the rest of its life from a permanently rejected promise.
      bootstrap = null;
      throw error;
    });

  return bootstrap;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const express = await handlerFor();
  express(req, res);
}
