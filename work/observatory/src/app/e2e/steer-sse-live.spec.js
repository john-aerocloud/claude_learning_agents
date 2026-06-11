// @covers uc-s014-4
// @covers useSteerContext
// @covers ContextRefreshCue
// @covers SubscribeEvents
// UC-S014-4 — the SSE live-refresh drive (F-4 / PROMPT-FREEZE-1 / S14-4-SSE-1
// / GEO-S014-4-4): a REAL items.csv change, through the REAL EventSource in a
// REAL browser, refreshes the steer context block IN PLACE while the displayed
// prompt stays byte-frozen until an explicit Generate press, and the
// ContextRefreshCue announces the divergence.
//
// LIVE-MUTATION ISOLATION: this spec MUTATES a watched fixture file, which —
// since UC-S014-4 — makes every open steer panel on the same server re-fetch
// /items (contaminating the zero-network pins in parallel workers). So it
// targets the DEDICATED live-mutation server (playwright.config webServer #2,
// LIVE_PORT) watching the per-run throwaway fixture copy
// (e2e/fixtures/repo-live-tmp, recreated by global-setup.mjs). The shared
// read-only fixture is never written.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const E2E_PORT = Number(process.env.OBSERVATORY_E2E_PORT || 5173);
const LIVE_PORT = Number(process.env.OBSERVATORY_E2E_LIVE_PORT || E2E_PORT + 50);
test.use({
  baseURL: `http://localhost:${LIVE_PORT}`,
  permissions: ['clipboard-read', 'clipboard-write'],
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ITEMS_CSV = resolve(HERE, 'fixtures', 'repo-live-tmp', 'work', 'demo', 'items', 'items.csv');

const TREE_ROW = '[data-item-id="REQ-DEMO"] > .tree-node__row';
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const OUTPUT = '[data-testid="prompt-output"]';
const CUE = '[data-testid="steer-context-live"]';

const INTENT = 'sse probe: the context refreshes live, the prompt stays frozen';
const REQ_DEMO_ACTIVE = 'Demo requirement for the work-item tree e2e,active';
const REQ_DEMO_PAUSED = 'Demo requirement for the work-item tree e2e,paused';

/** Flip REQ-DEMO's state cell on the CURRENT file bytes (read-modify-write). */
function flipReqDemoState(from, to) {
  const now = readFileSync(ITEMS_CSV, 'utf8');
  if (now.includes(from)) writeFileSync(ITEMS_CSV, now.replace(from, to));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.locator(TREE_ROW)).toBeVisible();
});

test('F-4 / PROMPT-FREEZE-1 / S14-4-SSE-1 / GEO-4 — a REAL items.csv change refreshes the context block ONLY; Generate refreshes the prompt; cue announces the divergence', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-raise-defect"]').click();
  await expect(page.getByTestId('steer-context')).toBeVisible();
  await page.getByTestId('intent-note').fill(INTENT);
  await page.getByTestId('steer-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();

  await expect(page.getByTestId('steer-ctx-state')).toHaveText('active');
  await expect(page.locator(CUE)).toHaveAttribute('data-state', 'live');
  const frozen = await page.locator(OUTPUT).textContent();
  expect(frozen).toContain('active'); // /defect template carries item_state

  try {
    // MUTATE the watched (throwaway) fixture: REQ-DEMO active → paused
    flipReqDemoState(REQ_DEMO_ACTIVE, REQ_DEMO_PAUSED);

    // S14-4-SSE-1: the context block re-renders to the new state, live
    await expect(page.getByTestId('steer-ctx-state')).toHaveText('paused', { timeout: 4000 });
    // PROMPT-FREEZE-1: the displayed prompt did NOT move
    expect(await page.locator(OUTPUT).textContent()).toBe(frozen);
    // EXP-036 cue: the operator is TOLD the prompt and context diverged
    await expect(page.locator(CUE)).toHaveAttribute('data-state', 'updated');
    await expect(page.locator(CUE)).toContainText(/regenerate to refresh the prompt/i);

    // GEO-S014-4-4: the context block kept its stacked-list geometry post-refresh
    const tops = await page.$$eval('[data-testid^="steer-ctx-"]', (els) =>
      els.map((el) => el.getBoundingClientRect().top));
    for (let i = 1; i < tops.length; i += 1) expect(tops[i]).toBeGreaterThan(tops[i - 1]);
    const lefts = await page.$$eval('[data-testid^="steer-ctx-"]', (els) =>
      els.map((el) => el.getBoundingClientRect().left));
    for (const l of lefts) expect(l).toBe(lefts[0]);

    // an EXPLICIT Generate regenerates from the refreshed context; cue → live
    await page.getByTestId('steer-generate').click();
    await expect(page.locator(OUTPUT)).toContainText('paused');
    await expect(page.locator(CUE)).toHaveAttribute('data-state', 'live');
  } finally {
    // restore by flipping BACK on current bytes (throwaway copy, but keep the
    // file coherent for any later test in this worker)
    flipReqDemoState(REQ_DEMO_PAUSED, REQ_DEMO_ACTIVE);
  }
});
