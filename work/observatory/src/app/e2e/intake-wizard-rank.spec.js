// @covers uc-s018-3
// @covers QueueRankStep
// @covers useQueueRank
// @covers queueRank
// UC-S018-3 — the queue-rank preview step in a REAL browser. What jsdom cannot
// prove (the browser-discipline gaps for this UC):
//   AC-S018-3-1/2/3/4 — the directional rank end-to-end against the LIVE items
//                 endpoint; exactly ONE items GET; a tier change re-derives with
//                 NO second GET; the empty-queue path.
//   NOWRITE-S018-3-1/2/3 — exactly one GET + zero writes across the full step-3
//                 interaction; no items GET while on steps 1–2; write-guard 405.
//   GEO-S018-3-1/2/3 — the step-2→step-3 swap reflows nothing outside the fixed
//                 drawer; the rank-step content stacks; the drawer stays on-screen.
//   A11Y-S018-3-1..8 — role=status/aria-live, <h3> order, within-step focus
//                 order, focus rings, ≥24px hit boxes, axe color-contrast.
//   FIG-S018-3-1..4 — the directional sentence reads in human words end-to-end,
//                 console error-free; loading/empty/error/gated distinctness.
//
// FIXTURE (playwright.config.js): the read points at e2e/fixtures/repo. Its
// items.csv non-terminal (non-done/dropped) backlog = 4 rows, ALL value HIGH
// (REQ-DEMO active, CHK-4 in-progress, UC-S004-1 ready, UC-D4-1 ready). So a
// HIGH wizard item ranks alongside all 4 (ahead 0 / behind 0); a LOW/MED item
// ranks ahead of all 4. (The 3 done rows never count — RANK-S018-3-5.)
// Stable selectors only — the rank-* contract (ui-design.md UC-S018-3).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ITEMS_GET = /\/api\/projects\/[^/]+\/items(\?|$)/;

const openWizard = async (page) => {
  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();
};
const toStep2 = async (page) => {
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('cod-step')).toBeVisible();
};
const completeCod = async (page, value = 'high', urgency = 'yes') => {
  await page.getByTestId(`cod-value-${value}`).click();
  await page.getByTestId(`cod-urgency-${urgency}`).click();
};
const toStep3 = async (page) => {
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('queue-rank-step')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('view-switch')).toBeVisible();
});

test('NOWRITE-S018-3-2 — NO items GET while on steps 1–2; the read fires on step-3 ENTRY (exactly one GET) — AC-S018-3-2', async ({ page }) => {
  const itemsGets = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && ITEMS_GET.test(req.url())) itemsGets.push(req.url());
  });
  await openWizard(page); // step 1 — no items GET
  await toStep2(page); // step 2 — still no items GET
  expect(itemsGets, 'no items GET while currentStep < 3').toEqual([]);
  await completeCod(page);
  await toStep3(page); // step 3 — the ONE read fires
  await expect(page.getByTestId('rank-preview')).toBeVisible();
  expect(itemsGets.length, 'exactly one items GET on step-3 entry').toBe(1);
});

test('AC-S018-3-1 / FIG-S018-3-1 — directional sentence end-to-end: HIGH item ranks alongside the 4 HIGH backlog rows (ahead 0); human words, no undefined/NaN; console error-free', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await openWizard(page);
  await toStep2(page);
  await completeCod(page, 'high', 'yes'); // token HIGH
  await toStep3(page);

  const preview = page.getByTestId('rank-preview');
  await expect(preview).toHaveAttribute('role', 'status');
  await expect(preview).toHaveAttribute('aria-live', 'polite');
  // fixture: 4 non-terminal rows, all HIGH → HIGH item ahead 0 / behind 0 / total 4
  await expect(preview).toHaveAttribute('data-rank-ahead', '0');
  await expect(preview).toHaveAttribute('data-rank-behind', '0');
  await expect(preview).toHaveAttribute('data-rank-total', '4');
  await expect(preview).toContainText(/HIGH value/);
  await expect(preview).toContainText(/ahead of/i);
  await expect(preview).toContainText(/behind/i);
  await expect(preview).toContainText(/items|item/);
  await expect(preview).toContainText(/alongside 4/i); // same-tier peers surfaced
  await expect(preview).not.toContainText(/undefined|null|NaN/);
  // FIG-S018-3-2: no raw machine ids in the sentence
  await expect(preview).not.toContainText(/UC-|CHK-|REQ-/);
  expect(errors).toEqual([]);
});

