// @covers uc-s014-1
// @covers SteerMenu
// @covers StageNode
// @covers TreeNode
// UC-S014-1 — Steer-action menu, REAL-BROWSER conditions (acceptance.md):
//   F-1..F-4        presence / four exact labels / select-passes-on / item-scope
//   S14-1-A11Y-1..7 keyboard reach+operate, focus order, visible ring, target
//                   size, name/role/state (+axe), reduced motion, one-per-item
//   GEO-S014-1..4   byte-identical underlying bboxes + scrollHeights with the
//                   menu open vs closed (overlay, fixed, on-screen)
//   STEER-FIG-1..2  human item reference in the name; labels never enum values
//
// Fixture repo: intake queue chips D-1..D-3, ready D-4; tree rows REQ-DEMO….
// The menu is opened via KEYBOARD (focus + Enter) in the GEO tests so the
// pointer never hovers the StageNode (hover opens its MetricSource reveal,
// which would contaminate the closed-vs-open geometry comparison).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const CHIP = '[data-testid="queued-item-intake-D-1"]';
const CHIP_BTN = `${CHIP} [data-testid="steer-btn"]`;
const TREE_ROW = '[data-item-id="REQ-DEMO"] > .tree-node__row';
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const MENU = '[data-testid="steer-menu"]';

const LABELS = ['Raise defect', 'Re-prioritise', 'Request re-slice / split', 'Custom steer'];
const TYPES = ['raise-defect', 're-prioritise', 're-slice', 'custom'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.locator(CHIP)).toBeVisible();
  await expect(page.locator(TREE_ROW)).toBeVisible();
});

/** Open a steer menu by KEYBOARD on the element behind `btnSelector` (no hover). */
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
    return {
      chips: Array.from(document.querySelectorAll('[data-testid^="queued-item-intake-"]')).map(rect),
      vsmRegion: rect(document.querySelector('[data-testid="value-stream-map"]')),
      treeRow: rect(document.querySelector('[data-item-id="REQ-DEMO"] > .tree-node__row')),
      treeRegion: rect(document.querySelector('[data-testid="work-item-tree-rail"]')),
      pageScroll: document.documentElement.scrollHeight,
      mainScroll: document.querySelector('.observatory-main-col').scrollHeight,
      railScroll: document.querySelector('[data-testid="work-item-tree-rail"]').scrollHeight,
    };
  });
}

test('F-1 — steer-btn present on a live WIP chip AND a tree row (SM-S5-1)', async ({ page }) => {
  await expect(page.locator(CHIP_BTN)).toBeVisible();
  await expect(page.locator(TREE_BTN)).toBeVisible();
});

test('F-2 / STEER-FIG-2 — the menu lists EXACTLY the four human-labelled actions', async ({ page }) => {
  await page.locator(CHIP_BTN).click();
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items).toHaveText(LABELS);
  // visible text is never the data-action enum value
  for (let i = 0; i < TYPES.length; i += 1) {
    const el = menu.locator(`[data-testid="steer-action-${TYPES[i]}"]`);
    await expect(el).toHaveAttribute('data-action', TYPES[i]);
    expect((await el.innerText()).trim()).not.toBe(TYPES[i]);
  }
});

test('F-3 — selecting an action dismisses the picker WITHOUT a page reload', async ({ page }) => {
  await page.evaluate(() => { window.__steerNoReload = 1; });
  await page.locator(CHIP_BTN).click();
  await page.getByRole('menuitem', { name: 'Re-prioritise' }).click();
  await expect(page.locator(MENU)).toHaveCount(0);
  expect(await page.evaluate(() => window.__steerNoReload)).toBe(1); // same document
});

test('F-4 / S14-1-A11Y-7 — item-bearing elements ONLY, exactly one trigger each', async ({ page }) => {
  const scope = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-testid="steer-btn"]'));
    return {
      total: btns.length,
      outsideItemBearing: btns.filter(
        (b) => !b.closest('li.queue-item') && !b.closest('[role="treeitem"]'),
      ).length,
      inMoreChip: document.querySelectorAll('[data-testid^="queue-more-"] [data-testid="steer-btn"]').length,
      inHeadings: document.querySelectorAll('h2 [data-testid="steer-btn"], .vsm-lane__h [data-testid="steer-btn"], .stage-node__head [data-testid="steer-btn"]').length,
      chipsWithWrongCount: Array.from(
        document.querySelectorAll('[data-testid^="queued-item-"]:not([data-testid^="queue-more-"])'),
      ).filter((chip) => chip.classList.contains('queue-item--more')
        ? false
        : chip.querySelectorAll('[data-testid="steer-btn"]').length !== 1).length,
      rowsWithWrongCount: Array.from(document.querySelectorAll('[role="treeitem"]')).filter(
        (li) => li.querySelector(':scope > .tree-node__row').querySelectorAll('[data-testid="steer-btn"]').length !== 1,
      ).length,
    };
  });
  expect(scope.total).toBeGreaterThan(0);
  expect(scope.outsideItemBearing).toBe(0);
  expect(scope.inMoreChip).toBe(0);
  expect(scope.inHeadings).toBe(0);
  expect(scope.chipsWithWrongCount).toBe(0);
  expect(scope.rowsWithWrongCount).toBe(0);
});

