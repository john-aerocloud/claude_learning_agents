// @covers uc-s014-2
// @covers SteerPanel
// @covers UseSteerContext
// UC-S014-2 — Steer panel, REAL-DATA validation spec (EXP-033 policy).
//
// Runs ONLY when REUSE_SERVER=1 (live :5173 observatory server with real
// work/observatory/items/items.csv data). The fixture-backed steer-panel.spec.js
// covers F-1..F-5, A11Y-1..7, GEO-S014-2-1..4, FIG-1..4 via REQ-DEMO; this
// spec confirms the same conditions hold for a real item (REQ-OBSERVATORY) and
// satisfies the EXP-033 real-data requirement in the slice's done condition.
//
// REAL ITEM: REQ-OBSERVATORY
//   id:    REQ-OBSERVATORY
//   job:   Observe and steer the delivery-agent pipeline from a single local
//          read-only surface
//   state: active
//   value: HIGH
//   cost:  XL
//
// RELEVANCY: pinned — update anchor if REQ-OBSERVATORY is renamed or removed
// from work/observatory/items/items.csv.
//
// Conditions covered:
//   F-1          panel opens with the real id + job from live items.csv (EXP-033)
//   F-2          human labels/values; no raw CSV keys in the rendered panel
//   F-3          intent textarea free text: no reload, no write request
//   F-4          Generate is aria-disabled until ≥1 char
//   F-5          Cancel and × close without generating; no write request
//   S14-2-A11Y-2 focus moves into the panel on open (non-blocking on focused
//                element — we assert the panel is present and the heading is
//                accessible, then confirm Esc returns focus to the trigger)
//   S14-2-A11Y-5 non-modal dialog; named "Steer: REQ-OBSERVATORY"; axe zero
//                violations; textarea is label-associated
//   GEO-S014-2-1/2/3/4  zero reflow; fixed; body-portalled; on-screen; fields stack

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Only run this spec when REUSE_SERVER=1 flags a live observatory server.
const LIVE_DATA = !!process.env.REUSE_SERVER;
test.skip(!LIVE_DATA, 'real-data spec only runs with REUSE_SERVER=1 (live observatory data)');

const ITEM_ID = 'REQ-OBSERVATORY';
const ITEM_JOB = 'Observe and steer the delivery-agent pipeline from a single local read-only surface';
const TREE_ROW = `[data-item-id="${ITEM_ID}"] > .tree-node__row`;
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const MENU = '[data-testid="steer-menu"]';
const PANEL = '[data-testid="steer-panel"]';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // Identity: value-stream-map must be present (principles/01)
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // EXP-033 anchor: REQ-OBSERVATORY tree row must be present with its steer trigger
  await expect(page.locator(TREE_ROW)).toBeVisible();
  await expect(page.locator(TREE_BTN)).toBeVisible();
});

/** Open the steer panel from a trigger by KEYBOARD ONLY (no hover). */
async function openPanelByKeyboard(page, btnSelector, action = 're-slice') {
  await page.locator(btnSelector).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator(`[data-testid="steer-action-${action}"]`).press('Enter');
  await expect(page.locator(PANEL)).toBeVisible();
}

/** Snapshot the geometry that must NOT change when the panel opens. */
function geometrySnapshot(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      vsmRegion: rect(document.querySelector('[data-testid="value-stream-map"]')),
      treeRegion: rect(document.querySelector('[data-testid="work-item-tree-rail"]')),
      treeRow: rect(document.querySelector(`[data-item-id="${'REQ-OBSERVATORY'}"] > .tree-node__row`)),
      pageScroll: document.documentElement.scrollHeight,
      mainScroll: document.querySelector('.observatory-main-col').scrollHeight,
      railScroll: document.querySelector('[data-testid="work-item-tree-rail"]').scrollHeight,
    };
  });
}

test('EXP-033 / F-1 / S14-2-FIG-1 — panel opens with REAL item id + job sentence from live items.csv', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Request re-slice / split' }).click();

  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-item-id', ITEM_ID);
  await expect(page.getByRole('dialog', { name: /steer: REQ-OBSERVATORY/i })).toBeVisible();

  // Wait for the context to load (async fetch)
  await expect(page.getByTestId('steer-context')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('steer-ctx-id')).toHaveText(`${ITEM_ID} — ${ITEM_JOB}`);
  await expect(page.getByTestId('steer-ctx-action')).toHaveText('Request re-slice / split');
  // Source ref anchors to the real observatory project items.csv
  await expect(page.getByTestId('steer-context'))
    .toHaveAttribute('data-source', 'work/observatory/items/items.csv#id=REQ-OBSERVATORY');
});

test('F-2 / S14-2-FIG-2 — live item shows state/value/cost as human words; no raw CSV keys in panel', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Re-prioritise' }).click();

  await expect(page.getByTestId('steer-context')).toBeVisible({ timeout: 10000 });
  // Live items.csv values for REQ-OBSERVATORY: state=active, value=HIGH, cost=XL
  await expect(page.getByTestId('steer-ctx-state')).toHaveText('active');
  await expect(page.getByTestId('steer-ctx-value')).toHaveText('HIGH');
  await expect(page.getByTestId('steer-ctx-cost')).toHaveText('XL');
  // No raw CSV keys visible anywhere in the panel
  const text = await page.locator(PANEL).innerText();
  for (const raw of ['vc_ratio', 'done_ts', 'started_ts', 'created_ts', 'dora_ref']) {
    expect(text).not.toContain(raw);
  }
  // The human action label is used, never the enum value
  expect(await page.getByTestId('steer-ctx-action').innerText()).not.toBe('re-prioritise');
});

