// @covers DetailPane
// @covers DetailPaneContainer
// @covers ObservatoryView
// DEFECT-006 — the KEY regression guard. The drill-down detail pane was built
// IN-FLOW inside .observatory-main-col (the same column as the wide value-stream
// map) with position:sticky — opening it appended +690px to the column and grew
// the page scrollHeight, reflowing the dashboard on the CORE navigate job.
//
// The fix makes the pane a NON-MODAL right-anchored FLOATING drawer
// (position:fixed, z-index above the map, removed from the column's flow). So:
//   - the value-stream map's bounding box is IDENTICAL open vs closed,
//   - .observatory-main-col height is unchanged,
//   - page scrollHeight is unchanged (the in-flow +690px must be 0),
//   - the drawer floats ABOVE the map (intentional z-index overlap), anchored
//     right, fits the viewport (no horizontal scroll), left of nothing but the map
//     (paneBox.left ≥ tree-rail right edge — no rail overlap).
//
// AC-S005-3-7 / GEO-S005-3b. A map-bbox-ONLY guard missed the in-flow break
// because the pane stacked vertically below the map; the column-height /
// page-reflow assertions are what catch it.
import { test, expect } from '@playwright/test';

const NODE = '[data-item-id="UC-S004-1"] > .tree-node__row';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('work-item-tree')).toBeVisible();
  await expect(page.locator('[data-item-id="UC-S004-1"]')).toBeVisible();
});

test('AC-S005-3-7 / GEO-S005-3b — opening the pane does NOT reflow the value-stream map', async ({
  page,
}) => {
  // CLOSED geometry
  await expect(page.getByTestId('detail-pane')).toHaveCount(0);
  const mapClosed = await page.getByTestId('value-stream-map').boundingBox();
  const closed = await page.evaluate(() => ({
    col: Math.round(
      document.querySelector('.observatory-main-col').getBoundingClientRect().height,
    ),
    scroll: document.documentElement.scrollHeight,
  }));
  expect(mapClosed).toBeTruthy();

  // OPEN the pane
  await page.locator(NODE).click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();

  // OPEN geometry
  const mapOpen = await page.getByTestId('value-stream-map').boundingBox();
  const open = await page.evaluate(() => ({
    col: Math.round(
      document.querySelector('.observatory-main-col').getBoundingClientRect().height,
    ),
    scroll: document.documentElement.scrollHeight,
  }));

  // (a) map bounding box identical (≤ 1px)
  expect(Math.abs(mapOpen.x - mapClosed.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(mapOpen.y - mapClosed.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(mapOpen.width - mapClosed.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(mapOpen.height - mapClosed.height)).toBeLessThanOrEqual(1);

  // (b) main column height unchanged — the in-flow build grew this +690px
  expect(Math.abs(open.col - closed.col)).toBeLessThanOrEqual(1);

  // (c) page scrollHeight unchanged — the in-flow build grew this +690px
  expect(open.scroll).toBe(closed.scroll);
});

test('GEO-S005-3b — the drawer floats over the map, anchored right, within the viewport, not over the rail', async ({
  page,
}) => {
  await page.locator(NODE).click();
  const pane = page.getByTestId('detail-pane');
  await expect(pane).toBeVisible();

  const paneBox = await pane.boundingBox();
  const mapBox = await page.getByTestId('value-stream-map').boundingBox();
  const railBox = await page.getByTestId('work-item-tree-rail').boundingBox();
  const innerWidth = await page.evaluate(() => window.innerWidth);

  // anchored right: the pane's right edge is near the viewport's right edge
  expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(innerWidth); // no horizontal scroll
  expect(paneBox.x + paneBox.width).toBeGreaterThan(innerWidth * 0.9); // truly right-anchored

  // floats ABOVE the map — intentional overlap: the pane's left edge is INSIDE
  // the map's horizontal span (in-flow stacked below, never overlapped).
  expect(paneBox.x).toBeLessThan(mapBox.x + mapBox.width);
  expect(paneBox.x).toBeGreaterThan(mapBox.x);

  // never over the tree rail (GEO-S005-3)
  expect(paneBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 1);

  // fixed-position drawer: position resolves to fixed
  const position = await pane.evaluate((el) => getComputedStyle(el).position);
  expect(position).toBe('fixed');
});
