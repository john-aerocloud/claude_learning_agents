// @covers DetailPane
// @covers DetailPaneContainer
// @covers ObservatoryView
// @covers itemDetail
// UC-S005-3 browser spec — a REAL browser (Playwright/chromium) driving the FULL
// drill path through the single Vite server (SPA + /api on :5173, fixture repo
// project "demo"): tree-node click → slug derivation (itemDetail) → real HTTP
// GET /api/projects/demo/slices + /slices/:slug/slice.md → raw artifact rendered
// in the detail pane. This proves what jsdom cannot — the real same-origin fetch,
// the real focus management, and GEO-S005-3 (pane left edge ≥ tree rail right
// edge) with real layout boxes.
//
// Fixture: UC-S004-1 is slice-backed (slug s004-value-stream-map); its slice.md
// carries UNIQUE-FIXTURE-MARKER-S004.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('work-item-tree')).toBeVisible();
  await expect(page.locator('[data-item-id="UC-S004-1"]')).toBeVisible();
});

test('AC-S005-3-1 — clicking a node opens the detail pane as a labelled region', async ({ page }) => {
  await expect(page.getByTestId('detail-pane')).toHaveCount(0); // closed initially
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  const pane = page.getByTestId('detail-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toHaveAttribute('role', 'region');
  await expect(pane).toHaveAttribute('aria-label', 'Item detail: UC-S004-1');
});

test('slice-backed node fetches + renders its REAL slice.md as MARKDOWN HTML (UC-S005-4)', async ({ page }) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  const view = page.getByTestId('artifact-view');
  await expect(view).toBeVisible();
  // the real fixture artifact text reached the screen via same-origin HTTP
  await expect(view).toContainText('UNIQUE-FIXTURE-MARKER-S004');
  // UC-S005-4 / AC-S005-3-2: rendered as semantic HTML (a heading), not a raw <pre> blob
  await expect(view.locator('h1').first()).toBeVisible();
  await expect(view.locator(':scope > pre')).toHaveCount(0);
  // breadcrumb shows the item id (AC-S005-3-5)
  await expect(page.getByTestId('breadcrumb')).toContainText('UC-S004-1');
});

test('AC-S005-4-1/4-2 — markdown table renders as <table>, fenced code as <code> (UC-S005-4)', async ({ page }) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  const view = page.getByTestId('artifact-view');
  await expect(view).toBeVisible();
  await expect(view.locator('table')).toHaveCount(1); // AC-S005-4-1
  await expect(view.locator('code').first()).toBeVisible(); // AC-S005-4-2
});

test('AC-S005-3-3 / A11Y-S005-10 — a fenced ```mermaid block renders as an SVG (role=img + aria-label) (UC-S005-4)', async ({ page }) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  const host = page.getByTestId('mmd-render');
  await expect(host).toBeVisible();
  const svg = host.locator('svg');
  await expect(svg).toBeVisible({ timeout: 10000 }); // real mermaid render is async
  await expect(svg).toHaveAttribute('role', 'img');
  await expect(svg).toHaveAttribute('aria-label', /.+/);
});

test('AC-S005-5-1/5-2/5-3 — item history shows the item ledger rows readably, newest-first (UC-S005-5)', async ({ page }) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  const history = page.getByTestId('item-history');
  await expect(history).toBeVisible();
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(2); // FIX-14 + FIX-15 for UC-S004-1 (history-panel fixture rows)
  // AC-S005-5-3: readable fields — agent + event visible, NOT a bare row:N index
  await expect(history).toContainText('flow-manager');
  await expect(history).toContainText('note');
  await expect(history).not.toContainText(/\brow:\d+/);
  // AC-S005-5-2: newest-first — first row's timestamp >= last row's
  const firstTs = await rows.first().getAttribute('data-timestamp');
  const lastTs = await rows.last().getAttribute('data-timestamp');
  expect(Date.parse(firstTs)).toBeGreaterThanOrEqual(Date.parse(lastTs));
});

test('AC-S005-5-4 — a node with no ledger rows shows the "no history" placeholder, no crash (UC-S005-5)', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // UC-D4-1 has no ledger rows in the fixture
  await page.locator('[data-item-id="UC-D4-1"] > .tree-node__row').click();
  const history = page.getByTestId('item-history');
  await expect(history).toBeVisible();
  await expect(history).toContainText(/no history/i);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('AC-S005-3-4 — a non-slice node (REQ) shows the "not yet available" placeholder, no console error', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.locator('[data-item-id="REQ-DEMO"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  await expect(page.getByTestId('artifact-view')).toContainText(/not yet available/i);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('GEO-S005-3 — pane left edge ≥ tree rail right edge (no illegible overlap)', async ({ page }) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  const rail = await page.getByTestId('work-item-tree-rail').boundingBox();
  const pane = await page.getByTestId('detail-pane').boundingBox();
  expect(rail && pane).toBeTruthy();
  expect(pane.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1); // pane starts at/after rail's right edge
  expect(pane.width).toBeGreaterThan(0);
});

test('GEO-S005-4 — selected node is visually linked to the open pane (aria-selected)', async ({ page }) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  await expect(page.locator('[role="treeitem"][data-item-id="UC-S004-1"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('AC-S005-3-6 / A11Y-S005-3 — "Back to map" closes the pane, surfaces the map, returns focus to the originating tree node (DEFECT-006)', async ({
  page,
}) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  await page.getByTestId('back-to-map').click();
  await expect(page.getByTestId('detail-pane')).toHaveCount(0);
  // "Back to map" still surfaces the map (AC-S005-3-6)
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // DEFECT-006 revision: focus returns to the ORIGINATING tree node (the treeitem
  // that was clicked), not the map — the non-modal drawer drops the keyboard user
  // back where they were so they can drill the next sibling without re-traversing.
  const focusedItem = await page.evaluate(
    () => document.activeElement?.closest('[role="treeitem"]')?.getAttribute('data-item-id'),
  );
  expect(focusedItem).toBe('UC-S004-1');
});

test('Esc closes the pane and returns focus to the originating tree node (DEFECT-006)', async ({
  page,
}) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-pane')).toHaveCount(0);
  const focusedItem = await page.evaluate(
    () => document.activeElement?.closest('[role="treeitem"]')?.getAttribute('data-item-id'),
  );
  expect(focusedItem).toBe('UC-S004-1');
});

test('× close button returns focus to the originating tree node (DEFECT-006)', async ({ page }) => {
  await page.locator('[data-item-id="UC-S004-1"] > .tree-node__row').click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  await page.getByTestId('detail-pane-close').click();
  await expect(page.getByTestId('detail-pane')).toHaveCount(0);
  const focusedItem = await page.evaluate(
    () => document.activeElement?.closest('[role="treeitem"]')?.getAttribute('data-item-id'),
  );
  expect(focusedItem).toBe('UC-S004-1');
});
