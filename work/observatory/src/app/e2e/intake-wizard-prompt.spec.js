// @covers uc-s018-4
// @covers PromptStep
// @covers intakePromptBuilder
// @covers IntakeWizard
// UC-S018-4 — the intake prompt builder + clipboard handoff in a REAL browser.
// What jsdom cannot prove (the browser-discipline gaps for this UC):
//   AC-S018-4-1/2/3 — the FULL wizard walk (JTBD → CoD → rank → Generate) yields
//                 a /intake prompt carrying all six fields verbatim; the Copy
//                 button puts the EXACT displayed bytes on the OS clipboard +
//                 shows the toast; the first line is a valid /intake command.
//   FREEZE-S018-4-1/2/3 — prompt appears only on Generate; an upstream edit does
//                 NOT silently refresh the shown prompt; the regenerate cue fires.
//   NOWRITE-S018-4-1/2 — zero write-method requests across the whole step-4
//                 interaction; NO new items GET on step 4 (rank read from lift);
//                 the server write-guard still 405s; the clipboard is the ONLY
//                 write surface.
//   GEO-S018-4-1/2/3 — the step-3→step-4 swap + the prompt render reflow nothing
//                 outside the fixed drawer; the prompt scrolls internally; the
//                 step content stacks; the drawer stays on-screen.
//   A11Y-S018-4-1/2/4/5/6/7 — role=group /generate prompt/i, <h3> order, the
//                 reused focusable+labelled <pre>, focus rings, ≥24px hit boxes,
//                 axe color-contrast + heading-order clean with step 4 live.
//   NAV-S018-4-1/3/4 — step 4 current, no "(soon)", no placeholder; Done closes +
//                 returns focus to the launcher; Start another resets to step 1.
//
// FIXTURE (playwright.config.js): the read points at e2e/fixtures/repo — 4
// non-terminal HIGH backlog rows, so a HIGH wizard item ranks alongside all 4.
// Stable selectors only — the UC-S018-4 contract (ui-design.md).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ITEMS_GET = /\/api\/projects\/[^/]+\/items(\?|$)/;

const JTBD = {
  situation: 'the intake queue starves because no UI work is framed',
  motivation: 'capture a new work idea as a structured job',
  outcome: 'hand a costed, ranked intake prompt to Claude',
};
const URGENCY_WHY = 'the loop is idle right now and needs fresh UI work';
const RISK = 'engineers sit idle while the constraint stalls';

const openWizard = async (page) => {
  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();
};
const fillJtbd = async (page) => {
  await page.getByTestId('jtbd-situation').fill(JTBD.situation);
  await page.getByTestId('jtbd-motivation').fill(JTBD.motivation);
  await page.getByTestId('jtbd-outcome').fill(JTBD.outcome);
};
const completeCod = async (page, value = 'high', urgency = 'yes') => {
  await page.getByTestId(`cod-value-${value}`).click();
  await page.getByTestId(`cod-urgency-${urgency}`).click();
  await page.getByTestId('cod-urgency-why').fill(URGENCY_WHY);
  await page.getByTestId('cod-risk').fill(RISK);
};
const next = (page) => page.getByTestId('wizard-next').click();

/** Drive the FULL wizard to step 4 with rank fetched. */
const toStep4 = async (page) => {
  await openWizard(page);
  await fillJtbd(page);
  await next(page); // → step 2
  await completeCod(page);
  await next(page); // → step 3
  await expect(page.getByTestId('rank-preview')).toBeVisible();
  await next(page); // → step 4
  await expect(page.getByTestId('prompt-step')).toBeVisible();
};

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('view-switch')).toBeVisible();
});

test('NAV-S018-4-1 — step 4 is current + built (no "(soon)"); PromptStep replaces the LAST placeholder; "Next" is ABSENT', async ({ page }) => {
  await toStep4(page);
  const s4 = page.getByTestId('wizard-step-4');
  await expect(s4).toHaveAttribute('data-step-state', 'current');
  await expect(s4).toHaveAttribute('aria-current', 'step');
  await expect(s4.locator('.wizard-step__soon')).toHaveCount(0);
  await expect(page.getByTestId('wizard-step-placeholder')).toHaveCount(0); // gone everywhere
  await expect(page.getByTestId('wizard-next')).toHaveCount(0); // no 5th step
  await expect(page.getByTestId('wizard-back')).toBeVisible();
  // the always-visible NOWRITE affordance (NOWRITE-S018-4-3)
  await expect(page.getByTestId('intake-nowrite-note')).toContainText(/writes nothing/i);
});

