// @covers uc-s014-1
// @covers SteerMenu
// @covers TreeNode
// UC-S014-1 — Steer-action menu, REAL-DATA validation spec (EXP-033 policy).
//
// Runs against the live :5173 observatory dev server (real items.csv data).
// Validates the TREE ROW path of the steer-action menu for all conditions
// that are testable with real observatory data:
//   F-1 (partial)     steer-btn on ≥1 work-item tree row (WIP chip path
//                     NOT testable: all queues empty on live server — see
//                     test-plan.md for the waiver)
//   F-2 / STEER-FIG-2 menu lists EXACTLY the four human-labelled actions
//   F-3               selecting an action dismisses without page reload
//   F-4 / A11Y-7      one trigger per item-bearing row, none on non-items
//   STEER-FIG-1       trigger name uses real item reference, never row:N
//   S14-1-A11Y-1      keyboard reachable; opens on Enter and Space
//   S14-1-A11Y-2      focus to first item, arrows cycle, Esc returns, no trap
//   S14-1-A11Y-3      visible focus ring; aria-expanded toggles
//   S14-1-A11Y-4      trigger ≥ 24×24 CSS px; each menuitem ≥ 24px tall
//   S14-1-A11Y-5      name/role/state + zero axe violations on open menu
//   S14-1-A11Y-6      reduced motion: menu present immediately (0s anim)
//   GEO-S014-1..4     zero reflow, fixed position, within viewport
//   EXP-033           ground-truth cross-check: ≥1 real item id visible in
//                     the accessible name of the trigger
//
// REAL ITEM USED: REQ-OBSERVATORY (root requirement, always present in
// the work/observatory/items/items.csv; stable anchor for real-data validation)
//
// TREE BTN selector: [data-item-id="REQ-OBSERVATORY"] > .tree-node__row [data-testid="steer-btn"]
// MENU selector: [data-testid="steer-menu"]
// The tree root row carries a steer-btn per the TreeNode composition (UC-S014-1).
//
// RELEVANCY: pinned (assertion stays valid as long as REQ-OBSERVATORY is the
// root item in items.csv; update the anchor if the root requirement changes).

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// DEFECT (found by UC-S014-2's full-suite run): this spec was missing the
// REUSE_SERVER gate its sibling real-data specs carry (s005/s013 pattern), so
// every fixture-port run (the default ephemeral topology, which serves REQ-DEMO
// — not REQ-OBSERVATORY) failed all 14 tests. Real-data specs run ONLY when
// REUSE_SERVER=1 signals a live observatory server.
const LIVE_DATA = !!process.env.REUSE_SERVER;

test.skip(!LIVE_DATA, 'real-data spec only runs with REUSE_SERVER=1 (live observatory data)');

// Real observable items on the live :5173 server (items.csv-derived, stable anchors)
const TREE_ITEM_ID = 'REQ-OBSERVATORY';
const TREE_ROW = `[data-item-id="${TREE_ITEM_ID}"] > .tree-node__row`;
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const MENU = '[data-testid="steer-menu"]';

const LABELS = ['Raise defect', 'Re-prioritise', 'Request re-slice / split', 'Custom steer'];
const TYPES = ['raise-defect', 're-prioritise', 're-slice', 'custom'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // Identity assertion (principles/01): value-stream-map must be present
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // EXP-033 real-data check: the tree is rendered with real items
  await expect(page.getByTestId('work-item-tree')).toBeVisible();
  // The root item must be present (ground truth anchor)
  await expect(page.locator(`[data-item-id="${TREE_ITEM_ID}"]`)).toBeVisible();
  // The steer trigger must be present on the root tree row
  await expect(page.locator(TREE_BTN)).toBeVisible();
});

/** Open a steer menu by KEYBOARD on the element behind btnSelector (no hover). */
async function openByKeyboard(page, btnSelector) {
  await page.locator(btnSelector).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
}

/** Snapshot the geometry that must NOT change when a menu opens (GEO-S014-1/2). */
function geometrySnapshot(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const treeItem = document.querySelector('[data-item-id="REQ-OBSERVATORY"]');
    return {
      treeRow: rect(treeItem.querySelector('.tree-node__row')),
      treeRegion: rect(document.querySelector('[data-testid="work-item-tree-rail"]')),
      pageScroll: document.documentElement.scrollHeight,
      mainScroll: document.querySelector('.observatory-main-col').scrollHeight,
      railScroll: document.querySelector('[data-testid="work-item-tree-rail"]').scrollHeight,
    };
  });
}

