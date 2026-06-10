// @covers VsmContainer
// @covers LiveStatusDot
// UC-S004-6 — value-stream LIVE-DRIVE browser spec. A REAL browser (chromium)
// driving the FULL deployed path on the CONSOLIDATED single server (:3001):
//   SPA (Vite middleware) → SPA client EventSource (/api/events, SAME ORIGIN)
//   → read layer → chokidar watch of OBSERVATORY_REPO_ROOT (the fixture repo).
//
// This proves what jsdom + the VsmContainer unit pins CANNOT: the REAL
// EventSource transport (same-origin /api/events, CSP connect-src, browser
// event ordering) and the genuine end-to-end latency from a ledger.csv append
// to a re-rendered stage throughput — with NO manual reload.
//
// A node ws/fetch probe would be a FALSE GREEN here (it runs below the
// browser's transport/security layer); the live drive is a real browser.
//
// METHOD (no fixed sleep): MUTATE the watched fixture ledger.csv (append one
// engineer task_start row, 3 → 4), then POLL the rendered engineer-throughput
// metric via Playwright's auto-retrying expect with a tight timeout, measuring
// wall-clock latency. The ledger is RESTORED in afterEach (even on failure) so
// the committed fixture and the deterministic UC2/3/4/5 specs stay clean.
//
// These specs MUTATE a shared fixture file and restore it, so they must NOT run
// concurrently with each other or the deterministic value-stream specs that
// read the same ledger. Serialise this file (config is fullyParallel).
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

test.describe.configure({ mode: 'serial' });

const HERE = dirname(fileURLToPath(import.meta.url));
// The read layer watches e2e/fixtures/repo (OBSERVATORY_REPO_ROOT, set in
// playwright.config.js). The demo ledger has 3 engineer task_start rows
// (throughput 3); appending a 4th, for a fresh item, makes it 4 and the SSE
// change frame must re-fetch /stage-flow and re-render the engineer count live.
const LEDGER = resolve(HERE, 'fixtures', 'repo', 'process', 'dora', 'ledger.csv');
// A fresh in/out pair appended atomically would change the count by 1; we only
// append a single task_start (an in-flight item) — throughput counts task_start
// (in-events), so this is a +1 delta with no risk of a partial-line read flap
// (one whole line written in one writeFileSync).
const APPENDED_ROW =
  '2026-06-09T02:00:00Z,demo,1,s-demo,engineer,task_start,,na,LIVE-1,live-drive append,UC-LIVE,engineer';

let original;

test.beforeEach(async ({ page }) => {
  original = readFileSync(LEDGER, 'utf8');
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('stage-engineer')).toBeVisible();
});

test.afterEach(async () => {
  // Restore the committed fixture so counts stay deterministic for every other spec.
  if (original !== undefined) writeFileSync(LEDGER, original);
});

test('AC6.1/AC6.2 — appending an engineer row to ledger.csv updates the throughput live (3→4) within budget, no reload', async ({
  page,
}) => {
  const throughput = page
    .getByTestId('stage-engineer')
    .getByTestId('metric-engineer-throughput');
  await expect(throughput).toContainText('3'); // baseline fixture state

  const start = Date.now();
  // Mutate the watched fixture: append one whole engineer task_start row.
  writeFileSync(LEDGER, `${original.trimEnd()}\n${APPENDED_ROW}\n`);

  // Poll (auto-retrying) for the live re-render — NO page.reload(), NO fixed sleep.
  await expect(throughput).toContainText('4', { timeout: 4000 });
  const latency = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(`[UC-S004-6] live-update latency: ${latency}ms`);
  expect(latency).toBeLessThan(3000);
});

test('the live-status indicator is present and announces the connected state (non-colour cue)', async ({
  page,
}) => {
  const dot = page.getByTestId('live-status');
  await expect(dot).toBeVisible();
  await expect(dot).toHaveAttribute('role', 'status');
  // text is the AUTHORITATIVE cue (not colour-only); EventSource is open on :3001
  await expect(dot).toContainText(/live/i);
});

test('@a11y A11Y-10 — under prefers-reduced-motion the live update lands with a 0s transition (no animation)', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto('/');
    const eng = page.getByTestId('stage-engineer');
    await expect(eng).toBeVisible();
    const throughput = eng.getByTestId('metric-engineer-throughput');
    await expect(throughput).toContainText('3');

    // The node's update transition collapses to 0s under reduced-motion (A11Y-10).
    const dur = await eng.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(dur).toBe('0s');

    // And the live update still lands (count changes), just without animation.
    writeFileSync(LEDGER, `${original.trimEnd()}\n${APPENDED_ROW}\n`);
    await expect(throughput).toContainText('4', { timeout: 4000 });
  } finally {
    await context.close();
  }
});