test('AC-S018-3-3 / NOWRITE-S018-3-1 — a tier change re-derives the rank with NO second items GET (LOW item ranks ahead of all 4)', async ({ page }) => {
  const itemsGets = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && ITEMS_GET.test(req.url())) itemsGets.push(req.url());
  });
  await openWizard(page);
  await toStep2(page);
  await completeCod(page, 'high', 'yes'); // HIGH
  await toStep3(page);
  await expect(page.getByTestId('rank-preview')).toHaveAttribute('data-rank-ahead', '0');
  expect(itemsGets.length).toBe(1);

  // Back, change to LOW, forward — rank re-derives from the CACHED items
  await page.getByTestId('wizard-back').click();
  await expect(page.getByTestId('cod-step')).toBeVisible();
  await completeCod(page, 'low', 'no'); // LOW
  await page.getByTestId('wizard-next').click();
  const preview = page.getByTestId('rank-preview');
  await expect(preview).toBeVisible();
  // LOW item: ahead of all 4 HIGH rows, behind 0
  await expect(preview).toHaveAttribute('data-rank-ahead', '4');
  await expect(preview).toHaveAttribute('data-rank-behind', '0');
  await expect(preview).toContainText(/LOW value/);
  await expect(preview).toContainText(/bottom/i);
  // CRITICAL: still exactly one GET — the items were cached for the session
  expect(itemsGets.length, 'no second items GET on a tier change').toBe(1);
});

test('NAV-S018-3-3 (gated path) — step 3 with an incomplete CoD shows rank-gated (no rank/number); completing step 2 then returning shows the real rank', async ({ page }) => {
  await openWizard(page);
  await toStep2(page); // no CoD chosen
  await page.getByTestId('wizard-next').click(); // step 3 — gated
  await expect(page.getByTestId('queue-rank-step')).toBeVisible();
  const gated = page.getByTestId('rank-gated');
  await expect(gated).toBeVisible();
  await expect(gated).toContainText(/value and urgency|previous step/i);
  await expect(page.getByTestId('rank-preview')).toHaveCount(0);
  // complete CoD, return → real rank
  await page.getByTestId('wizard-back').click();
  await expect(page.getByTestId('cod-step')).toBeVisible();
  await completeCod(page, 'high', 'yes');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('rank-preview')).toBeVisible();
  await expect(page.getByTestId('rank-gated')).toHaveCount(0);
});

test('NAV-S018-3-1 — step 3 current; QueueRankStep replaces the placeholder; step 3 lost "(soon)"; the placeholder survives only for step 4 (A11Y-S018-3-8)', async ({ page }) => {
  await openWizard(page);
  await toStep2(page);
  await completeCod(page);
  await toStep3(page);
  const s3 = page.getByTestId('wizard-step-3');
  await expect(s3).toHaveAttribute('data-step-state', 'current');
  await expect(s3).toHaveAttribute('aria-current', 'step');
  await expect(s3.locator('.wizard-step__soon')).toHaveCount(0);
  await expect(page.getByTestId('wizard-step-placeholder')).toHaveCount(0);
  // step 4 still planned + placeholder
  await expect(page.getByTestId('wizard-step-4').locator('.wizard-step__soon')).toHaveCount(1);
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('wizard-step-placeholder')).toContainText(/intake prompt/i);
});

test('GEO-S018-3-1/2/3 — the step-2→step-3 swap reflows NOTHING outside the fixed drawer; the rank content stacks; the drawer stays on-screen', async ({ page }) => {
  await openWizard(page);
  await toStep2(page);
  await completeCod(page);

  const before = {
    map: await page.getByTestId('value-stream-map').boundingBox(),
    ...(await page.evaluate(() => ({
      col: document.querySelector('.observatory-main-col').scrollHeight,
      scrollW: document.documentElement.scrollWidth,
    }))),
  };

  await toStep3(page);
  await expect(page.getByTestId('rank-preview')).toBeVisible();

  const after = {
    map: await page.getByTestId('value-stream-map').boundingBox(),
    ...(await page.evaluate(() => ({
      col: document.querySelector('.observatory-main-col').scrollHeight,
      scrollW: document.documentElement.scrollWidth,
    }))),
  };
  expect(after.map).toEqual(before.map); // GEO-S018-3-1: zero external reflow
  expect(after.col).toBe(before.col);
  expect(after.scrollW).toBe(before.scrollW); // no horizontal scrollbar

  // GEO-S018-3-2: rank content STACKS (heading → sentence → nav): monotonic
  // tops (a column, not a row). The heading sits at the section's left edge;
  // the sentence is a bordered box, so its content-left is padded — the column
  // anchor is the SECTION left edge, which both share within the box padding.
  const boxes = [];
  for (const tid of ['rank-step-heading', 'rank-preview', 'wizard-back']) {
    boxes.push(await page.getByTestId(tid).boundingBox());
  }
  for (let i = 0; i < boxes.length - 1; i += 1) {
    expect(boxes[i + 1].y, `row ${i + 1} below row ${i}`).toBeGreaterThan(boxes[i].y);
  }
  // shared left within one box-padding tolerance (the s002-line column guard)
  const sectionLeft = (await page.getByTestId('queue-rank-step').boundingBox()).x;
  for (let i = 0; i < boxes.length; i += 1) {
    expect(boxes[i].x - sectionLeft, `row ${i} left within section padding`).toBeLessThanOrEqual(20);
    expect(boxes[i].x - sectionLeft, `row ${i} not left of the section`).toBeGreaterThanOrEqual(0);
  }

  // GEO-S018-3-3: drawer fully within the viewport
  const wiz = await page.getByTestId('intake-wizard').boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  expect(wiz.x).toBeGreaterThanOrEqual(0);
  expect(wiz.x + wiz.width).toBeLessThanOrEqual(vw + 1);
});