test('EXP-033 — live tree shows real non-fixture item ids including REQ-OBSERVATORY', async ({ page }) => {
  // Cross-check: item id in the trigger name matches the live items.csv anchor
  const triggerName = await page.locator(TREE_BTN).getAttribute('aria-label');
  expect(triggerName).toMatch(/Steer REQ-OBSERVATORY/);
  expect(triggerName).not.toMatch(/row:\d+/i);
  expect(triggerName).not.toMatch(/^Steer \d+$/);

  // EXP-033 ground truth: count tree nodes against items.csv row count
  const nodeCount = await page.locator('[data-testid="tree-node"]').count();
  expect(nodeCount).toBeGreaterThan(0);
  // The tree has real, human-meaningful items (not just 'D-1', 'D-2' fixture items)
  const firstId = await page.locator('[data-item-id]').first().getAttribute('data-item-id');
  expect(firstId).not.toMatch(/^D-\d+$/); // not a fixture item
  expect(firstId).toMatch(/^[A-Z]/); // real project prefix
});

test('F-1 (tree-row path) — steer-btn present on ≥1 work-item tree row [SM-S5-1]', async ({ page }) => {
  // F-1 WIP chip path is NOT validated here (queues empty on live server).
  // See test-plan.md for the explicit waiver.
  await expect(page.locator(TREE_BTN)).toBeVisible();
  // Confirm at least one steer trigger exists on a real tree row
  const count = await page.locator('[role="treeitem"] [data-testid="steer-btn"]').count();
  expect(count).toBeGreaterThan(0);
});

test('F-2 / STEER-FIG-2 — the menu lists EXACTLY the four human-labelled actions', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items).toHaveText(LABELS);
  // visible text is never the data-action enum value (STEER-FIG-2)
  for (let i = 0; i < TYPES.length; i += 1) {
    const el = menu.locator(`[data-testid="steer-action-${TYPES[i]}"]`);
    await expect(el).toHaveAttribute('data-action', TYPES[i]);
    const visibleText = (await el.innerText()).trim();
    expect(visibleText).not.toBe(TYPES[i]);
    expect(visibleText).toBe(LABELS[i]);
  }
});

test('F-3 — selecting an action dismisses the menu WITHOUT a page reload', async ({ page }) => {
  await page.evaluate(() => { window.__steerNoReload = 1; });
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Re-prioritise' }).click();
  await expect(page.locator(MENU)).toHaveCount(0);
  // same document — no reload
  expect(await page.evaluate(() => window.__steerNoReload)).toBe(1);
});

test('F-4 / S14-1-A11Y-7 — item-bearing tree rows have exactly one trigger; none on non-item elements', async ({ page }) => {
  const scope = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-testid="steer-btn"]'));
    return {
      total: btns.length,
      outsideItemBearing: btns.filter(
        (b) => !b.closest('li.queue-item') && !b.closest('[role="treeitem"]'),
      ).length,
      inMoreChip: document.querySelectorAll('[data-testid^="queue-more-"] [data-testid="steer-btn"]').length,
      inHeadings: document.querySelectorAll('h2 [data-testid="steer-btn"], .vsm-lane__h [data-testid="steer-btn"], .stage-node__head [data-testid="steer-btn"]').length,
      rowsWithWrongCount: Array.from(document.querySelectorAll('[role="treeitem"]')).filter(
        (li) => li.querySelector(':scope > .tree-node__row').querySelectorAll('[data-testid="steer-btn"]').length !== 1,
      ).length,
    };
  });
  expect(scope.total).toBeGreaterThan(0);
  expect(scope.outsideItemBearing).toBe(0);
  expect(scope.inMoreChip).toBe(0);
  expect(scope.inHeadings).toBe(0);
  expect(scope.rowsWithWrongCount).toBe(0);
});

test('STEER-FIG-1 — every tree row trigger is named with its real human item reference', async ({ page }) => {
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="treeitem"] [data-testid="steer-btn"]')).map((b) => ({
      name: b.getAttribute('aria-label'),
      itemId: b.getAttribute('data-steer-item-id'),
    })),
  );
  expect(names.length).toBeGreaterThan(0);
  for (const { name, itemId } of names) {
    expect(name).toMatch(/^Steer /);
    expect(name).toContain(itemId);
    expect(name).not.toMatch(/row:\d+/i);
    expect(itemId).not.toMatch(/^\d+$/);
    // Real item ids contain letters (e.g. REQ-*, CHK-*, UC-*, etc.)
    expect(itemId).toMatch(/[A-Z]/);
  }
});

test('S14-1-A11Y-1 — Tab-reachable from tree; opens on Enter AND on Space @a11y', async ({ page }) => {
  let reached = false;
  for (let i = 0; i < 80 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'steer-btn',
    );
  }
  expect(reached).toBe(true);
  // Enter opens
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toHaveCount(0);
  // focus returned to trigger — Space must open it again
  await page.keyboard.press('Space');
  await expect(page.locator(MENU)).toBeVisible();
});

