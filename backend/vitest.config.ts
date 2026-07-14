import { defineConfig } from 'vitest/config';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://lumberjack_tasks:lumberjack_tasks@127.0.0.1:5434/lumberjack_tasks_test';
// A strong, deterministic secret so the suite signs/verifies consistently (the config guard
// now rejects weak secrets in every environment, not just production).
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
// Keep the auth rate limiter effectively disabled for the general suite; the dedicated
// rate-limit regression test lowers this explicitly to exercise the 429 path.
process.env.AUTH_RATE_LIMIT_MAX = '100000';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: './tests/globalSetup.ts',
  },
});
