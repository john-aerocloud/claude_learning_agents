// @covers uc-s015-3
// @covers S15UC3
// @covers ReslicePreviewPanel
// @covers UseReslicePreview
// @covers SPA_OBSVIEW
// UC-S015-3 browser spec — ReslicePreviewPanel two-column before/after
// preview, REAL-BROWSER conditions (acceptance.md):
//   F-S3-1..5            two named columns / Before = live six-field context /
//                        free text no-write / three-field Generate guard /
//                        Cancel clean with the WIP panel intact behind
//   RESLICE-DISPATCH-1   re-slice → ReslicePreviewPanel; other three → SteerPanel
//   RESLICE-PREVIEW-1    preview-only: ZERO non-GET traffic; output slot EMPTY
//                        until Generate (UC-S015-4 flipped the always-empty
//                        pin: Generate now renders the enriched prompt —
//                        e2e/reslice-prompt.spec.js owns the content/GEO pins)
//   S15-3-A11Y-1..8      keyboard open→operate→close, focus move+return,
//                        guard cue not colour-alone, ≥24px targets, name/role/
//                        state (+axe), reduced motion, labelled dt/dd, headings
//   GEO-S015-3-1..4      pure overlay (zero reflow, fixed, body-portalled) /
//                        TWO columns side-by-side / fields stack per column /
//                        clamped on-screen
//   S15-3-FIG-1..4       human Before refs / human After labels / empty parts
//                        ≠ cost note ≠ prompt / not-found ≠ crash
//
// Fixture (e2e/fixtures/repo, OBSERVATORY_NOW=2026-06-09T01:15:00Z): WIP rows
// UC-D1-2 ("Demo use case two", in items.csv) and CHK-4; intake chip D-1 is
// queue-only (NOT in items.csv) — the deterministic not-found path. Menus are
// opened by KEYBOARD in the GEO tests (the s014 discipline: no hover
// side-effects contaminating closed-vs-open snapshots).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROW = (id) => `[data-testid="wip-row"][data-item-id="${id}"]`;
const BTN = (id) => `${ROW(id)} [data-testid="steer-btn"]`;
const MENU = '[data-testid="steer-menu"]';
const PANEL = '[data-testid="reslice-preview-panel"]';
const ITEM_ID = 'UC-D1-2';
const ITEM_JOB = 'Demo use case two';
const COST_NOTE = 'Each part will be smaller than the original — favours flow';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('inflight-engineer')).toBeVisible(); // data fully rendered
  await page.getByTestId('view-tab-wip').click();
  await expect(page.getByTestId('wip-panel')).toBeVisible();
  await expect(page.getByTestId('wip-row')).toHaveCount(2);
});

/** Open the re-slice preview from a WIP row by KEYBOARD (no hover side-effects). */
async function openByKeyboard(page, id = ITEM_ID) {
  await page.locator(BTN(id)).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator('[data-testid="steer-action-re-slice"]').press('Enter');
  await expect(page.locator(PANEL)).toBeVisible();
}

/** Open by mouse (non-GEO tests). */
async function openByClick(page, id = ITEM_ID) {
  await page.locator(BTN(id)).click();
  await page.getByRole('menuitem', { name: 'Request re-slice / split' }).click();
  await expect(page.locator(PANEL)).toBeVisible();
}

/** Wait for the Before column context (status=ready). */
async function waitReady(page, id = ITEM_ID) {
  await expect(page.getByTestId('reslice-before-id')).toHaveText(new RegExp(`^${id} — `));
}

test('F-S3-1 / RESLICE-DISPATCH-1 — re-slice opens the preview panel (NOT SteerPanel) with the two named columns', async ({ page }) => {
  await openByClick(page);
  await expect(page.getByTestId('steer-panel')).toHaveCount(0);
  const panel = page.locator(PANEL);
  await expect(panel).toHaveAttribute('data-item-id', ITEM_ID);
  await expect(page.getByRole('dialog', { name: /re-slice.*: UC-D1-2/i })).toBeVisible();
  // dialog is NON-modal — no aria-modal, the dashboard stays operable behind
  expect(await panel.getAttribute('aria-modal')).toBeNull();
  // two visible columns, headed
  await expect(page.getByTestId('reslice-before').getByRole('heading', { name: 'Current item' })).toBeVisible();
  await expect(page.getByTestId('reslice-after').getByRole('heading', { name: 'Proposed split' })).toBeVisible();
});

