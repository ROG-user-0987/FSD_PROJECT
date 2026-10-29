import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],
    // One SQLite file shared by all test files: run them one after another.
    fileParallelism: false,
    hookTimeout: 60_000,
    // Set before the app loads; the .env loader never overrides these.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./prisma/test.db',
      CORS_ORIGIN: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    },
  },
})
