import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    setupFiles: ['test/login-limit.setup.ts'],
    globals: true,
    include: [
      'test/kafka-rag.integration-spec.ts',
      'test/worker-shutdown.integration-spec.ts',
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
