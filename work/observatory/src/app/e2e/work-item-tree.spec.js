// @covers WorkItemTree
// @covers TreeNode
// @covers SpaceTagBadge
// @covers workItemTree
// @covers WorkItemTreeContainer
// UC-S005-2 browser spec — a REAL browser (Playwright/chromium) driving the FULL
// path: SPA on :3001 → SPA client → read layer on :3001 (fixture repo, project
// demo, work/demo/items/items.csv). This proves what jsdom cannot: the REAL
// indented-hierarchy geometry (GEO-S005-1 — a child node's content left offset
// strictly exceeds its parent's, an indented tree NOT a flat list) and real
// keyboard focus movement through the roving-tabindex tree, AND that mounting
// the tree rail did NOT break the value-stream map (it stays visible).
//
// Fixture (e2e/fixtures/repo/work/demo/items/items.csv): 7 nodes —
//   REQ-DEMO → CHK-1(done) → [UC-D1-1, UC-D1-2],
//              CHK-4(in-progress) → [UC-S004-1, UC-D4-1].
// UC-S004-1 is slice-backed (slug s004-value-stream-map) for the UC-S005-3
// detail-pane spec; it does not change the REQ→CHK-1→UC-D1-1 path the geometry
// and keyboard cases below walk.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('work-item-tree')).toBeVisible();
  // wait for the live load to populate the tree from the :3001 fixture items.csv
  await expect(page.locator('[data-item-id="REQ-DEMO"]')).toBeVisible();
});

test('renders the real REQ→CHK→UC tree from the fixture items.csv (7 nodes, AC-S005-2-1/2)', async ({
  page,
}) => {
  // All branches expanded by default → all 7 nodes present.
  await expect(page.getByTestId('tree-node')).toHaveCount(7);
  await expect(page.locator('[data-item-id="CHK-1"]')).toBeVisible();
  await expect(page.locator('[data-item-id="UC-D1-1"]')).toBeVisible();
  await expect(page.locator('[data-item-id="CHK-4"]')).toBeVisible();
});

test('CHK-1 shows state done; CHK-4 shows in-progress (AC-S005-2-3, never colour-only)', async ({
  page,
}) => {
  const chk1 = page.locator('[data-item-id="CHK-1"] > .tree-node__row');
  await expect(chk1.getByTestId('state-badge')).toContainText('done');
  const chk4 = page.locator('[data-item-id="CHK-4"] > .tree-node__row');
  await expect(chk4.getByTestId('state-badge')).toContainText('in-progress');
});

test('GEO-S005-1 — tree is an INDENTED hierarchy: child left offset > parent by ≥ --tree-indent', async ({
  page,
}) => {
  // measure the rendered node LABEL content start (the id span) — the row's
  // depth-scaled padding-left shifts the content, which is what GEO-S005-1 means
  // by "content left offset" (the border-box left stays at the list edge).
  const reqRow = await page.locator('[data-item-id="REQ-DEMO"] > .tree-node__row .tree-node__id').boundingBox();
  const chkRow = await page.locator('[data-item-id="CHK-1"] > .tree-node__row .tree-node__id').boundingBox();
  const ucRow = await page.locator('[data-item-id="UC-D1-1"] > .tree-node__row .tree-node__id').boundingBox();
  expect(reqRow && chkRow && ucRow).toBeTruthy();
  // depth-1 indented past depth-0 by ≥ 16px (--tree-indent); depth-2 past depth-1
  expect(chkRow.x - reqRow.x).toBeGreaterThanOrEqual(16);
  expect(ucRow.x - chkRow.x).toBeGreaterThanOrEqual(16);
  // strictly increasing left offset with depth (not a flat list)
  expect(reqRow.x).toBeLessThan(chkRow.x);
  expect(chkRow.x).toBeLessThan(ucRow.x);
});

test('every node carries a non-empty data-space + a space-tag with visible text (AC-S005-2-4/5)', async ({
  page,
}) => {
  const nodes = page.getByTestId('tree-node');
  const count = await nodes.count();
  expect(count).toBe(7);
  for (let i = 0; i < count; i++) {
    const space = await nodes.nth(i).getAttribute('data-space');
    expect(space).toBeTruthy();
  }
  // the space-tag shows authoritative TEXT (not colour-only)
  await expect(
    page.locator('[data-item-id="REQ-DEMO"] > .tree-node__row').getByTestId('space-tag'),
  ).toContainText(/work/i);
});

test('A11Y-S005-1 — exactly ONE node tabbable; ArrowDown moves focus down the tree', async ({
  page,
}) => {
  const tabbable = page.locator('[data-testid="tree-node"][tabindex="0"]');
  await expect(tabbable).toHaveCount(1);
  // focus the root and walk down with ArrowDown
  await page.locator('[data-item-id="REQ-DEMO"]').focus();
  await page.keyboard.press('ArrowDown');
  const active1 = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-item-id'),
  );
  expect(active1).toBe('CHK-1');
});

test('node-click drill hook + value-stream map both present (composition not broken)', async ({
  page,
}) => {
  // the value-stream map (s004 primary surface) still renders beside the tree
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // clicking a UC node selects it (aria-selected) — the UC-S005-3 drill seam
  await page.locator('[data-item-id="UC-D1-1"] > .tree-node__row').click();
  await expect(page.locator('[data-item-id="UC-D1-1"]')).toHaveAttribute('aria-selected', 'true');
});