test('FREEZE-S018-4-1 / AC-S018-4-1/3 — prompt appears only on Generate; carries all six fields + a valid /intake command line', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));

  await toStep4(page);
  // FREEZE-S018-4-1: no prompt before Generate
  await expect(page.getByTestId('prompt-output')).toHaveCount(0);
  await page.getByTestId('intake-generate').click();

  const pre = page.getByTestId('prompt-output');
  await expect(pre).toBeVisible();
  const text = await pre.textContent();
  // AC-S018-4-3: the first line is a valid /intake command with the job sentence
  expect(text.split('\n')[0]).toMatch(/^\/intake When .+, I want to .+, so I can .+\.$/);
  // AC-S018-4-1: all six required fields verbatim
  expect(text).toContain(JTBD.situation);
  expect(text).toContain(JTBD.motivation);
  expect(text).toContain(JTBD.outcome);
  expect(text).toMatch(/Value signal:\s*HIGH/);
  expect(text).toContain(URGENCY_WHY);
  // FIG-S018-4-1: no token residue / junk; FIG-S018-4-4: no raw refs
  expect(text).not.toMatch(/\{\{|undefined|null|NaN/);
  expect(text).not.toMatch(/UC-|CHK-|REQ-|row:\d+/);
  // the rank line (verbatim step-3 sentence) is present (CoD complete + rank ready)
  expect(text).toMatch(/Queue rank/);
  expect(errors).toEqual([]);
});

test('AC-S018-4-2 — Copy puts the EXACT displayed <pre> bytes on the clipboard + shows the toast', async ({ page }) => {
  await toStep4(page);
  await page.getByTestId('intake-generate').click();
  const shown = await page.getByTestId('prompt-output').textContent();
  await page.getByTestId('copy-prompt-btn').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(shown); // byte-equal — the operator copies what they reviewed
  await expect(page.getByTestId('copy-toast')).toContainText(/copied to clipboard/i);
});

test('FREEZE-S018-4-2/3 — an upstream edit does NOT refresh the shown prompt; the regenerate cue fires; Re-generate refreshes', async ({ page }) => {
  await toStep4(page);
  await page.getByTestId('intake-generate').click();
  const frozen = await page.getByTestId('prompt-output').textContent();
  await expect(page.getByTestId('intake-regenerate-cue')).toHaveCount(0);

  // go Back to step 1, change the situation, return to step 4
  await page.getByTestId('wizard-back').click(); // → 3
  await page.getByTestId('wizard-back').click(); // → 2
  await page.getByTestId('wizard-back').click(); // → 1
  await page.getByTestId('jtbd-situation').fill('a COMPLETELY different situation');
  await next(page); // → 2
  await next(page); // → 3
  await expect(page.getByTestId('rank-preview')).toBeVisible();
  await next(page); // → 4
  await expect(page.getByTestId('prompt-step')).toBeVisible();

  // the shown prompt is byte-identical to the frozen one (no silent live rebuild)
  expect(await page.getByTestId('prompt-output').textContent()).toBe(frozen);
  // the divergence is signalled (text + glyph, not colour alone)
  const cue = page.getByTestId('intake-regenerate-cue');
  await expect(cue).toHaveAttribute('data-state', 'updated');
  await expect(cue).toHaveAttribute('role', 'status');
  await expect(cue).toContainText(/regenerate|inputs changed/i);

  // Re-generate rebuilds from current inputs + clears the cue
  await page.getByTestId('intake-generate').click();
  const refreshed = await page.getByTestId('prompt-output').textContent();
  expect(refreshed).not.toBe(frozen);
  expect(refreshed).toContain('a COMPLETELY different situation');
  await expect(page.getByTestId('intake-regenerate-cue')).toHaveCount(0);
});

test('NAV-S018-4-3 — Done closes the wizard and returns focus to the launcher', async ({ page }) => {
  await toStep4(page);
  await page.getByTestId('intake-generate').click();
  await page.getByTestId('intake-done').click();
  await expect(page.getByTestId('intake-wizard')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Work' })).toBeFocused();
});

test('NAV-S018-4-4 — Start another resets to step 1 with the draft cleared', async ({ page }) => {
  await toStep4(page);
  await page.getByTestId('intake-generate').click();
  await page.getByTestId('intake-start-another').click();
  await expect(page.getByTestId('wizard-step-1')).toHaveAttribute('data-step-state', 'current');
  await expect(page.getByTestId('job-sentence-preview')).toContainText(/start typing/i);
  await expect(page.getByTestId('jtbd-situation')).toHaveValue('');
});

test('NOWRITE-S018-4-1/2 — the FULL step-4 interaction issues ZERO writes + NO new items GET; the write-guard still 405s', async ({ page, request }) => {
  const writes = [];
  const itemsGets = [];
  page.on('request', (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) writes.push(`${req.method()} ${req.url()}`);
    if (req.method() === 'GET' && ITEMS_GET.test(req.url())) itemsGets.push(req.url());
  });
  await toStep4(page);
  expect(itemsGets.length, 'exactly one items GET by step 4 (step-3 entry)').toBe(1);
  await page.getByTestId('intake-generate').click();
  await page.getByTestId('copy-prompt-btn').click();
  await page.getByTestId('wizard-back').click(); // back to step 3 — no 2nd GET
  await expect(page.getByTestId('queue-rank-step')).toBeVisible();
  expect(writes, 'no write-method requests in step 4').toEqual([]);
  expect(itemsGets.length, 'NO new items GET on step 4 (rank read from lifted state)').toBe(1);

  for (const method of ['post', 'put', 'patch', 'delete']) {
    const res = await request[method]('/api/projects/demo/items');
    expect(res.status()).toBe(405);
  }
});

