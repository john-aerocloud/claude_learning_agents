/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // OI-25 (principles/01): inject build identity at build time so the tester
  // can gate on served-sha == deployed-sha BEFORE asserting behaviour.
  //
  // Mechanism: Vite's HTML env substitution replaces %VITE_BUILD_SHA% in
  // index.html with the value of the VITE_BUILD_SHA environment variable at
  // build time. The pipeline sets VITE_BUILD_SHA=${{ github.sha }}. Local
  // builds default to 'dev' (env var absent → Vite leaves the literal 'dev'
  // because the index.html carries the fallback).
  //
  // Exposure: <meta name="build-sha" content="<sha>"> in the served HTML.
  // Tester reads it in Playwright:
  //   await page.locator('meta[name="build-sha"]').getAttribute('content')
  // Smoke gate: assert served sha == $GITHUB_SHA before behavioural assertions
  // to ensure CDN propagation is complete (§39-correct; not sleep/wait).
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
