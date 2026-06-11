// @covers uc-s014-2
// @covers SteerPanel
// @covers useSteerContext
// @covers ObservatoryView
// UC-S014-2 — Steer panel, REAL-BROWSER conditions (acceptance.md):
//   F-1..F-5          panel opens with real item context / human labels / free
//                     text no-reload-no-write / Generate guard / Cancel closes
//   S14-2-A11Y-1..7   keyboard open→operate→close, focus move+return (no trap),
//                     visible ring + aria-disabled cue, target size, name/role/
//                     state (+axe), reduced motion, labelled context pairs
//   GEO-S014-2-1..4   byte-identical underlying bboxes + scrollHeights with the
//                     panel open vs closed; fixed + body-portalled + z-drawer;
//                     on-screen; context fields STACK
//   S14-2-FIG-1/2/4   id WITH job sentence + human action label; no raw CSV
//                     keys; stale id → labelled not-found, no console error
//   (S14-2-FIG-3 — absent value → "—" — is pinned in the jsdom unit spec; the
//    fixture repo has no missing-value row and is shared with other suites.)
//
// Fixture repo: tree row REQ-DEMO is a REAL items.csv item (job "Demo
// requirement for the work-item tree e2e"); intake chip D-1 is queue-only
// (NOT in items.csv) — the deterministic not-found path.
// The panel is opened via KEYBOARD in the GEO tests so the pointer never
// hovers a StageNode (hover opens its MetricSource reveal, which would
// contaminate the closed-vs-open geometry comparison).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TREE_ROW = '[data-item-id="REQ-DEMO"] > .tree-node__row';
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const CHIP_BTN = '[data-testid="queued-item-intake-D-1"] [data-testid="steer-btn"]';
const MENU = '[data-testid="steer-menu"]';
const PANEL = '[data-testid="steer-panel"]';

const REQ_JOB = 'Demo requirement for the work-item tree e2e';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.locator(TREE_ROW)).toBeVisible();
});

/** Open the steer panel from a trigger by KEYBOARD ONLY (no hover):
 * focus trigger → Enter (menu opens, first item focused) → arrow to the
 * action → Enter (menu closes, panel opens). */
async function openPanelByKeyboard(page, btnSelector, action = 're-slice') {
  await page.locator(btnSelector).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator(`[data-testid="steer-action-${action}"]`).press('Enter');
  await expect(page.locator(PANEL)).toBeVisible();
}

/** Snapshot the geometry that must NOT change when the panel opens (GEO-S014-2-1/2). */
function geometrySnapshot(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      vsmRegion: rect(document.querySelector('[data-testid="value-stream-map"]')),
      treeRegion: rect(document.querySelector('[data-testid="work-item-tree-rail"]')),
      treeRow: rect(document.querySelector('[data-item-id="REQ-DEMO"] > .tree-node__row')),
      pageScroll: document.documentElement.scrollHeight,
      mainScroll: document.querySelector('.observatory-main-col').scrollHeight,
      railScroll: document.querySelector('[data-testid="work-item-tree-rail"]').scrollHeight,
    };
  });
}

test('F-1 / S14-2-FIG-1 — panel opens with the REAL item id + job sentence + human action label', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Request re-slice / split' }).click();

  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-item-id', 'REQ-DEMO');
  await expect(page.getByRole('dialog', { name: /steer: REQ-DEMO/i })).toBeVisible();

  await expect(page.getByTestId('steer-ctx-id')).toHaveText(`REQ-DEMO — ${REQ_JOB}`);
  await expect(page.getByTestId('steer-ctx-job')).toHaveText(REQ_JOB);
  await expect(page.getByTestId('steer-ctx-action')).toHaveText('Request re-slice / split');
  // traceability anchor back to the source file (§8)
  await expect(page.getByTestId('steer-context'))
    .toHaveAttribute('data-source', 'work/demo/items/items.csv#id=REQ-DEMO');
});

test('F-2 / S14-2-FIG-2 — human labels and values; NO raw CSV keys anywhere in the panel', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Re-prioritise' }).click();
  await expect(page.getByTestId('steer-ctx-state')).toHaveText('active');
  await expect(page.getByTestId('steer-ctx-value')).toHaveText('HIGH');
  await expect(page.getByTestId('steer-ctx-cost')).toHaveText('XL');
  const text = await page.locator(PANEL).innerText();
  for (const raw of ['vc_ratio', 'done_ts', 'started_ts', 'created_ts', 'dora_ref']) {
    expect(text).not.toContain(raw);
  }
  // the visible action is the human label, never the bare enum
  expect(await page.getByTestId('steer-ctx-action').innerText()).not.toBe('re-prioritise');
});