test('GEO-S018-4-1/2/3 — the step-3→step-4 swap + Generate reflow NOTHING outside the fixed drawer; content stacks; drawer on-screen', async ({ page }) => {
  await openWizard(page);
  await fillJtbd(page);
  await next(page);
  await completeCod(page);
  await next(page);
  await expect(page.getByTestId('rank-preview')).toBeVisible();

  const snap = async () => ({
    map: await page.getByTestId('value-stream-map').boundingBox(),
    ...(await page.evaluate(() => ({
      col: document.querySelector('.observatory-main-col').scrollHeight,
      scrollW: document.documentElement.scrollWidth,
    }))),
  });
  const before = await snap();
  await next(page); // → step 4
  await expect(page.getByTestId('prompt-step')).toBeVisible();
  const afterSwap = await snap();
  expect(afterSwap.map).toEqual(before.map); // GEO-S018-4-1: zero external reflow
  expect(afterSwap.col).toBe(before.col);
  expect(afterSwap.scrollW).toBe(before.scrollW);

  await page.getByTestId('intake-generate').click();
  await expect(page.getByTestId('prompt-output')).toBeVisible();
  const afterGen = await snap();
  expect(afterGen.map).toEqual(before.map); // GEO-S018-4-1: Generate reflows nothing outside
  expect(afterGen.col).toBe(before.col);
  expect(afterGen.scrollW).toBe(before.scrollW);

  // GEO-S018-4-3: prompt-step content STACKS (heading → nowrite → generate →
  // prompt → copy → terminal): monotonic tops, shared left within box padding.
  const tids = ['prompt-step-heading', 'intake-nowrite-note', 'intake-generate', 'prompt-output', 'copy-prompt-btn', 'intake-done'];
  const boxes = [];
  for (const tid of tids) boxes.push(await page.getByTestId(tid).boundingBox());
  for (let i = 0; i < boxes.length - 1; i += 1) {
    expect(boxes[i + 1].y, `row ${i + 1} below row ${i}`).toBeGreaterThan(boxes[i].y);
  }
  const sectionLeft = (await page.getByTestId('prompt-step').boundingBox()).x;
  for (let i = 0; i < boxes.length; i += 1) {
    expect(boxes[i].x - sectionLeft, `row ${i} left within padding`).toBeLessThanOrEqual(24);
    expect(boxes[i].x - sectionLeft, `row ${i} not left of section`).toBeGreaterThanOrEqual(0);
  }

  // GEO-S018-4-2: the prompt <pre> scrolls INTERNALLY (max-height bounded);
  // the drawer stays within the viewport.
  const preCs = await page.getByTestId('prompt-output').evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    clientH: el.clientHeight,
    vh: window.innerHeight,
  }));
  expect(preCs.overflowY).toBe('auto');
  expect(preCs.clientH).toBeLessThanOrEqual(preCs.vh);
  const wiz = await page.getByTestId('intake-wizard').boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  expect(wiz.x).toBeGreaterThanOrEqual(0);
  expect(wiz.x + wiz.width).toBeLessThanOrEqual(vw + 1);
});

test('@a11y @s018 A11Y-S018-4-1/2/5/6/7 — role=group /generate prompt/i + <h3>; focusable labelled <pre>; focus rings; ≥24px; axe contrast + heading-order clean', async ({ page }) => {
  await toStep4(page);
  await page.getByTestId('intake-generate').click();
  await expect(page.getByTestId('prompt-output')).toBeVisible();

  // role=group named /generate prompt/i, labelled by the <h3>
  const region = page.getByRole('group', { name: /generate prompt/i });
  await expect(region).toBeVisible();
  const heading = page.getByTestId('prompt-step-heading');
  expect(await heading.evaluate((el) => el.tagName.toLowerCase())).toBe('h3');

  // the REUSED prompt <pre> is focusable + labelled (A11Y-S018-4-2)
  const pre = page.getByTestId('prompt-output');
  await expect(pre).toHaveAttribute('aria-label', 'Generated prompt');
  await expect(pre).toHaveAttribute('tabindex', '0');

  // focus rings + ≥24px on the step-4 controls (A11Y-S018-4-5/6)
  for (const tid of ['intake-generate', 'copy-prompt-btn', 'intake-done', 'intake-start-another']) {
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
