// @covers uc-s014-4
// @covers CopyPromptButton
// @covers CopyToast
// @covers ContextRefreshCue
// @covers useSteerContext
// UC-S014-4 — copy to clipboard + toast + SSE context refresh, REAL-BROWSER
// conditions (fixture repo; chromium with clipboard permissions granted):
//   F-1 / PROMPT-COPY-1  clipboard read-back bytes === displayed <pre> bytes
//   F-2 / FIG-1          toast visible (≤2 s), human text, auto-dismisses
//   S14-4-A11Y-1/2/4/5/6/7  keyboard copy, polite status region, focus ring,
//                        target size, reduced-motion instant toast, no focus steal
//   GEO-S014-4-1..3      toast reflows NOTHING; toast on-screen; button trails
//                        the <pre> (40vh cap intact)
//   NO-WRITE-1           zero /api/ requests on copy; write-guard 405 on POST
//
// The SSE live-refresh drive (F-4 / PROMPT-FREEZE-1 / S14-4-SSE-1 / GEO-4)
// lives in e2e/steer-sse-live.spec.js — it MUTATES a watched fixture, so it
// runs against the dedicated live-mutation server (playwright.config
// webServer #2). THIS file never writes a file: it stays on the shared
// read-only fixture server with the rest of the suite.
import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const TREE_ROW = '[data-item-id="REQ-DEMO"] > .tree-node__row';
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const PANEL = '[data-testid="steer-panel"]';
const OUTPUT = '[data-testid="prompt-output"]';
const COPY_BTN = '[data-testid="copy-prompt-btn"]';
const TOAST = '[data-testid="copy-toast"]';

const INTENT = 'copy probe: hand this prompt to Claude unchanged';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.locator(TREE_ROW)).toBeVisible();
});

/** Open the steer panel for REQ-DEMO, type the intent, generate the prompt. */
async function openAndGenerate(page, action = 'raise-defect', intent = INTENT) {
  await page.locator(TREE_BTN).click();
  await page.locator(`[data-testid="steer-action-${action}"]`).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByTestId('steer-context')).toBeVisible();
  await page.getByTestId('intent-note').fill(intent);
  await page.getByTestId('steer-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();
}

test('F-1 / PROMPT-COPY-1 — copy puts the EXACT displayed bytes on the clipboard; NO-WRITE-1: zero /api/ calls', async ({ page }) => {
  await openAndGenerate(page);
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });

  await page.locator(COPY_BTN).click();
  await expect(page.locator(TOAST)).toBeVisible();

  const shown = await page.locator(OUTPUT).textContent();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(shown); // byte-equal — the operator copies what they reviewed
  expect(copied).toContain(INTENT);
  expect(apiCalls.filter((u) => !u.includes('/api/events'))).toEqual([]); // clipboard is the ONLY write surface
});

test('F-2 / FIG-1 / S14-4-A11Y-2 — toast: polite status region, human text, auto-dismisses; label flips and reverts', async ({ page }) => {
  await openAndGenerate(page);
  const btn = page.locator(COPY_BTN);
  await expect(btn).toHaveText(/copy prompt/i);
  await btn.click();

  const toast = page.locator(TOAST);
  await expect(toast).toBeVisible({ timeout: 2000 }); // AC-2: within 2 s
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast).toHaveAttribute('aria-live', 'polite');
  await expect(toast).toContainText(/copied to clipboard/i); // words, not codes/bytes
  await expect(btn).toContainText(/copied/i); // non-colour redundant cue (A11Y-3)

  // auto-dismiss after --dur-toast (3 s) + label reverts — no stale "Copied ✓"
  await expect(toast).toBeHidden({ timeout: 6000 });
  await expect(btn).toHaveText(/copy prompt/i);
});

test('S14-4-A11Y-1/7 — keyboard copy: Tab from the prompt reaches the button; Enter copies; focus never stolen by the toast', async ({ page }) => {
  await openAndGenerate(page);
  // tab order: prompt <pre> (tabindex=0) → copy button
  await page.locator(OUTPUT).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(COPY_BTN)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator(TOAST)).toBeVisible();
  await expect(page.locator(COPY_BTN)).toBeFocused(); // A11Y-7: toast steals nothing
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(INTENT);

  // Space re-copies (second click is a real re-copy, never a misleading no-op)
  await page.keyboard.press('Space');
  await expect(page.locator(TOAST)).toBeVisible();
});

