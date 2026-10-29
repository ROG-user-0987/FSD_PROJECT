import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests for pure utilities (formatting, permissions). No browser needed.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
