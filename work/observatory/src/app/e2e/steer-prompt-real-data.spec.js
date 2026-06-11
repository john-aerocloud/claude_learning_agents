// @covers uc-s014-3
// @covers uc-s014-4
// @covers PromptBuilder
// @covers PromptOutput
// @covers CopyPromptButton
// UC-S014-3 — prompt builder, REAL-DATA probe (EXP-033 policy).
//
// Runs ONLY when REUSE_SERVER=1 (live :5173 observatory server with the real
// work/observatory items.csv). The fixture-backed steer-prompt.spec.js covers
// AC-1/2/4 + selectability deterministically; this spec drives the SAME
// generate path against a LIVE item so the slice's real-data done-condition
// has a committed, parameterised probe (not a tester hand-off).
//
// REAL ITEM ANCHOR: REQ-OBSERVATORY (same anchor as steer-panel-real-data) —
// update if it is renamed/removed from work/observatory/items/items.csv.
//
// Extended in s014 validation run for UC-S014-3 to add:
//   - re-prioritise spot-check (distinct template, human verb, AC-2)
//   - zero-network assertion on Generate (AC-4)
//   - selectable text assertion (PromptOutput contract)
//   - boundary: PIN FLIPPED by UC-S014-4 (pin-flip ledger) — the copy button
//     now exists and the live probe asserts the clipboard read-back bytes
import { test, expect } from '@playwright/test';

const LIVE_DATA = !!process.env.REUSE_SERVER;
test.skip(!LIVE_DATA, 'real-data probe only runs with REUSE_SERVER=1 (live observatory data)');

const ITEM_ID = 'REQ-OBSERVATORY';
const ITEM_JOB = 'Observe and steer the delivery-agent pipeline from a single local read-only surface';
const TREE_ROW = `[data-item-id="${ITEM_ID}"] > .tree-node__row`;
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const INTENT = 'live probe: confirm the steer prompt is generated from real item context';
const PANEL = '[data-testid="steer-panel"]';
const OUTPUT = '[data-testid="prompt-output"]';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.locator(TREE_BTN)).toBeVisible();
});

test('LIVE — Generate fills a /defect prompt with the real id, real job, intent verbatim', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-raise-defect"]').click();
  await expect(page.getByTestId('steer-context')).toBeVisible();

  await page.getByTestId('intent-note').fill(INTENT);
  await page.getByTestId('steer-generate').click();

  const out = page.locator(OUTPUT);
  await expect(out).toBeVisible();
  const text = await out.textContent();
  expect(text).toMatch(/^\/defect\b/);
  expect(text).toContain(`${ITEM_ID} — ${ITEM_JOB}`); // real id WITH real job sentence
  expect(text).toContain(INTENT); // operator intent verbatim
  expect(text).toContain('Project: observatory'); // live project, derived from sourceRef
  expect(text).not.toMatch(/\{\{[^}]*\}\}/);
  // /defect shape: four real fields (expected, actual, intent, importance)
  expect(text).toMatch(/expected/i);
  expect(text).toMatch(/actual/i);
  expect(text).toMatch(/intent/i);
  expect(text).toMatch(/importance/i);
  // no raw sourceRef leakage
  expect(text).not.toContain('items.csv#');
  // evidence for result.md (EXP-033: copy of a live generated prompt)
  console.log('--- LIVE GENERATED PROMPT (REQ-OBSERVATORY /defect) ---\n' + text);
});

test('LIVE AC-2 — re-prioritise renders distinct /intake template with human verb', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-re-prioritise"]').click();
  await expect(page.getByTestId('steer-context')).toBeVisible();

  await page.getByTestId('intent-note').fill(INTENT);
  await page.getByTestId('steer-generate').click();

  const out = page.locator(OUTPUT);
  await expect(out).toBeVisible();
  const text = await out.textContent();
  expect(text).toMatch(/^\/intake\b/);
  expect(text).toMatch(/re-prioritis/i); // human verb — never the bare 're-prioritise' enum key alone
  expect(text).toContain(ITEM_ID);
  expect(text).not.toMatch(/\{\{[^}]*\}\}/);
  // re-prioritise carries value + cost fields
  expect(text).toContain('HIGH'); // REQ-OBSERVATORY value=HIGH
  expect(text).toContain('XL');   // REQ-OBSERVATORY cost=XL
  console.log('--- LIVE GENERATED PROMPT (REQ-OBSERVATORY /intake) ---\n' + text);
});

test('LIVE AC-4 — Generate fires ZERO /api/ network requests (pure client-side)', async ({ page }) => {
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });

  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-raise-defect"]').click();
  await expect(page.getByTestId('steer-context')).toBeVisible();
  await page.getByTestId('intent-note').fill(INTENT);

  // reset captured calls AFTER the panel has loaded its context fetch
  apiCalls.length = 0;

  await page.getByTestId('steer-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();

  // No /api/ calls on Generate click
  expect(apiCalls).toEqual([]);
});

test('LIVE — prompt output is SELECTABLE text in the reserved slot', async ({ page }) => {
  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-raise-defect"]').click();
  await expect(page.getByTestId('steer-context')).toBeVisible();
  await page.getByTestId('intent-note').fill(INTENT);
  await page.getByTestId('steer-generate').click();

  const out = page.locator(OUTPUT);
  await expect(out).toBeVisible();

  // The output must live inside the reserved slot
  await expect(page.locator(`[data-testid="prompt-output-slot"] ${OUTPUT}`)).toBeVisible();

  // computed user-select: nothing upstream disables selection
  const userSelect = await out.evaluate((el) => getComputedStyle(el).userSelect);
  expect(userSelect).toBe('text');

  // real selection returns prompt bytes
  const selected = await out.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString();
  });
  expect(selected).toContain(INTENT);
});

test('LIVE — PIN FLIPPED (UC-S014-4): copy button present with the prompt; copy puts the EXACT bytes on the clipboard', async ({ page, context }) => {
  // Was: "no copy button / toast (UC-S014-4 pinned absent)" — flipped per the
  // UC-S014-4 pin-flip ledger (replaced, not silently deleted). This is the
  // REAL-DATA copy probe: live item, real clipboard read-back.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-raise-defect"]').click();
  await expect(page.getByTestId('steer-context')).toBeVisible();
  await page.getByTestId('intent-note').fill(INTENT);
  await page.getByTestId('steer-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();

  const copyBtn = page.locator(PANEL).getByRole('button', { name: /copy/i });
  await expect(copyBtn).toHaveCount(1);
  await copyBtn.click();
  await expect(page.getByTestId('copy-toast')).toBeVisible();
  await expect(page.getByTestId('copy-toast')).toContainText(/copied to clipboard/i);

  // PROMPT-COPY-1 on real data: clipboard bytes === displayed <pre> bytes
  const shown = await page.locator(OUTPUT).textContent();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(shown);
  expect(copied).toContain(INTENT);
});
