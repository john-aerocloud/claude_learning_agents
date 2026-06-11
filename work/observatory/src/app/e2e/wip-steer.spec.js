// @covers uc-s015-2
// @covers SPA_WIPPANEL
// @covers SPA_WIPROW
// @covers SteerMenu
// @covers SteerPanel
// UC-S015-2 browser spec — steer routing from WIP panel rows, REAL-BROWSER
// conditions (acceptance.md):
//   F-S2-1..4           trigger per row / actions open SteerPanel pre-loaded /
//                       re-slice does NOT dead-end / list stays mounted
//   S15-2-A11Y-1..5     named trigger, keyboard operate, ≥24px target, axe
//                       clean (closed AND open), focus return from the drawer
//   GEO-S015-2-WIP-1..4 pure overlay (zero reflow), trailing trigger with the
//                       figure band unbroken, list still stacks, menu clamped
//   S15-2-FIG-1..2      human reference in the trigger name; human action labels
//
// Fixture (e2e/fixtures/repo, OBSERVATORY_NOW=2026-06-09T01:15:00Z): two open
// items → WIP rows UC-D1-2 (stale, leads) and CHK-4. Menus are opened by
// KEYBOARD in the GEO tests (the s014 discipline: no hover side-effects).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROWS = [
  { id: 'UC-D1-2', job: 'Demo use case two' },
  { id: 'CHK-4', job: 'Fourth demo chunk - tree and zoom' },
];
const ROW = (id) => `[data-testid="wip-row"][data-item-id="${id}"]`;
const BTN = (id) => `${ROW(id)} [data-testid="steer-btn"]`;
const MENU = '[data-testid="steer-menu"]';
const LABELS = ['Raise defect', 'Re-prioritise', 'Request re-slice / split', 'Custom steer'];
const TYPES = ['raise-defect', 're-prioritise', 're-slice', 'custom'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('inflight-engineer')).toBeVisible(); // data fully rendered
  await page.getByTestId('view-tab-wip').click();
  await expect(page.getByTestId('wip-panel')).toBeVisible();
  await expect(page.getByTestId('wip-row')).toHaveCount(2);
});

/** Open a WIP-row steer menu by KEYBOARD (no hover side-effects — s014 idiom). */
async function openByKeyboard(page, id) {
  await page.locator(BTN(id)).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
}

test('F-S2-1 / S15-2-A11Y-1 / S15-2-FIG-1 — EXACTLY one trigger per row, named with the HUMAN item reference', async ({ page }) => {
  for (const { id, job } of ROWS) {
    const btns = page.locator(`${ROW(id)} [data-testid="steer-btn"]`);
    await expect(btns).toHaveCount(1);
    const name = await btns.first().getAttribute('aria-label');
    expect(name).toMatch(new RegExp(`^Steer ${id}`));
    expect(name).toContain(job); // id + job sentence, never a positional token
    expect(name).not.toMatch(/row:\d+/i);
    await expect(btns.first()).toHaveAttribute('data-steer-item-id', id);
  }
  // strict-mode contract: data-item-id stays on the ROW only — the trigger
  // rides data-steer-item-id and must never ADD a data-item-id duplicate
  // (page-wide each id appears once per HOST surface: treeitem + wip-row).
  for (const { id } of ROWS) {
    await expect(page.locator(`[data-testid="wip-row"][data-item-id="${id}"]`)).toHaveCount(1);
  }
  await expect(page.locator('[data-testid="steer-btn"][data-item-id]')).toHaveCount(0);
});

test('S15-2-FIG-2 — the four actions show HUMAN labels; the enum rides data-action only', async ({ page }) => {
  await page.locator(BTN('UC-D1-2')).click();
  const items = page.locator(MENU).getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items).toHaveText(LABELS);
  for (let i = 0; i < TYPES.length; i += 1) {
    const el = page.locator(`[data-testid="steer-action-${TYPES[i]}"]`);
    await expect(el).toHaveAttribute('data-action', TYPES[i]);
    expect((await el.innerText()).trim()).not.toBe(TYPES[i]);
  }
});

test('S15-2-A11Y-2 — keyboard: Tab-reachable, Enter opens → first item, Esc returns focus, Tab escapes @a11y', async ({ page }) => {
  // Tab-reachable within the WIP list (bounded walk from the panel heading)
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
  // focus moved to the FIRST menuitem
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
  ).toBe('steer-action-raise-defect');

  // Esc closes and RETURNS focus to the WIP-row trigger
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toHaveCount(0);
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
  ).toBe('steer-btn');

  // No trap: re-open, Tab leaves and closes behind it
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(MENU)).toHaveCount(0);
});

