// @covers uc-s018-2
// @covers CodStep
// @covers CodValueSelect
// @covers CodUrgency
// @covers CodScoreReadout
// @covers CodScorer
// UC-S018-2 — the CoD signals step in a REAL browser. What jsdom cannot prove:
//   GEO-S018-2-1: the step-1→step-2 swap (placeholder → live CodStep) reflows
//                 NOTHING outside the fixed drawer (map bbox + column height
//                 byte-identical across the swap).
//   GEO-S018-2-2: the three signal groups STACK (monotonic tops, shared left).
//   GEO-S018-2-3: the drawer stays fully on-screen with step 2 live.
//   A11Y-S018-2-1/2: REAL keyboard semantics — each radiogroup is a single
//                 tab stop; arrow keys move the selection.
//   A11Y-S018-2-5: the real forward-Tab progression within the step.
//   A11Y-S018-2-7/8: computed focus rings; ≥24×24 hit boxes.
//   A11Y-S018-2-10: axe color-contrast with step 2 live (incl. the readout).
//   FIG-S018-2-1:  the live band readout end-to-end (radio click → words).
//   NOWRITE-S018-2-1/2: zero write-method requests across the FULL step-2
//                 interaction; the server write-guard still 405s.
// Stable selectors only — the cod-* contract (ui-design.md UC-S018-2).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const openStep2 = async (page) => {
  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('cod-step')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('view-switch')).toBeVisible();
});

test('GEO-S018-2-1/3 — the step-1→step-2 swap reflows NOTHING outside the drawer; the drawer stays on-screen', async ({ page }) => {
  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();

  const before = {
    map: await page.getByTestId('value-stream-map').boundingBox(),
    ...(await page.evaluate(() => ({
      col: document.querySelector('.observatory-main-col').scrollHeight,
      scrollW: document.documentElement.scrollWidth,
    }))),
  };

  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('cod-step')).toBeVisible();
  // the placeholder is GONE for step 2 (NAV-S018-2-1)
  await expect(page.getByTestId('wizard-step-placeholder')).toHaveCount(0);

  const after = {
    map: await page.getByTestId('value-stream-map').boundingBox(),
    ...(await page.evaluate(() => ({
      col: document.querySelector('.observatory-main-col').scrollHeight,
      scrollW: document.documentElement.scrollWidth,
    }))),
  };

  expect(after.map).toEqual(before.map);
  expect(after.col).toBe(before.col);
  expect(after.scrollW).toBe(before.scrollW); // no horizontal scrollbar

  // GEO-S018-2-3: wizard fully within the viewport with step 2 live
  const wiz = await page.getByTestId('intake-wizard').boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  expect(wiz.x).toBeGreaterThanOrEqual(0);
  expect(wiz.x + wiz.width).toBeLessThanOrEqual(vw + 1);
});

test('GEO-S018-2-2 — the three CoD signal groups STACK: monotonic tops, shared left (a form column, not a row)', async ({ page }) => {
  await openStep2(page);
  const boxes = [];
  for (const tid of ['cod-value', 'cod-urgency', 'cod-risk']) {
    boxes.push(await page.getByTestId(tid).boundingBox());
  }
  for (let i = 0; i < boxes.length - 1; i += 1) {
    expect(boxes[i + 1].y, `group ${i + 1} must sit BELOW group ${i}`).toBeGreaterThan(boxes[i].y);
  }
  for (let i = 1; i < boxes.length; i += 1) {
    expect(Math.abs(boxes[i].x - boxes[0].x), 'groups share a left edge').toBeLessThanOrEqual(8);
  }
});

test('A11Y-S018-2-1/2 — each radiogroup is a SINGLE tab stop and arrow keys move the selection', async ({ page }) => {
  await openStep2(page);
  // enter the Value group via click (establishes the roving stop), arrows move
  await page.getByTestId('cod-value-high').click();
  await expect(page.getByTestId('cod-value-high')).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('cod-value-med')).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('cod-value-low')).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('cod-value-med')).toBeChecked();

  // SINGLE tab stop: Tab from the checked Value radio leaves the whole group
  // and lands in the Urgency group (its first radio — none checked yet)
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('cod-urgency-yes')).toBeFocused();
  // arrows select within Urgency
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('cod-urgency-no')).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('cod-urgency-yes')).toBeChecked();

  // A11Y-S018-2-5: Tab continues why-now → risk → readout → Back → Next
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('cod-urgency-why')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('cod-risk')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('cod-score-readout')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('wizard-back')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('wizard-next')).toBeFocused();
});

