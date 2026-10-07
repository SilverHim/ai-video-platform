import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', environment: 'node', include: ['src/shared/**/*.test.ts'] } },
      { test: { name: 'server', environment: 'node', include: ['src/server/**/*.test.ts', 'tests/**/*.test.ts'], exclude: ['tests/e2e/**'] } },
      { test: { name: 'web', environment: 'happy-dom', include: ['src/web/**/*.test.{ts,tsx}'] } },
    ],
  },
});