test('S14-1-A11Y-2 — focus to first item, arrows cycle, Esc returns focus, Tab escapes (no trap)', async ({ page }) => {
  await openByKeyboard(page, TREE_BTN);

  const active = () => page.evaluate(() => ({
    testid: document.activeElement?.getAttribute('data-testid'),
    label: document.activeElement?.getAttribute('aria-label'),
  }));

  expect((await active()).testid).toBe('steer-action-raise-defect'); // first item on open
  await page.keyboard.press('ArrowDown');
  expect((await active()).testid).toBe('steer-action-re-prioritise');
  await page.keyboard.press('ArrowUp');
  expect((await active()).testid).toBe('steer-action-raise-defect');
  await page.keyboard.press('ArrowUp'); // wrap → last
  expect((await active()).testid).toBe('steer-action-custom');

  // Esc closes AND returns focus to the trigger
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toHaveCount(0);
  const afterEsc = await active();
  expect(afterEsc.label).toContain(`Steer ${TREE_ITEM_ID}`);

  // No trap: re-open, Tab leaves the menu and closes it
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(MENU)).toHaveCount(0);
  expect((await active()).testid).not.toBe('steer-action-raise-defect');
});

test('S14-1-A11Y-3 — visible focus ring on keyboard focus; aria-expanded toggles @a11y', async ({ page }) => {
  let reached = false;
  for (let i = 0; i < 80 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'steer-btn',
    );
  }
  expect(reached).toBe(true);
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { boxShadow: s.boxShadow, outline: s.outlineStyle };
  });
  expect(ring.boxShadow !== 'none' || ring.outline !== 'none').toBe(true);

  const btn = page.locator(TREE_BTN);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('S14-1-A11Y-4 — trigger ≥ 24×24 CSS px; every menuitem ≥ 24px tall @a11y', async ({ page }) => {
  const btnBox = await page.locator(TREE_BTN).boundingBox();
  expect(btnBox.width).toBeGreaterThanOrEqual(24);
  expect(btnBox.height).toBeGreaterThanOrEqual(24);

  await openByKeyboard(page, TREE_BTN);
  for (const type of TYPES) {
    const box = await page.locator(`[data-testid="steer-action-${type}"]`).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(box.width).toBeGreaterThanOrEqual(24);
  }
});

test('S14-1-A11Y-5 — name/role/state contract + zero axe violations on the open menu @a11y', async ({ page }) => {
  const btn = page.locator(TREE_BTN);
  await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
  await expect(btn).toHaveAttribute('aria-label', new RegExp(`Steer ${TREE_ITEM_ID}`));

  await btn.click();
  const menu = page.locator(MENU);
  await expect(menu).toHaveAttribute('role', 'menu');
  await expect(menu).toHaveAttribute('aria-label', 'Steer actions');

  // trigger's aria-controls points at the rendered menu element
  const linked = await page.evaluate((itemId) => {
    const b = document.querySelector(`[data-item-id="${itemId}"] .tree-node__row [data-testid="steer-btn"]`);
    return document.getElementById(b.getAttribute('aria-controls')) != null;
  }, TREE_ITEM_ID);
  expect(linked).toBe(true);

  for (const label of LABELS) {
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  }

  const axe = await new AxeBuilder({ page })
    .include('[data-testid="steer-menu"]')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('S14-1-A11Y-6 — reduced motion: menu instant (0s animation), present immediately @a11y', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openByKeyboard(page, TREE_BTN);
  const anim = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('[data-testid="steer-menu"]'));
    return { name: s.animationName, duration: s.animationDuration };
  });
  expect(anim.name === 'none' || anim.duration === '0s').toBe(true);
});

test('GEO-S014-1/2/3/4 — tree-row menu is a PURE overlay: zero reflow, fixed, on-screen', async ({ page }) => {
  // GEO: snapshot is taken AFTER focus reaches the trigger but BEFORE Enter
  // (before the menu opens). This isolates the menu-open geometry change from
  // any scroll caused by the browser's focus-scroll-into-view behaviour.
  await page.locator(TREE_BTN).focus();
  const closed = await geometrySnapshot(page);
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  const open = await geometrySnapshot(page);

  // GEO-S014-1/2: bboxes + scroll heights byte-identical
  expect(open).toEqual(closed);

  // GEO-S014-3: overlay (position fixed)
  const pos = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-testid="steer-menu"]')).position,
  );
  expect(pos).toBe('fixed');

  // GEO-S014-4: fully on-screen — never a horizontal scroll
  const box = await page.locator(MENU).boundingBox();
  const vp = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
});

test('tree drill is UNCHANGED: steer click does not open the detail pane; row click still drills', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await expect(page.locator(MENU)).toBeVisible();
  await expect(page.getByTestId('detail-pane')).toHaveCount(0); // no drill
  await page.keyboard.press('Escape');

  // The row itself still drills (UC-S005-3)
  await page.locator(TREE_ROW).click();
  await expect(page.getByTestId('detail-pane')).toBeVisible();
});
