import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Vitest config for Observatory — covers BOTH:
//   src/**/__tests__/**/*.test.{js,jsx}  — SPA unit + component tests (jsdom)
//   server/__tests__/**/*.test.js        — API server tests (node)
//
// The two environments are differentiated by the `environmentMatchGlobs` option:
//   - server/__tests__/**  → 'node' (no DOM; real fs/http/chokidar)
//   - everything else      → 'jsdom' (component testing with @testing-library)
//
// CI uses `vitest run` (never bare `vitest`) — no watch-mode hang.
export default defineConfig({
  plugins: [preact()],
  define: {
    // Mirror the Vite build-time define so component code referencing the build
    // identity does not throw under Vitest.
    __COMMIT_SHA__: JSON.stringify(process.env.VITE_COMMIT_SHA || 'test'),
  },
  test: {
    // Default environment for SPA tests.
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/__tests__/**/*.test.{js,jsx}',
      'server/__tests__/**/*.test.js',
    ],
    exclude: ['node_modules/**', 'e2e/**', 'dist/**'],
    setupFiles: ['src/test-setup.js'],
    // Override environment per glob — server tests run in node, not jsdom.
    environmentMatchGlobs: [
      ['server/__tests__/**', 'node'],
    ],
  },
});