test('STEER-FIG-1 — every trigger is named with ITS human item reference, never a positional token', async ({ page }) => {
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="steer-btn"]')).map((b) => ({
      name: b.getAttribute('aria-label'),
      itemId: b.getAttribute('data-steer-item-id'),
    })),
  );
  for (const { name, itemId } of names) {
    expect(name).toMatch(/^Steer /);
    expect(name).toContain(itemId);
    expect(name).not.toMatch(/row:\d+/i);
    expect(itemId).not.toMatch(/^\d+$/);
  }
});

test('S14-1-A11Y-1 — Tab-reachable; opens on Enter AND on Space @a11y', async ({ page }) => {
  // Reach the FIRST steer trigger by keyboard alone (bounded Tab walk).
  let reached = false;
  for (let i = 0; i < 50 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'steer-btn',
    );
  }
  expect(reached).toBe(true);

  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toHaveCount(0);
  // focus returned to the trigger — Space must open it again
  await page.keyboard.press('Space');
  await expect(page.locator(MENU)).toBeVisible();
});

test('S14-1-A11Y-2 — focus to first item, arrows cycle, Esc returns focus, Tab escapes (no trap)', async ({ page }) => {
  await openByKeyboard(page, CHIP_BTN);

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
  expect((await active()).label).toContain('Steer D-1');

  // No trap: re-open, Tab leaves the menu and closes it
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(MENU)).toHaveCount(0);
  expect((await active()).testid).not.toBe('steer-action-raise-defect');
});

test('S14-1-A11Y-3 — visible focus ring on keyboard focus; aria-expanded toggles @a11y', async ({ page }) => {
  // keyboard focus → :focus-visible ring must be a real painted cue
  let reached = false;
  for (let i = 0; i < 50 && !reached; i += 1) {
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

  const btn = page.locator(CHIP_BTN);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('S14-1-A11Y-4 — trigger ≥ 24×24 CSS px; every menuitem ≥ 24px tall @a11y', async ({ page }) => {
  const btnBox = await page.locator(CHIP_BTN).boundingBox();
  expect(btnBox.width).toBeGreaterThanOrEqual(24);
  expect(btnBox.height).toBeGreaterThanOrEqual(24);

  await openByKeyboard(page, CHIP_BTN);
  for (const type of TYPES) {
    const box = await page.locator(`[data-testid="steer-action-${type}"]`).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(box.width).toBeGreaterThanOrEqual(24);
  }
});

test('S14-1-A11Y-5 — name/role/state contract + zero axe violations on the open menu @a11y', async ({ page }) => {
  const btn = page.locator(CHIP_BTN);
  await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
  await expect(btn).toHaveAttribute('aria-label', /Steer D-1/);

  await btn.click();
  const menu = page.locator(MENU);
  await expect(menu).toHaveAttribute('role', 'menu');
  await expect(menu).toHaveAttribute('aria-label', 'Steer actions');
  // trigger's aria-controls points at the rendered menu element
  const linked = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="queued-item-intake-D-1"] [data-testid="steer-btn"]');
    return document.getElementById(b.getAttribute('aria-controls')) != null;
  });
  expect(linked).toBe(true);
  for (let i = 0; i < LABELS.length; i += 1) {
    await expect(menu.getByRole('menuitem', { name: LABELS[i], exact: true })).toBeVisible();
  }

  const axe = await new AxeBuilder({ page })
    .include('[data-testid="steer-menu"]')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('S14-1-A11Y-6 — reduced motion: menu instant (0s animation), present immediately @a11y', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openByKeyboard(page, CHIP_BTN);
  const anim = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('[data-testid="steer-menu"]'));
    return { name: s.animationName, duration: s.animationDuration };
  });
  expect(anim.name === 'none' || anim.duration === '0s').toBe(true);
});

test('GEO-S014-1/2/3/4 — chip menu is a PURE overlay: zero reflow, fixed, on-screen', async ({ page }) => {
  const closed = await geometrySnapshot(page);
  await openByKeyboard(page, CHIP_BTN); // keyboard: no hover side-effects
  const open = await geometrySnapshot(page);

  // GEO-S014-1: underlying bboxes byte-identical; GEO-S014-2: zero flow height
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

test('GEO-S014-1/2 — tree-row menu is a PURE overlay too (rail + page unchanged)', async ({ page }) => {
  const closed = await geometrySnapshot(page);
  await openByKeyboard(page, TREE_BTN);
  const open = await geometrySnapshot(page);
  expect(open).toEqual(closed);

  const box = await page.locator(MENU).boundingBox();
  const vp = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
});

test('tree drill is UNCHANGED: steer click does not open the detail pane; row click still drills', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await expect(page.locator(MENU)).toBeVisible();
  await expect(page.getByTestId('detail-pane')).toHaveCount(0); // no drill
  await page.keyboard.press('Escape');

  await page.locator(TREE_ROW).click(); // the row itself still drills (UC-S005-3)
  await expect(page.getByTestId('detail-pane')).toBeVisible();
});
