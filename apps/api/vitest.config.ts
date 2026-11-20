import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      AI_PROVIDER: 'mock',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mice_app:mice_app@localhost:5432/mice_test',
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://postgres@localhost:5432/mice_test',
      PUBLIC_BASE_URL: '',
      GUEST_DATA_KEY: 'test-guest-key',
      PUBLIC_RATE_LIMIT: '1000',
    },
  },
});