test('A11Y-S018-3-1/2/3 — labelled status region inside role=group /queue rank/i; <h3> order; within-step focus order reaches Back then Next (the sentence is NOT a tab stop)', async ({ page }) => {
  await openWizard(page);
  await toStep2(page);
  await completeCod(page);
  await toStep3(page);

  // role=group named /queue rank/i, labelled by the <h3>
  const region = page.getByRole('group', { name: /queue rank/i });
  await expect(region).toBeVisible();
  const heading = page.getByTestId('rank-step-heading');
  await expect(heading).toHaveText(/queue rank/i);
  expect(await heading.evaluate((el) => el.tagName.toLowerCase())).toBe('h3');

  // forward focus: the rank region has NO tab stop (the sentence is a
  // role=status, not focusable — A11Y-S018-3-3), so Tab from the wizard heading
  // (the managed-focus landing, tabindex=-1) reaches Back, then Next.
  await page.getByTestId('intake-wizard-heading').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('wizard-back')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('wizard-next')).toBeFocused();
  // confirm the rank sentence is NOT a tab stop
  expect(
    await page.getByTestId('rank-preview').evaluate((el) => el.tabIndex),
    'rank sentence must not be a tab stop',
  ).toBeLessThan(0);
});

test('@a11y @s018 A11Y-S018-3-4/5/6 — focus rings on Back/Next; hit boxes ≥ 24×24; axe color-contrast + heading-order clean with step 3 live', async ({ page }) => {
  await openWizard(page);
  await toStep2(page);
  await completeCod(page);
  await toStep3(page);
  await expect(page.getByTestId('rank-preview')).toBeVisible();

  for (const tid of ['wizard-back', 'wizard-next']) {
    const el = page.getByTestId(tid);
    await el.focus();
    const cs = await el.evaluate((node) => {
      const s = window.getComputedStyle(node);
      return { outline: s.outline, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
    });
    const hasRing =
      (cs.outline !== 'none' && cs.outlineWidth !== '0px') || (cs.boxShadow && cs.boxShadow !== 'none');
    expect(hasRing, `${tid} focus ring`).toBe(true);
    const box = await el.boundingBox();
    expect(box.width, `${tid} width`).toBeGreaterThanOrEqual(24);
    expect(box.height, `${tid} height`).toBeGreaterThanOrEqual(24);
  }

  const results = await new AxeBuilder({ page }).withTags(['wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const contrast = results.violations.filter(
    (v) => v.id === 'color-contrast' || v.id === 'color-contrast-enhanced',
  );
  expect(contrast, JSON.stringify(contrast, null, 2)).toEqual([]);
  const order = results.violations.filter((v) => v.id === 'heading-order');
  expect(order, JSON.stringify(order, null, 2)).toEqual([]);
});

test('NOWRITE-S018-3-1/3 — the FULL step-3 interaction issues ZERO write-method requests; the server write-guard still 405s', async ({ page, request }) => {
  const writes = [];
  page.on('request', (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) writes.push(`${req.method()} ${req.url()}`);
  });
  await openWizard(page);
  await toStep2(page);
  await completeCod(page);
  await toStep3(page);
  await expect(page.getByTestId('rank-preview')).toBeVisible();
  await page.getByTestId('wizard-back').click();
  await completeCod(page, 'low', 'no');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('rank-preview')).toBeVisible();
  expect(writes).toEqual([]);

  for (const method of ['post', 'put', 'patch', 'delete']) {
    const res = await request[method]('/api/projects/demo/items');
    expect(res.status()).toBe(405);
  }
});
