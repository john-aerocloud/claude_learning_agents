/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Emit to build/ (relative to app/) so the workflow artifact path
    // (app/build/) and S3 sync steps (build/ and build/static/) align.
    outDir: 'build',
    assetsDir: 'static',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Playwright specs live under tests/smoke and run against the deployed URL;
    // they must not be picked up by the Vitest unit runner.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
  },
});
