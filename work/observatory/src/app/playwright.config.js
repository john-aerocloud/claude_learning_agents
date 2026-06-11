import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Playwright config for Observatory browser specs (CHK-2: chromium only).
// Specs live under e2e/. baseURL is the single Vite server on :5173.
//
// TOPOLOGY: ONE command (`npm run dev` in work/observatory/src/app) launches
// Vite on :5173 which serves BOTH the SPA (with HMR) AND all /api/* routes via
// the observatoryApiPlugin. Same-origin requests — no CORS needed.
//
// The read layer is pointed at a committed deterministic fixture repo
// (e2e/fixtures/repo) via OBSERVATORY_REPO_ROOT, so counts are stable
// (intake 3 / ready 1 starving / deploy 0 / rework 2) and the GEO/A11Y
// assertions never flap on the live repo.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = resolve(HERE, 'e2e', 'fixtures', 'repo');

// DEFECT-009 — WIP is now recency-bounded (30-min horizon). The fixture ledger's
// single in-flight open (CHK-4 task_start @ 2026-06-09T01:00:00Z, no end) would
// age past the horizon under a live Date.now() and silently drop to wip=0,
// breaking the in-flight-badge specs. Pin the read-time `now` to 15 min after
// that open so the fixture's in-flight node renders deterministically (every
// other open in the fixture has its matching close, so only CHK-4 is WIP).
const FIXTURE_NOW = '2026-06-09T01:15:00Z';

// EPHEMERAL-PORT SUPPORT (UC-S005-3): default is :5173 (the single dev topology).
// Set OBSERVATORY_E2E_PORT to run the spec server on a different port WITHOUT
// touching an operator's running :5173 — Playwright then launches its own Vite
// on that port (against the fixture repo) and tears it down after the run.
const E2E_PORT = Number(process.env.OBSERVATORY_E2E_PORT || 5173);

// LIVE-MUTATION ISOLATION (UC-S014-4): specs that MUTATE watched fixture
// files (the SSE live-refresh drives: steer-sse-live, work-item-tree-live)
// target a SECOND server on LIVE_PORT watching a per-run THROWAWAY COPY of
// the fixture repo (e2e/fixtures/repo-live-tmp, recreated by
// e2e/global-setup.mjs each run — an interrupted mutation can never leak).
// Rationale: since UC-S014-4 an items.csv change frame re-fetches /items in
// every OPEN steer panel, so a parallel-worker write to the SHARED fixture
// breaks the zero-network pins (steer-prompt AC-4 / steer-copy F-1)
// non-deterministically. One mutating server + one read-only server — no
// cross-worker write contamination, by construction.
const LIVE_PORT = Number(process.env.OBSERVATORY_E2E_LIVE_PORT || E2E_PORT + 50);
const FIXTURE_REPO_LIVE = resolve(HERE, 'e2e', 'fixtures', 'repo-live-tmp');

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Single Vite server: SPA + API on E2E_PORT (default :5173).
      // Uses the fixture repo for deterministic counts.
      // Set REUSE_SERVER=1 to reuse a pre-running server on a non-default port
      // (e.g. a live :5203 server for real-data validation runs).
      command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
      cwd: HERE,
      port: E2E_PORT,
      // When running on a non-default port we ALWAYS start our own (never reuse),
      // UNLESS REUSE_SERVER=1 is set (for real-data tester validation against a
      // pre-started ephemeral server).
      reuseExistingServer: (E2E_PORT === 5173 && !process.env.CI) || !!process.env.REUSE_SERVER,
      timeout: 60_000,
      env: { OBSERVATORY_REPO_ROOT: FIXTURE_REPO, OBSERVATORY_NOW: FIXTURE_NOW },
    },
    {
      // LIVE-MUTATION server (UC-S014-4 isolation): same app, own port, own
      // throwaway fixture copy. Only the live-mutation specs navigate here
      // (they hard-code this baseURL via OBSERVATORY_E2E_LIVE_PORT/E2E_PORT+50).
      // Never reused — its fixture must be the fresh per-run copy.
      command: `npm run dev -- --port ${LIVE_PORT} --strictPort`,
      cwd: HERE,
      port: LIVE_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { OBSERVATORY_REPO_ROOT: FIXTURE_REPO_LIVE, OBSERVATORY_NOW: FIXTURE_NOW },
    },
  ],
});
