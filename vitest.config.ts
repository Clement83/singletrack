import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    env: { INVITE_LINK_KEY: Buffer.alloc(32, 7).toString('base64') },
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts', 'src/proxy.ts', 'src/db/**/*.ts'],
      // Thresholds just below the current level (#1482): they only prevent regressions. src/lib first;
      // React components (src/components, pages) are deliberately out of scope.
      thresholds: {
        lines: 90, functions: 86, branches: 83,
        'src/lib/**': { lines: 91, functions: 91, branches: 85 },
        'src/lib/outings/**': { lines: 93, functions: 90, branches: 86 },
        'src/lib/tracks/**': { lines: 94, functions: 90, branches: 89 },
        'src/db/**': { lines: 95 },
        'src/proxy.ts': { lines: 100, branches: 100 },
      },
    },
  },
});
