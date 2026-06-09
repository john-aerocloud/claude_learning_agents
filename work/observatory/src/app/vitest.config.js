import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Vitest (jsdom) config for unit + component tests. Playwright browser specs
// live under e2e/ and are excluded here (run via `npm run test:browser`).
// CI uses `vitest run` (never bare `vitest`) — no watch-mode hang.
export default defineConfig({
  plugins: [preact()],
  define: {
    // Mirror the Vite build-time define so component code referencing the build
    // identity does not throw under Vitest.
    __COMMIT_SHA__: JSON.stringify(process.env.VITE_COMMIT_SHA || 'test'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    exclude: ['node_modules/**', 'e2e/**', 'dist/**'],
    setupFiles: ['src/test-setup.js'],
  },
});