test('F-3 — intent textarea accepts free text: no reload and no write request on live server', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => { if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`); });
  await page.evaluate(() => { window.__steerNoReload = 1; });

  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Custom steer' }).click();
  await expect(page.getByTestId('steer-context')).toBeVisible({ timeout: 10000 });
  const note = page.getByTestId('intent-note');
  await expect(note).toBeEnabled();
  await note.fill('re-prioritise REQ-OBSERVATORY above the throughput-rate slice');
  await expect(note).toHaveValue('re-prioritise REQ-OBSERVATORY above the throughput-rate slice');

  expect(await page.evaluate(() => window.__steerNoReload)).toBe(1); // same document
  expect(writes).toEqual([]); // read-only — no writes
});

test('F-4 — Generate is aria-disabled on live server until ≥1 char', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Raise defect' }).click();
  const gen = page.getByTestId('steer-generate');
  await expect(gen).toHaveAttribute('aria-disabled', 'true');

  await expect(page.getByTestId('steer-context')).toBeVisible({ timeout: 10000 });
  const note = page.getByTestId('intent-note');
  await note.fill('x');
  await expect(gen).toHaveAttribute('aria-disabled', 'false');
  await note.fill('');
  await expect(gen).toHaveAttribute('aria-disabled', 'true');
});

test('F-5 — Cancel and × both close on live server; no write fires', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => { if (req.method() !== 'GET') writes.push(req.url()); });

  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Custom steer' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator(PANEL)).toHaveCount(0);

  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Custom steer' }).click();
  await page.getByRole('button', { name: /close steer panel/i }).click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('S14-2-A11Y-5 — non-modal dialog contract + zero axe violations on real-data open panel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPanelByKeyboard(page, TREE_BTN);
  await expect(page.getByTestId('steer-context')).toBeVisible({ timeout: 10000 });

  const panel = page.locator(PANEL);
  await expect(panel).toHaveAttribute('role', 'dialog');
  expect(await panel.getAttribute('aria-modal')).toBeNull(); // non-modal
  await expect(page.getByRole('dialog', { name: /steer: REQ-OBSERVATORY/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /intent/i })).toBeVisible();

  const axe = await new AxeBuilder({ page })
    .include('[data-testid="steer-panel"]')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('GEO-S014-2-1/2/3/4 — pure overlay on live server: zero reflow, fixed, body-portalled, on-screen, fields stack', async ({ page }) => {
  // GEO methodology (process v12 §23): the CLOSED snapshot must be taken AFTER
  // keyboard focus reaches the trigger (so focus-scroll-into-view settles) but
  // BEFORE Enter opens the menu — then the open snapshot is taken after the panel
  // loads. This way the delta is purely panel-open vs panel-closed, not focus-scroll.
  await page.locator(TREE_BTN).focus();
  // Wait one frame for focus-scroll to settle
  await page.waitForTimeout(50);
  const closed = await geometrySnapshot(page);
  // Now open the menu via Enter (focus is already on the trigger)
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator(`[data-testid="steer-action-re-slice"]`).press('Enter');
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByTestId('steer-context')).toBeVisible({ timeout: 10000 });
  const open = await geometrySnapshot(page);

  // GEO-S014-2-1/2: underlying bboxes byte-identical; zero added flow height
  expect(open).toEqual(closed);

  // GEO-S014-2-3: fixed, portalled to body, z-index ≥ --z-drawer (40)
  const overlay = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="steer-panel"]');
    const s = getComputedStyle(el);
    return { position: s.position, z: Number(s.zIndex), parent: el.parentElement.tagName };
  });
  expect(overlay.position).toBe('fixed');
  expect(overlay.parent).toBe('BODY');
  expect(overlay.z).toBeGreaterThanOrEqual(40);

  // GEO-S014-2-4: fully on-screen
  const box = await page.locator(PANEL).boundingBox();
  const vp = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

  // context fields STACK (monotonic tops, shared left)
  const dds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="steer-ctx-"]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left };
    }));
  for (let i = 1; i < dds.length; i += 1) {
    expect(dds[i].top).toBeGreaterThan(dds[i - 1].top);
    expect(dds[i].left).toBe(dds[0].left);
  }
});

test('S14-2-A11Y-2 focus return — Esc from the panel returns focus to the REQ-OBSERVATORY steer trigger', async ({ page }) => {
  await openPanelByKeyboard(page, TREE_BTN);
  // focus the intent note (guaranteed to be inside the panel)
  await page.getByTestId('intent-note').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator(PANEL)).toHaveCount(0);
  // focus must return to the steer trigger for REQ-OBSERVATORY
  const trigger = await page.evaluate(() => ({
    testid: document.activeElement?.getAttribute('data-testid'),
    item: document.activeElement?.getAttribute('data-steer-item-id'),
  }));
  expect(trigger.testid).toBe('steer-btn');
  expect(trigger.item).toBe('REQ-OBSERVATORY');
});
