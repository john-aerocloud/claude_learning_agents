// @covers MapContainer
// @covers LiveStatusDot
// UC-S002-6 live-refresh browser specs — a REAL browser (chromium) driving the
// FULL deployed path: SPA on :5173 → SPA client EventSource → read layer on
// :3001 (watching the committed fixture repo). This proves what jsdom CANNOT:
// the real EventSource transport (CSP connect-src, browser event ordering) and
// the genuine end-to-end latency from a filesystem change to a re-rendered count.
//
// A node ws/fetch probe would give a FALSE GREEN here (it runs below the
// browser's transport/security layer), so the live drive is a real browser.
//
// METHOD (mirrors the s001 SSE latency test approach): no fixed sleep — we
// MUTATE a watched fixture file, then POLL the rendered count via Playwright's
// auto-retrying expect with a tight timeout, and measure wall-clock latency.
// The fixture file is RESTORED in afterEach (even on failure) so the committed
// fixture and the deterministic UC3/UC4/UC5 specs are never left dirty.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

// These specs MUTATE a shared fixture file (ready.csv) and restore it, so they
// must NOT run concurrently with each other (a parallel restore would race a
// live-update assertion). Serialise this file (config is fullyParallel).
test.describe.configure({ mode: 'serial' });

const HERE = dirname(fileURLToPath(import.meta.url));
// The read layer watches e2e/fixtures/repo (OBSERVATORY_REPO_ROOT, set in
// playwright.config.js). ready.csv starts with 1 item (D-4); appending a row
// makes it 2 and the SSE change frame must re-render the Ready count live.
const READY_CSV = resolve(HERE, 'fixtures', 'repo', 'work', 'demo', 'queues', 'ready.csv');

let original;

test.beforeEach(async ({ page }) => {
  original = readFileSync(READY_CSV, 'utf8');
  await page.goto('/');
  await expect(page.getByTestId('queue-intake')).toBeVisible();
});

test.afterEach(async () => {
  // Restore the fixture so counts stay deterministic for the other specs.
  if (original !== undefined) writeFileSync(READY_CSV, original);
});

test('AC6.4 — appending a row to ready.csv updates the Ready count live within ~1s (no reload)', async ({
  page,
}) => {
  const readyCount = page.getByTestId('queue-ready').getByTestId('queue-count');
  await expect(readyCount).toHaveText('1'); // baseline fixture state

  const start = Date.now();
  // Mutate the watched fixture: append a second item row.
  writeFileSync(READY_CSV, `${original.trimEnd()}\nD-5,2\n`);

  // Poll (auto-retrying) for the live re-render — NO page reload, NO fixed sleep.
  await expect(readyCount).toHaveText('2', { timeout: 4000 });
  const latency = Date.now() - start;
  // Record the observed latency for the return; assert a generous CI ceiling.
  console.log(`[UC6] live-update latency: ${latency}ms`);
  expect(latency).toBeLessThan(3000);
});

test('the live-status indicator is present and announces the connected state (non-colour cue)', async ({
  page,
}) => {
  const dot = page.getByTestId('live-status');
  await expect(dot).toBeVisible();
  await expect(dot).toHaveAttribute('role', 'status');
  // text is the authoritative cue (not colour-only)
  await expect(dot).toContainText(/live/i);
});

test('@a11y A11Y-10 — under prefers-reduced-motion, a live update changes the count with 0s transition', async ({
  browser,
}) => {
  // A dedicated reduced-motion context so the media query is emulated for the
  // whole page lifecycle.
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto('/');
    const ready = page.getByTestId('queue-ready');
    await expect(ready).toBeVisible();
    const readyCount = ready.getByTestId('queue-count');
    await expect(readyCount).toHaveText('1');

    // The box transition is removed under reduced-motion (0s) — the count
    // changes with no animation (A11Y-10).
    const dur = await ready.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(dur).toBe('0s');

    // And the live update still lands (count changes), just without animation.
    writeFileSync(READY_CSV, `${original.trimEnd()}\nD-5,2\n`);
    await expect(readyCount).toHaveText('2', { timeout: 4000 });
  } finally {
    await context.close();
  }
});
