// @covers uc-s015-4
// @covers ReslicePreviewPanel
// @covers PromptBuilder
// @covers CopyPromptButton
// UC-S015-4 — enriched re-slice/split prompt, REAL-DATA probe (EXP-033 policy).
//
// Runs ONLY when REUSE_SERVER=1 (live :5173 observatory server with the real
// work/observatory items.csv). The fixture-backed reslice-prompt.spec.js
// covers AC-1/2/4 + presentation/GEO deterministically; this spec drives the
// SAME generate path against a LIVE item so the slice's real-data
// done-condition has a committed, parameterised probe (not a tester hand-off).
//
// REAL ITEM ANCHOR: REQ-OBSERVATORY (same anchor as steer-prompt-real-data) —
// update if it is renamed/removed from work/observatory/items/items.csv.
import { test, expect } from '@playwright/test';

const LIVE_DATA = !!process.env.REUSE_SERVER;
test.skip(!LIVE_DATA, 'real-data probe only runs with REUSE_SERVER=1 (live observatory data)');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const ITEM_ID = 'REQ-OBSERVATORY';
const ITEM_JOB = 'Observe and steer the delivery-agent pipeline from a single local read-only surface';
const TREE_ROW = `[data-item-id="${ITEM_ID}"] > .tree-node__row`;
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const PANEL = '[data-testid="reslice-preview-panel"]';
const OUTPUT = '[data-testid="prompt-output"]';

const PART_A = 'live probe Part A: observe the pipeline';
const PART_B = 'live probe Part B: steer the pipeline';
const INTENT = 'live probe: confirm the enriched split prompt is generated from real item context';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.locator(TREE_BTN)).toBeVisible();
});

test('LIVE — re-slice on a real item renders the enriched /slice-next prompt; copy is byte-equal', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => { if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`); });

  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-re-slice"]').click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByTestId('reslice-before-id')).toHaveText(`${ITEM_ID} — ${ITEM_JOB}`);

  await page.getByTestId('part-a-job').fill(PART_A);
  await page.getByTestId('part-b-job').fill(PART_B);
  await page.getByTestId('reslice-intent').fill(INTENT);
  await page.getByTestId('reslice-generate').click();

  const out = page.locator(OUTPUT);
  await expect(out).toBeVisible();
  const text = await out.textContent();
  expect(text).toMatch(/^\/slice-next\b/);
  expect(text).toContain(`${ITEM_ID} — ${ITEM_JOB}`); // real id WITH real job sentence (before)
  expect(text).toContain('Proposed split:');
  expect(text).toContain(`Part A: ${PART_A}`); // after
  expect(text).toContain(`Part B: ${PART_B}`); // after
  expect(text).toContain(INTENT); // operator intent verbatim
  expect(text).toContain('Project: observatory'); // live project, derived from sourceRef
  expect(text).not.toMatch(/\{\{[^}]*\}\}/);

  // inherited copy idiom: clipboard read-back === displayed bytes
  await page.getByTestId('copy-prompt-btn').click();
  await expect(page.getByTestId('copy-toast')).toBeVisible({ timeout: 2000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(text);

  // generation + copy are client-side only — zero non-GET traffic on real data
  expect(writes).toEqual([]);
});