test('RESLICE-DISPATCH-1 — the OTHER three actions still open the SteerPanel (scoped re-point)', async ({ page }) => {
  for (const [action, label] of [
    ['raise-defect', 'Raise defect'],
    ['re-prioritise', 'Re-prioritise'],
    ['custom', 'Custom steer'],
  ]) {
    await page.locator(BTN(ITEM_ID)).click();
    await page.getByRole('menuitem', { name: label }).click();
    const panel = page.getByTestId('steer-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-action', action);
    await expect(page.locator(PANEL)).toHaveCount(0);
    await page.getByTestId('steer-cancel').click();
    await expect(panel).toHaveCount(0);
  }
});

test('F-S3-2 / S15-3-FIG-1 / S15-3-A11Y-7 — Before column = the LIVE six-field contract, labelled, human, traceable', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  await expect(page.getByTestId('reslice-before-id')).toHaveText(`${ITEM_ID} — ${ITEM_JOB}`);
  await expect(page.getByTestId('reslice-before-job')).toHaveText(ITEM_JOB);
  await expect(page.getByTestId('reslice-before-value')).toHaveText('MED');
  await expect(page.getByTestId('reslice-before-cost')).toHaveText('2');
  await expect(page.getByTestId('reslice-before-stage')).toHaveText('done');
  // provenance anchor (SourceLink convention)
  await expect(page.getByTestId('reslice-before'))
    .toHaveAttribute('data-source', `work/demo/items/items.csv#id=${ITEM_ID}`);
  // the replaced-by expectation note
  await expect(page.getByTestId('reslice-before-note'))
    .toHaveText('After split, this item will be replaced by Part A and Part B');
  // every figure is a labelled dt/dd pair; labels visible (textContent — the
  // dt CSS uppercases innerText, the AUTHORED label is what we pin)
  const dts = await page.locator(`${PANEL} [data-testid="reslice-before"] dt`).evaluateAll(
    (els) => els.map((el) => el.textContent),
  );
  expect(dts).toEqual(['Item', 'Job', 'Value', 'Cost', 'Current stage']);
  // no raw CSV keys anywhere in the panel
  const text = await page.locator(PANEL).innerText();
  for (const raw of ['vc_ratio', 'done_ts', 'started_ts', 'created_ts', 'dora_ref', 'part_a_job']) {
    expect(text).not.toContain(raw);
  }
});

