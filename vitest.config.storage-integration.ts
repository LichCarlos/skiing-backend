import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    setupFiles: ['test/login-limit.setup.ts'],
    globals: true,
    include: ['test/**/*.storage-integration-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