test('S15-2-A11Y-3 — WIP-row trigger hit box ≥ 24×24 CSS px (deferred from S15-1-A11Y-4) @a11y', async ({ page }) => {
  for (const { id } of ROWS) {
    const box = await page.locator(BTN(id)).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});

test('S15-2-A11Y-4 — axe CLEAN on the WIP view with triggers present AND with the menu open @a11y', async ({ page }) => {
  const closed = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .include('[data-testid="view-switch"]')
    .include('[data-testid="wip-panel"]')
    .analyze();
  expect(closed.violations, JSON.stringify(closed.violations, null, 2)).toEqual([]);

  await openByKeyboard(page, 'UC-D1-2');
  // let the menu's fade-in finish — axe samples COMPUTED colours, and a
  // mid-animation opacity blend reads as a (false) contrast failure
  await page.locator(MENU).evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  const open = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .include('[data-testid="wip-panel"]')
    .include('[data-testid="steer-menu"]')
    .analyze();
  expect(open.violations, JSON.stringify(open.violations, null, 2)).toEqual([]);
});

test('F-S2-2 / F-S2-4 / S15-2-A11Y-5 — action opens the SteerPanel pre-loaded; rows stay mounted; close returns focus to the trigger', async ({ page }) => {
  await page.locator(BTN('CHK-4')).click();
  await page.getByRole('menuitem', { name: 'Raise defect' }).click();
  const panel = page.getByTestId('steer-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-item-id', 'CHK-4');
  await expect(panel).toHaveAttribute('data-action', 'raise-defect');

  // F-S2-4: the WIP list stays mounted behind the drawer (overlay, not a swap)
  await expect(page.getByTestId('wip-row')).toHaveCount(2);

  // Cancel → focus RETURNS to the originating WIP-row trigger (S15-2-A11Y-5)
  await page.getByTestId('steer-cancel').click();
  await expect(page.getByTestId('steer-panel')).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      testid: document.activeElement?.getAttribute('data-testid'),
      item: document.activeElement?.getAttribute('data-steer-item-id'),
    })),
  ).toEqual({ testid: 'steer-btn', item: 'CHK-4' });

  // …and the operator can steer a DIFFERENT row with no navigation (F-S2-4)
  await page.locator(BTN('UC-D1-2')).click();
  await page.getByRole('menuitem', { name: 'Custom steer' }).click();
  await expect(page.getByTestId('steer-panel')).toHaveAttribute('data-item-id', 'UC-D1-2');
});

test('F-S2-3 — "Request re-slice / split" from a WIP row does NOT dead-end: SteerPanel opens with data-action="re-slice"', async ({ page }) => {
  await page.locator(BTN('UC-D1-2')).click();
  await page.getByRole('menuitem', { name: 'Request re-slice / split' }).click();
  const panel = page.getByTestId('steer-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-item-id', 'UC-D1-2');
  await expect(panel).toHaveAttribute('data-action', 're-slice');
  // interim destination is the REAL steer flow, not a stub: context resolves
  await expect(page.getByTestId('steer-ctx-action')).toHaveText('Request re-slice / split');
});

test('GEO-S015-2-WIP-1 — the steer menu is a PURE overlay: panel + page geometry byte-identical open vs closed; portalled to body', async ({ page }) => {
  const snapshot = () =>
    page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const panel = document.querySelector('[data-testid="wip-panel"]');
      return {
        panel: rect(panel),
        rows: Array.from(document.querySelectorAll('[data-testid="wip-row"]')).map(rect),
        panelScroll: panel.scrollHeight,
        pageScroll: document.documentElement.scrollHeight,
      };
    });
  const closed = await snapshot();
  await openByKeyboard(page, 'UC-D1-2'); // keyboard: no hover contamination
  const open = await snapshot();
  expect(open).toEqual(closed);

  // portalled out of the panel: the open menu is a child of document.body
  const placement = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="steer-menu"]');
    return {
      parentIsBody: menu.parentElement === document.body,
      insidePanel: !!menu.closest('[data-testid="wip-panel"]'),
      position: getComputedStyle(menu).position,
    };
  });
  expect(placement).toEqual({ parentIsBody: true, insidePanel: false, position: 'fixed' });
});

test('GEO-S015-2-WIP-2 — the trigger sits TRAILING and the figure band is unbroken (GEO-S015-4 holds)', async ({ page }) => {
  for (const { id } of ROWS) {
    const dds = page.locator(`${ROW(id)} dd`);
    const count = await dds.count();
    expect(count).toBeGreaterThanOrEqual(6);
    const tops = [];
    let maxDdLeft = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const box = await dds.nth(i).boundingBox();
      expect(box).toBeTruthy();
      tops.push(box.y);
      maxDdLeft = Math.max(maxDdLeft, box.x);
    }
    // figure band unbroken: dd tops share the band (small tolerance)
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
    // trigger trailing: its left offset > every figure dd's left offset
    const btnBox = await page.locator(BTN(id)).boundingBox();
    expect(btnBox.x).toBeGreaterThan(maxDdLeft);
  }
});

test('GEO-S015-2-WIP-3 — the list still STACKS with the triggers present (GEO-S015-2 not regressed)', async ({ page }) => {
  const rows = page.getByTestId('wip-row');
  const a = await rows.nth(0).boundingBox();
  const b = await rows.nth(1).boundingBox();
  expect(a && b).toBeTruthy();
  expect(b.y).toBeGreaterThan(a.y); // strictly below
  expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1); // shared left offset
});

test('GEO-S015-2-WIP-4 — the open menu is clamped on-screen from the trailing (right-edge) trigger; no horizontal scroll', async ({ page }) => {
  await openByKeyboard(page, 'UC-D1-2'); // trailing trigger ⇒ right-edge origin
  const box = await page.locator(MENU).boundingBox();
  const vp = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  const scrollW = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(scrollW).toBe(true);
});