test('F-S3-3 / RESLICE-PREVIEW-1 — typing + Generate fire ZERO write requests; the prompt renders CLIENT-SIDE into the slot', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  const writes = [];
  page.on('request', (req) => { if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`); });

  await page.getByTestId('part-a-job').fill('Part A delivers the read path');
  await page.getByTestId('part-b-job').fill('Part B delivers the write path');
  await page.getByTestId('reslice-intent').fill('too big to flow as one item');
  await expect(page.getByTestId('reslice-generate')).toHaveAttribute('aria-disabled', 'false');
  await page.getByTestId('reslice-generate').click();

  // FLIPPED by UC-S015-4 (was: slot pinned EMPTY after Generate): the
  // enriched prompt now renders into the reserved slot — still PREVIEW-ONLY,
  // generation is pure client-side: ZERO non-GET traffic (content pins live
  // in e2e/reslice-prompt.spec.js).
  await expect(page.getByTestId('prompt-output')).toBeVisible();
  expect(writes).toEqual([]);
});

test('F-S3-4 / S15-3-A11Y-3 — Generate guard flips ONLY when all three fields are non-empty; cue is not colour alone', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  const gen = page.getByTestId('reslice-generate');
  await expect(gen).toHaveText('Looks right — generate prompt');
  await expect(gen).toHaveAttribute('aria-disabled', 'true');
  // non-colour guard cue: inset shadow + not-allowed cursor (s014 styling reused)
  const guarded = await gen.evaluate((el) => {
    const s = getComputedStyle(el);
    return { shadow: s.boxShadow, cursor: s.cursor };
  });
  expect(guarded.shadow).toContain('inset');
  expect(guarded.cursor).toBe('not-allowed');

  await page.getByTestId('part-a-job').fill('A');
  await expect(gen).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('part-b-job').fill('B');
  await expect(gen).toHaveAttribute('aria-disabled', 'true'); // intent still empty
  await page.getByTestId('reslice-intent').fill('why');
  await expect(gen).toHaveAttribute('aria-disabled', 'false');
  // emptying a field re-guards
  await page.getByTestId('part-a-job').fill('');
  await expect(gen).toHaveAttribute('aria-disabled', 'true');
});

test('S15-3-FIG-3 — empty parts ≠ a staged proposal: cost note ABSENT until BOTH parts filled', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  await expect(page.getByTestId('reslice-cost-note')).toHaveCount(0);
  await page.getByTestId('part-a-job').fill('only A');
  await expect(page.getByTestId('reslice-cost-note')).toHaveCount(0);
  await page.getByTestId('part-b-job').fill('and B');
  await expect(page.getByTestId('reslice-cost-note')).toHaveText(COST_NOTE);
  await page.getByTestId('part-b-job').fill('');
  await expect(page.getByTestId('reslice-cost-note')).toHaveCount(0);
  // and no prompt output in any of these states
  await expect(page.getByTestId('prompt-output')).toHaveCount(0);
});

test('F-S3-5 — Cancel closes WITHOUT generating; the WIP panel is intact behind it', async ({ page }) => {
  const rowsBefore = await page.getByTestId('wip-row').count();
  await openByClick(page);
  await waitReady(page);
  await page.getByTestId('part-a-job').fill('typed but abandoned');
  await page.getByTestId('reslice-cancel').click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.getByTestId('prompt-output')).toHaveCount(0);
  await expect(page.getByTestId('wip-panel')).toBeVisible();
  await expect(page.getByTestId('wip-row')).toHaveCount(rowsBefore);
});

test('S15-3-A11Y-1/2 — keyboard open→Tab path→Esc close with focus RETURN to the opening trigger', async ({ page }) => {
  await openByKeyboard(page);
  // focus moved INTO the panel: the heading is the focus target on open
  await expect(page.getByTestId('reslice-heading')).toBeFocused();
  await waitReady(page);
  // Tab path: heading → Part A → Part B → intent → Generate → Cancel → ×
  for (const tid of ['part-a-job', 'part-b-job', 'reslice-intent', 'reslice-generate', 'reslice-cancel', 'reslice-close']) {
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(tid)).toBeFocused();
  }
  // Esc closes; focus returns to the WIP-row steer trigger that opened it
  await page.keyboard.press('Escape');
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator(BTN(ITEM_ID))).toBeFocused();
});

test('S15-3-A11Y-4 — ×, Cancel, Generate hit boxes ≥ 24×24 CSS px', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  for (const tid of ['reslice-generate', 'reslice-cancel', 'reslice-close']) {
    const box = await page.getByTestId(tid).boundingBox();
    expect(box.width, `${tid} width`).toBeGreaterThanOrEqual(24);
    expect(box.height, `${tid} height`).toBeGreaterThanOrEqual(24);
  }
});

test('S15-3-A11Y-5 — axe runs CLEAN on the open panel (name/role/state)', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  // labelled fields resolve by role+name (4.1.2)
  await expect(page.getByRole('textbox', { name: /part a job/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /part b job/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /why.*splitting/i })).toBeVisible();
  // settle the drawer slide-in before axe samples colours (s014 discipline)
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('S15-3-A11Y-6 — reduced motion: the drawer appears with NO animation under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openByClick(page);
  const anim = await page.locator(PANEL).evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('none');
  await expect(page.locator(PANEL)).toBeVisible();
});

test('S15-3-A11Y-8 — heading order: one h2 (panel title) then the two h3 column headings, no skips', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  const headings = await page.locator(`${PANEL} h2, ${PANEL} h3, ${PANEL} h4`).evaluateAll(
    (els) => els.map((el) => ({ tag: el.tagName, text: el.textContent.trim() })),
  );
  expect(headings).toEqual([
    { tag: 'H2', text: `Re-slice / split: ${ITEM_ID}` },
    { tag: 'H3', text: 'Current item' },
    { tag: 'H3', text: 'Proposed split' },
  ]);
});

test('GEO-S015-3-1 — the panel is a PURE overlay: WIP panel + page geometry byte-identical open vs closed; fixed + body-portalled', async ({ page }) => {
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
  // closed snapshot AFTER focus settles on the trigger (s014 GEO methodology)
  await page.locator(BTN(ITEM_ID)).focus();
  await page.waitForTimeout(50);
  const closed = await snapshot();
  await page.keyboard.press('Enter');
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator('[data-testid="steer-action-re-slice"]').press('Enter');
  await expect(page.locator(PANEL)).toBeVisible();
  await waitReady(page);
  const open = await snapshot();
  expect(open).toEqual(closed); // zero reflow — AC-5 "unmodified behind it"

  const overlay = await page.locator(PANEL).evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, z: Number(s.zIndex), parent: el.parentElement.tagName };
  });
  expect(overlay.position).toBe('fixed');
  expect(overlay.parent).toBe('BODY');
  expect(overlay.z).toBeGreaterThanOrEqual(40);
});

test('GEO-S015-3-2 — TWO columns side-by-side: shared top band, After strictly right of Before, no overlap', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  const geo = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      before: r('[data-testid="reslice-before"]'),
      after: r('[data-testid="reslice-after"]'),
    };
  });
  expect(Math.abs(geo.before.top - geo.after.top)).toBeLessThanOrEqual(2); // shared top band
  expect(geo.after.left).toBeGreaterThan(geo.before.left); // After to the RIGHT
  expect(geo.before.right).toBeLessThanOrEqual(geo.after.left + 1); // no overlap
});

test('GEO-S015-3-3 — within each column the fields STACK (monotonic tops)', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  // make the cost note visible so the After stack is complete
  await page.getByTestId('part-a-job').fill('A');
  await page.getByTestId('part-b-job').fill('B');
  await expect(page.getByTestId('reslice-cost-note')).toBeVisible();
  const tops = await page.evaluate(() => {
    const beforeDds = Array.from(
      document.querySelectorAll('[data-testid="reslice-before"] dd'),
    ).map((el) => el.getBoundingClientRect());
    const afterStack = ['part-a-job', 'part-b-job', 'reslice-cost-note'].map(
      (tid) => document.querySelector(`[data-testid="${tid}"]`).getBoundingClientRect(),
    );
    return {
      beforeTops: beforeDds.map((b) => b.top),
      beforeLefts: beforeDds.map((b) => b.left),
      afterTops: afterStack.map((b) => b.top),
    };
  });
  for (let i = 1; i < tops.beforeTops.length; i += 1) {
    expect(tops.beforeTops[i]).toBeGreaterThan(tops.beforeTops[i - 1]); // dd rows stack
    expect(Math.abs(tops.beforeLefts[i] - tops.beforeLefts[0])).toBeLessThanOrEqual(1); // shared left
  }
  for (let i = 1; i < tops.afterTops.length; i += 1) {
    expect(tops.afterTops[i]).toBeGreaterThan(tops.afterTops[i - 1]); // A → B → note stack
  }
});

test('GEO-S015-3-4 — the open panel is clamped on-screen; no horizontal scroll', async ({ page }) => {
  await openByClick(page);
  await waitReady(page);
  const geo = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="reslice-preview-panel"]').getBoundingClientRect();
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      vw: window.innerWidth, vh: window.innerHeight,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(geo.left).toBeGreaterThanOrEqual(0);
  expect(geo.top).toBeGreaterThanOrEqual(0);
  expect(geo.right).toBeLessThanOrEqual(geo.vw);
  expect(geo.bottom).toBeLessThanOrEqual(geo.vh);
  expect(geo.hScroll).toBe(false);
});

test('S15-3-FIG-4 — a queue-only id (not in items.csv) renders the labelled not-found state, NO console error', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  // the intake chip D-1 is the deterministic not-found anchor (steer-panel.spec idiom)
  await page.getByTestId('view-tab-pipeline').click();
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  const chipBtn = page.locator('[data-testid="queued-item-intake-D-1"] [data-testid="steer-btn"]');
  await chipBtn.click();
  await page.getByRole('menuitem', { name: 'Request re-slice / split' }).click();
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('reslice-context-notfound')).toHaveText('Item D-1 not found');
  // After + Generate hidden (fail-soft); Cancel/× remain
  await expect(page.getByTestId('reslice-after')).toHaveCount(0);
  await expect(page.getByTestId('reslice-generate')).toHaveCount(0);
  await expect(page.getByTestId('reslice-cancel')).toBeVisible();
  await page.getByTestId('reslice-close').click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});