test('AC-S018-2-1..3 / FIG-S018-2-1/3 — live band readout end-to-end: neutral → HIGH → MED → LOW as words; console error-free', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await openStep2(page);
  const readout = page.getByTestId('cod-score-readout');
  await expect(readout).toHaveAttribute('role', 'status');
  await expect(readout).toHaveAttribute('aria-live', 'polite');
  // FIG-S018-2-3: incomplete → neutral prompt, no band, no data-cod-band
  await expect(readout).toContainText(/choose a value and urgency/i);
  await expect(readout.locator('[data-cod-band]')).toHaveCount(0);
  await page.getByTestId('cod-value-high').click();
  await expect(readout.locator('[data-cod-band]')).toHaveCount(0); // still incomplete

  // HIGH + Yes → HIGH, top tier, next-step hint (FIG-S018-2-1)
  await page.getByTestId('cod-urgency-yes').click();
  await expect(readout.locator('[data-cod-band]')).toHaveAttribute('data-cod-band', 'HIGH');
  await expect(readout).toContainText('HIGH');
  await expect(readout).toContainText(/top tier/i);
  await expect(readout).toContainText(/rank preview|next step/i);
  await expect(readout).not.toContainText(/undefined|null|NaN/);

  // flip urgency: HIGH + No → MED (middle tier)
  await page.getByTestId('cod-urgency-no').click();
  await expect(readout.locator('[data-cod-band]')).toHaveAttribute('data-cod-band', 'MED');
  await expect(readout).toContainText(/middle tier/i);

  // LOW + No → LOW (bottom tier)
  await page.getByTestId('cod-value-low').click();
  await expect(readout.locator('[data-cod-band]')).toHaveAttribute('data-cod-band', 'LOW');
  await expect(readout).toContainText(/bottom tier/i);

  expect(errors).toEqual([]);
});

test('@a11y @s018 A11Y-S018-2-7/8/10 — focus rings on radio/textarea/nav; hit boxes ≥ 24×24; axe color-contrast clean with step 2 live', async ({ page }) => {
  await openStep2(page);

  // focus rings (computed outline or box-shadow) on a radio, a textarea, Next
  for (const tid of ['cod-value-high', 'cod-risk', 'wizard-next']) {
    const el = page.getByTestId(tid);
    await el.focus();
    const cs = await el.evaluate((node) => {
      const s = window.getComputedStyle(node);
      return { outline: s.outline, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
    });
    const hasRing =
      (cs.outline !== 'none' && cs.outlineWidth !== '0px') ||
      (cs.boxShadow && cs.boxShadow !== 'none');
    expect(hasRing, `${tid} focus ring: outline="${cs.outline}" shadow="${cs.boxShadow}"`).toBe(true);
  }

  // target sizes ≥ 24×24 (WCAG 2.2 §2.5.8): all five radios + Back + Next
  for (const tid of [
    'cod-value-high', 'cod-value-med', 'cod-value-low',
    'cod-urgency-yes', 'cod-urgency-no', 'wizard-back', 'wizard-next',
  ]) {
    const box = await page.getByTestId(tid).boundingBox();
    expect(box.width, `${tid} width`).toBeGreaterThanOrEqual(24);
    expect(box.height, `${tid} height`).toBeGreaterThanOrEqual(24);
  }

  // axe: zero color-contrast violations with the scored readout visible
  await page.getByTestId('cod-value-high').click();
  await page.getByTestId('cod-urgency-yes').click();
  await expect(page.getByTestId('cod-score-readout').locator('[data-cod-band]')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const contrast = results.violations.filter(
    (v) => v.id === 'color-contrast' || v.id === 'color-contrast-enhanced',
  );
  expect(contrast, JSON.stringify(contrast, null, 2)).toEqual([]);
  // and no label violations on the new controls
  const label = results.violations.filter((v) => v.id === 'label');
  expect(label, JSON.stringify(label, null, 2)).toEqual([]);
});

test('NOWRITE-S018-2-1/2 — the FULL step-2 interaction issues ZERO write-method requests; the server write-guard still 405s', async ({ page, request }) => {
  const writes = [];
  page.on('request', (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) {
      writes.push(`${req.method()} ${req.url()}`);
    }
  });
  await openStep2(page);
  await page.getByTestId('cod-value-high').click();
  await page.getByTestId('cod-urgency-yes').click();
  await page.getByTestId('cod-urgency-why').fill('a deadline approaches');
  await page.getByTestId('cod-risk').fill('the defect class keeps recurring');
  await page.getByTestId('wizard-back').click(); // NAV-S018-2-2 round trip
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('cod-value-high')).toBeChecked(); // draft kept
  await expect(page.getByTestId('cod-urgency-why')).toHaveValue('a deadline approaches');
  expect(writes).toEqual([]);

  // NOWRITE-S018-2-2 / SM-CHK7-6: the read-only guard stays active
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const res = await request[method]('/api/projects/demo/items');
    expect(res.status()).toBe(405);
  }
});