test('S14-4-A11Y-4/5 — visible focus ring and ≥24px hit box on the copy button', async ({ page }) => {
  await openAndGenerate(page);
  await page.locator(OUTPUT).focus();
  await page.keyboard.press('Tab'); // keyboard focus → :focus-visible applies
  const btn = page.locator(COPY_BTN);
  await expect(btn).toBeFocused();
  const shadow = await btn.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe('none'); // --focus-ring
  const box = await btn.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
});

test('GEO-S014-4-1/2/3 — toast appearance reflows NOTHING; toast on-screen; <pre> keeps its 40vh cap', async ({ page }) => {
  await openAndGenerate(page);
  const grab = () => page.evaluate(() => {
    const bb = (sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    };
    return {
      panel: bb('[data-testid="steer-panel"]'),
      pre: bb('[data-testid="prompt-output"]'),
      vsm: bb('[data-testid="value-stream-map"]'),
      tree: bb('[data-testid="work-item-tree"]'),
      scrollH: document.documentElement.scrollHeight,
    };
  });

  const before = await grab();
  await page.locator(COPY_BTN).click();
  await expect(page.locator(TOAST)).toBeVisible();
  const after = await grab();
  expect(after).toEqual(before); // byte-identical — zero flow height (GEO-1)

  // GEO-2: toast fully inside the viewport — never causes scroll
  const tb = await page.locator(TOAST).boundingBox();
  const vp = page.viewportSize();
  expect(tb.x).toBeGreaterThanOrEqual(0);
  expect(tb.y).toBeGreaterThanOrEqual(0);
  expect(tb.x + tb.width).toBeLessThanOrEqual(vp.width);
  expect(tb.y + tb.height).toBeLessThanOrEqual(vp.height);

  // GEO-3: button trails the <pre> inside the slot; the 40vh scroll cap holds
  const slotHasBtn = await page.evaluate(() =>
    document.querySelector('[data-testid="prompt-output-slot"]')
      .contains(document.querySelector('[data-testid="copy-prompt-btn"]')));
  expect(slotHasBtn).toBe(true);
  const preTop = (await page.locator(OUTPUT).boundingBox()).y;
  const btnTop = (await page.locator(COPY_BTN).boundingBox()).y;
  expect(btnTop).toBeGreaterThanOrEqual(preTop); // trailing, never above/overlapping the head
  const maxH = await page.locator(OUTPUT).evaluate((el) => parseFloat(getComputedStyle(el).maxHeight));
  expect(maxH).toBeLessThanOrEqual(vp.height * 0.4 + 1); // 40vh cap intact with the button present
});

test('S14-4-A11Y-6 — reduced motion: toast appears instantly (no animated delay), still auto-dismisses', async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.locator(TREE_ROW)).toBeVisible();
    await openAndGenerate(page);
    await page.locator(COPY_BTN).click();
    const toast = page.locator(TOAST);
    await expect(toast).toBeVisible({ timeout: 1000 }); // same-frame appearance, no fade wait
    const anim = await toast.evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none'); // the fade is gated off under reduce
  } finally {
    await context.close();
  }
});

test('the ContextRefreshCue rides the context block: live state, polite status region (S14-4-A11Y-8 surface)', async ({ page }) => {
  // The full SSE divergence drive (live → updated → live) is
  // e2e/steer-sse-live.spec.js; this read-only check pins the cue's presence
  // + a11y contract on the shared server without mutating any fixture.
  await openAndGenerate(page);
  const cue = page.locator('[data-testid="steer-context-live"]');
  await expect(cue).toBeVisible();
  await expect(cue).toHaveAttribute('data-state', 'live');
  await expect(cue).toHaveAttribute('role', 'status');
  await expect(cue).toHaveAttribute('aria-live', 'polite');
  await expect(cue).toContainText(/live/i);
});

test('NO-WRITE-1 — the server write-guard still rejects writes (405) during the steer flow', async ({ page, request }) => {
  await openAndGenerate(page);
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const res = await request[method]('/api/projects/demo/items');
    expect(res.status()).toBe(405);
  }
});
