import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest transpiles with esbuild by default, and esbuild cannot emit `design:paramtypes`
 * metadata. Without it Nest's constructor injection has nothing to resolve and — more
 * quietly dangerous — `ValidationPipe` cannot discover a handler's DTO class, so every
 * request would sail through unvalidated and the validation tests would pass for the wrong
 * reason. SWC does emit that metadata, so it replaces esbuild for this project.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    // Generating the ~120,000-row dataset and scoring 420 members happens once per test
    // file; the default 5s timeout is tuned for unit tests, not for that.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each spec file boots a complete application over the ~120,000-row dataset. Running six
    // of those concurrently is a memory spike that buys no useful wall-clock time and can
    // take a worker down mid-run, which reads as a flaky test rather than as the resource
    // problem it is. Sequential files, deliberately.
    fileParallelism: false,
  },
});
