// @covers uc-s014-3
// @covers PromptBuilder
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
import { test, expect } from '@playwright/test';

const LIVE_DATA = !!process.env.REUSE_SERVER;
test.skip(!LIVE_DATA, 'real-data probe only runs with REUSE_SERVER=1 (live observatory data)');

const ITEM_ID = 'REQ-OBSERVATORY';
const ITEM_JOB = 'Observe and steer the delivery-agent pipeline from a single local read-only surface';
const TREE_ROW = `[data-item-id="${ITEM_ID}"] > .tree-node__row`;
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const INTENT = 'live probe: confirm the steer prompt is generated from real item context';

test('LIVE — Generate fills a /defect prompt with the real id, real job, intent verbatim', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await page.locator(TREE_BTN).click();
  await page.locator('[data-testid="steer-action-raise-defect"]').click();
  await expect(page.getByTestId('steer-context')).toBeVisible();

  await page.getByTestId('intent-note').fill(INTENT);
  await page.getByTestId('steer-generate').click();

  const out = page.locator('[data-testid="prompt-output"]');
  await expect(out).toBeVisible();
  const text = await out.textContent();
  expect(text).toMatch(/^\/defect\b/);
  expect(text).toContain(`${ITEM_ID} — ${ITEM_JOB}`); // real id WITH real job sentence
  expect(text).toContain(INTENT); // operator intent verbatim
  expect(text).toContain('Project: observatory'); // live project, derived from sourceRef
  expect(text).not.toMatch(/\{\{[^}]*\}\}/);
  // evidence for result.md (EXP-033: copy of a live generated prompt)
  console.log('--- LIVE GENERATED PROMPT (REQ-OBSERVATORY) ---\n' + text);
});
