// @covers WorkItemTreeContainer
// @covers ZoomBreadcrumb
// @covers DetailPaneContainer
// @covers workItemTree
// UC-S005-6 browser spec — a REAL browser (Playwright/chromium) driving the FULL
// deployed path: SPA → SPA client EventSource → read layer (fixture repo,
// project demo, work/demo/items/items.csv). This proves what jsdom CANNOT:
//   1. the REAL EventSource transport (CSP connect-src, browser event ordering)
//      from a filesystem change on items.csv to a live tree re-render with NO
//      page reload (AC-S005-6-2), and
//   2. the zoom-out breadcrumb rendering the full root→selected ancestry path of
//      a drilled UC node in a real DOM, each ancestor a zoom-out control
//      (AC-S005-6-1, A11Y-S005-5).
//
// A node ws/fetch probe would give a FALSE GREEN for (1) — it runs below the
// browser transport/security layer — so the live drive is a real browser.
//
// METHOD (mirrors live-refresh.spec.js): NO fixed sleep — MUTATE the watched
// fixture items.csv, then POLL the rendered node count via auto-retrying expect
// with a tight timeout, measuring wall-clock latency. The fixture is RESTORED in
// afterEach (even on failure) so the committed fixture and the deterministic
// UC-S005-2/3 specs are never left dirty.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

// These specs MUTATE the shared fixture items.csv and restore it, so they must
// NOT run concurrently with each other or the other tree/pane specs that read
// the same file. Serialise this file (config is fullyParallel).
test.describe.configure({ mode: 'serial' });

const HERE = dirname(fileURLToPath(import.meta.url));
const ITEMS_CSV = resolve(HERE, 'fixtures', 'repo', 'work', 'demo', 'items', 'items.csv');

let original;

test.beforeEach(async ({ page }) => {
  original = readFileSync(ITEMS_CSV, 'utf8');
  await page.goto('/');
  await expect(page.getByTestId('work-item-tree')).toBeVisible();
  await expect(page.locator('[data-item-id="REQ-DEMO"]')).toBeVisible();
});

test.afterEach(async () => {
  // Restore the fixture so node counts stay deterministic for the other specs.
  if (original !== undefined) writeFileSync(ITEMS_CSV, original);
});

test('AC-S005-6-2 — appending a row to items.csv re-renders the tree live (no reload)', async ({
  page,
}) => {
  await expect(page.getByTestId('tree-node')).toHaveCount(7); // baseline fixture

  const start = Date.now();
  // Mutate the watched fixture: append a new UC row under CHK-4.
  writeFileSync(
    ITEMS_CSV,
    `${original.trimEnd()}\nUC-D4-2,use-case,CHK-4,,Live-append probe row,ready,LOW,1,1.00,2026-06-10T00:00:00Z,,\n`,
  );

  // Poll (auto-retrying) for the live re-render — NO page reload, NO fixed sleep.
  await expect(page.getByTestId('tree-node')).toHaveCount(8, { timeout: 4000 });
  await expect(page.locator('[data-item-id="UC-D4-2"]')).toBeVisible();
  const latency = Date.now() - start;
  console.log(`[UC-S005-6] tree live-update latency: ${latency}ms`);
  expect(latency).toBeLessThan(3000);
});

test('AC-S005-6-1 — drilling a UC opens the pane with the full ancestry breadcrumb path', async ({
  page,
}) => {
  // Drill into the deep UC node UC-D1-1 (REQ-DEMO ▸ CHK-1 ▸ UC-D1-1).
  await page.locator('[data-item-id="UC-D1-1"] > .tree-node__row').click();
  const crumb = page.getByTestId('breadcrumb');
  await expect(crumb).toBeVisible();
  // The full root→selected path is legible as labelled nav (A11Y-S005-5).
  await expect(crumb).toHaveAttribute('aria-label', 'Zoom path');
  const ids = await crumb.getByTestId('crumb').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-crumb-id')),
  );
  expect(ids).toEqual(['REQ-DEMO', 'CHK-1', 'UC-D1-1']);
  // The current (selected) crumb is marked aria-current; ancestors are not.
  const current = crumb.getByTestId('crumb').last();
  await expect(current).toHaveAttribute('aria-current', 'page');
});

test('AC-S005-6-1 — clicking an ancestor crumb zooms OUT, reframing the pane on that ancestor', async ({
  page,
}) => {
  await page.locator('[data-item-id="UC-D1-1"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toHaveAttribute('aria-label', 'Item detail: UC-D1-1');
  // click the CHK-1 ancestor crumb's zoom-out control
  const chkCrumb = page.getByTestId('breadcrumb').locator('[data-crumb-id="CHK-1"] button');
  await chkCrumb.click();
  await expect(page.getByTestId('detail-pane')).toHaveAttribute('aria-label', 'Item detail: CHK-1');
  await expect(page.locator('[data-item-id="CHK-1"]')).toHaveAttribute('aria-selected', 'true');
});

test('AC-S005-6-4 — "Back to map" closes the drawer; the value-stream map stays present', async ({
  page,
}) => {
  await page.locator('[data-item-id="UC-D1-1"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  await page.getByTestId('back-to-map').click();
  await expect(page.getByTestId('detail-pane')).toHaveCount(0);
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
});
