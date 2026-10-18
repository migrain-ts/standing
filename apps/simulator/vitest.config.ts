import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['../../packages/db/src/test-global-setup.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
    pool: 'forks',
    execArgv: ['--expose-gc'], // vitest 5: top-level execArgv (poolOptions was removed); the memory-ceiling test calls gc()
  },
});