test('F-3 — intent textarea accepts free text with NO reload and NO write request', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => { if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`); });
  await page.evaluate(() => { window.__steerNoReload = 1; });

  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Custom steer' }).click();
  const note = page.getByTestId('intent-note');
  await expect(note).toBeEnabled();
  await note.fill('split this requirement into two thinner chunks');
  await expect(note).toHaveValue('split this requirement into two thinner chunks');

  expect(await page.evaluate(() => window.__steerNoReload)).toBe(1); // same document
  expect(writes).toEqual([]); // read-only — nothing but GETs
});

test('F-4 / S14-2-A11Y-3 — Generate is aria-disabled until ≥1 char; flips both ways', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Raise defect' }).click();
  const gen = page.getByTestId('steer-generate');
  await expect(gen).toHaveAttribute('aria-disabled', 'true');

  const note = page.getByTestId('intent-note');
  await note.fill('x');
  await expect(gen).toHaveAttribute('aria-disabled', 'false');
  await note.fill('');
  await expect(gen).toHaveAttribute('aria-disabled', 'true');
});

test('F-5 — Cancel and × both close without generating; no write request fires', async ({ page }) => {
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

test('S14-2-A11Y-1/2 — keyboard-only: open → focus heading → Tab order textarea→Generate→Cancel→× → Esc returns focus to the trigger @a11y', async ({ page }) => {
  await openPanelByKeyboard(page, TREE_BTN);

  const active = () => page.evaluate(() => ({
    testid: document.activeElement?.getAttribute('data-testid'),
    inPanel: !!document.activeElement?.closest('[data-testid="steer-panel"]'),
  }));

  // focus moved INTO the panel — to the heading (S14-2-A11Y-2). Sampled
  // IMMEDIATELY (still loading): the heading focus is synchronous with mount
  // (useLayoutEffect — UC-S014-2 rework), so there is no frame where the
  // steer trigger keeps focus.
  expect((await active()).testid).toBe('steer-panel-heading');

  // Tab order (S14-2-A11Y-1) is the READY panel's contract — while loading the
  // textarea is disabled (not focusable) and Tab would legitimately skip it.
  await expect(page.getByTestId('steer-context')).toBeVisible();
  // …and the loading→ready re-render must NOT have stolen focus off the heading
  expect((await active()).testid).toBe('steer-panel-heading');

  await page.keyboard.press('Tab');
  expect((await active()).testid).toBe('intent-note');
  await page.keyboard.press('Tab');
  expect((await active()).testid).toBe('steer-generate');
  await page.keyboard.press('Tab');
  expect((await active()).testid).toBe('steer-cancel');
  await page.keyboard.press('Tab');
  expect((await active()).testid).toBe('steer-panel-close');

  // NON-MODAL: Tab keeps going — focus LEAVES the panel (no trap)
  await page.keyboard.press('Tab');
  expect((await active()).inPanel).toBe(false);

  // Esc (focus back inside first) closes and returns focus to the steer trigger
  await page.getByTestId('intent-note').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator(PANEL)).toHaveCount(0);
  const trigger = await page.evaluate(() => ({
    testid: document.activeElement?.getAttribute('data-testid'),
    item: document.activeElement?.getAttribute('data-steer-item-id'),
  }));
  expect(trigger.testid).toBe('steer-btn');
  expect(trigger.item).toBe('REQ-DEMO');
});

test('S14-2-A11Y-3 — visible focus ring on textarea + buttons (not colour alone) @a11y', async ({ page }) => {
  await openPanelByKeyboard(page, TREE_BTN);
  for (const tid of ['intent-note', 'steer-generate', 'steer-cancel', 'steer-panel-close']) {
    await page.getByTestId(tid).focus();
    // force :focus-visible via keyboard interaction path — focus() from script
    // may not set it, so verify via Tab landing instead when needed
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    // a painted cue exists on focus (focus-ring box-shadow or outline)
    expect(ring.boxShadow !== 'none' || ring.outline !== 'none').toBe(true);
  }
});

test('S14-2-A11Y-4 — ×, Cancel, Generate hit boxes ≥ 24×24 CSS px @a11y', async ({ page }) => {
  await openPanelByKeyboard(page, TREE_BTN);
  for (const tid of ['steer-panel-close', 'steer-cancel', 'steer-generate']) {
    const box = await page.getByTestId(tid).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});

test('S14-2-A11Y-5 — non-modal dialog contract + zero axe violations on the open panel @a11y', async ({ page }) => {
  // Reduced motion for the SCAN ONLY: axe-core samples colours while the
  // drawer's opacity slide-in is in flight and reports phantom contrast
  // failures (found by the live drive — real computed colours are ≥ 4.5:1,
  // asserted below, and the animated path is covered by S14-2-A11Y-6).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPanelByKeyboard(page, TREE_BTN);
  const panel = page.locator(PANEL);
  await expect(panel).toHaveAttribute('role', 'dialog');
  expect(await panel.getAttribute('aria-modal')).toBeNull(); // NON-modal — no trap
  await expect(page.getByRole('dialog', { name: /steer: REQ-DEMO/i })).toBeVisible();
  // textarea is label-associated
  await expect(page.getByRole('textbox', { name: /intent/i })).toBeVisible();
  await expect(page.getByTestId('steer-context')).toBeVisible(); // context rendered → in scan scope

  const axe = await new AxeBuilder({ page })
    .include('[data-testid="steer-panel"]')
    .analyze();
  expect(axe.violations).toEqual([]);

  // Real computed contrast of the dim text (labels/sub) vs the panel surface
  // ≥ 4.5:1 — animation-independent pin of the colour contract (1.4.3).
  const ratio = await page.evaluate(() => {
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const panelEl = document.querySelector('[data-testid="steer-panel"]');
    const fg = lum(getComputedStyle(panelEl.querySelector('dt')).color);
    const bg = lum(getComputedStyle(panelEl).backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('S14-2-A11Y-6 — reduced motion: drawer appears instantly (no animation) @a11y', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPanelByKeyboard(page, TREE_BTN);
  const anim = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('[data-testid="steer-panel"]'));
    return { name: s.animationName, duration: s.animationDuration };
  });
  expect(anim.name === 'none' || anim.duration === '0s').toBe(true);
});

test('S14-2-A11Y-7 — every context value is a labelled dt/dd pair (nothing announced bare) @a11y', async ({ page }) => {
  await openPanelByKeyboard(page, TREE_BTN);
  await expect(page.getByTestId('steer-context')).toBeVisible(); // wait for ready
  const pairs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="steer-ctx-"]')).map((dd) => ({
      tag: dd.tagName,
      labelTag: dd.previousElementSibling?.tagName,
      label: dd.previousElementSibling?.textContent?.trim(),
      value: dd.textContent.trim(),
    })));
  expect(pairs.length).toBe(6);
  for (const p of pairs) {
    expect(p.tag).toBe('DD');
    expect(p.labelTag).toBe('DT');
    expect(p.label.length).toBeGreaterThan(0);
    expect(p.value.length).toBeGreaterThan(0);
  }
});

test('GEO-S014-2-1/2/3/4 — the panel is a PURE overlay: zero reflow, fixed, body-portalled, on-screen, fields stack', async ({ page }) => {
  const closed = await geometrySnapshot(page);
  await openPanelByKeyboard(page, TREE_BTN); // keyboard: no hover side-effects
  await expect(page.getByTestId('steer-context')).toBeVisible(); // fully-loaded panel
  const open = await geometrySnapshot(page);

  // GEO-S014-2-1: underlying bboxes byte-identical; -2: zero added flow height
  expect(open).toEqual(closed);

  // GEO-S014-2-3: fixed, portalled to body, z-index ≥ --z-drawer (top drawer)
  const overlay = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="steer-panel"]');
    const s = getComputedStyle(el);
    return { position: s.position, z: Number(s.zIndex), parent: el.parentElement.tagName };
  });
  expect(overlay.position).toBe('fixed');
  expect(overlay.parent).toBe('BODY');
  expect(overlay.z).toBeGreaterThanOrEqual(40); // --z-drawer

  // GEO-S014-2-4: fully on-screen — never a horizontal scroll
  const box = await page.locator(PANEL).boundingBox();
  const vp = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

  // …and the context fields STACK: monotonic tops, shared left (labelled list)
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

test('coexistence — opened over the DetailPane, the SteerPanel is the topmost drawer', async ({ page }) => {
  await page.locator(TREE_ROW).click(); // drill → DetailPane opens (UC-S005-3)
  await expect(page.getByTestId('detail-pane')).toBeVisible();
  await page.locator(TREE_BTN).click();
  await page.getByRole('menuitem', { name: 'Custom steer' }).click();
  await expect(page.locator(PANEL)).toBeVisible();
  const z = await page.evaluate(() => ({
    steer: Number(getComputedStyle(document.querySelector('[data-testid="steer-panel"]')).zIndex),
    detail: Number(getComputedStyle(document.querySelector('[data-testid="detail-pane"]')).zIndex),
  }));
  expect(z.steer).toBeGreaterThan(z.detail);
});

test('S14-2-FIG-4 — queue-only/stale id (chip D-1): labelled not-found, form hidden, NO console error', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await openPanelByKeyboard(page, CHIP_BTN, 'raise-defect');
  await expect(page.getByTestId('steer-context-notfound')).toHaveText('Item D-1 not found');
  await expect(page.getByTestId('intent-note')).toHaveCount(0); // form hidden
  await expect(page.getByTestId('steer-generate')).toHaveCount(0);
  await expect(page.getByTestId('steer-cancel')).toBeVisible(); // escape hatch stays
  expect(errors).toEqual([]);
});
