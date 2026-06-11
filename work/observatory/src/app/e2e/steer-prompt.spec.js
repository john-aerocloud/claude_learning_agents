// @covers uc-s014-3
// @covers PromptBuilder
// @covers SteerPanel
// UC-S014-3 — prompt builder, REAL-BROWSER conditions (fixture repo):
//   AC-1   Generate → filled prompt visible in the reserved slot: slash verb,
//          item id WITH job sentence, operator intent VERBATIM
//   AC-2   re-prioritise prompt carries the human verb, never a bare enum key
//   AC-4   prompt generation is client-side only — ZERO network requests fire
//          between typing the intent and the prompt appearing
//   FIG    no {{token}} residue; no raw row refs (sourceRef path) in the output
//   SELECT the output is selectable text (computed user-select, and a real
//          selection drive returns the prompt text)
//   UC-4-  the copy button / toast do NOT exist yet (UC-S014-4 pinned absent)
//
// Fixture repo: tree row REQ-DEMO is a REAL items.csv item (job "Demo
// requirement for the work-item tree e2e") — same anchor as steer-panel.spec.js.
import { test, expect } from '@playwright/test';

const TREE_ROW = '[data-item-id="REQ-DEMO"] > .tree-node__row';
const TREE_BTN = `${TREE_ROW} [data-testid="steer-btn"]`;
const PANEL = '[data-testid="steer-panel"]';
const OUTPUT = '[data-testid="prompt-output"]';

const REQ_JOB = 'Demo requirement for the work-item tree e2e';
const INTENT = 'the chip wait badge shows 0 for items queued overnight';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.locator(TREE_ROW)).toBeVisible();
});

/** Open the steer panel for REQ-DEMO with the given action and type the intent. */
async function openAndType(page, action, intent = INTENT) {
  await page.locator(TREE_BTN).click();
  await page.locator(`[data-testid="steer-action-${action}"]`).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByTestId('steer-context')).toBeVisible(); // status=ready
  await page.getByTestId('intent-note').fill(intent);
}

test('AC-1 — Generate renders the filled /defect prompt: verb + human refs + intent verbatim', async ({ page }) => {
  await openAndType(page, 'raise-defect');
  await page.getByTestId('steer-generate').click();

  const out = page.locator(OUTPUT);
  await expect(out).toBeVisible();
  const text = await out.textContent();
  expect(text).toMatch(/^\/defect\b/);
  expect(text).toContain(`REQ-DEMO — ${REQ_JOB}`); // id WITH job sentence
  expect(text).toContain(INTENT); // operator's words, verbatim
  expect(text).toContain('Project: demo'); // fixture repo project
  expect(text).not.toMatch(/\{\{[^}]*\}\}/); // no token residue
  expect(text).not.toContain('items.csv#'); // no raw row refs
  // the output lives INSIDE the UC-S014-2 reserved slot
  await expect(page.locator(`[data-testid="prompt-output-slot"] ${OUTPUT}`)).toBeVisible();
});

test('AC-2 — re-prioritise prompt carries the human verb (never a bare enum key)', async ({ page }) => {
  await openAndType(page, 're-prioritise');
  await page.getByTestId('steer-generate').click();
  const text = await page.locator(OUTPUT).textContent();
  expect(text).toMatch(/^\/intake\b/);
  expect(text).toMatch(/re-prioritis/i);
  expect(text).toContain('REQ-DEMO');
});

test('AC-4 — generation fires ZERO network requests (pure client-side)', async ({ page }) => {
  await openAndType(page, 're-slice');
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.getByTestId('steer-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();
  const apiCalls = requests.filter((u) => u.includes('/api/'));
  expect(apiCalls).toEqual([]);
});

test('the prompt is SELECTABLE text — a real selection returns the prompt bytes', async ({ page }) => {
  await openAndType(page, 'custom');
  await page.getByTestId('steer-generate').click();
  const out = page.locator(OUTPUT);
  await expect(out).toBeVisible();
  // computed style: nothing upstream disables selection
  const userSelect = await out.evaluate((el) => getComputedStyle(el).userSelect);
  expect(userSelect).toBe('text');
  // real drive: select the node's contents and read the selection back
  const selected = await out.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString();
  });
  expect(selected).toContain(INTENT);
  expect(selected).toMatch(/^Steer request — demo/);
});

test('UC-S014-4 boundary — no copy button, no toast (clipboard copy NOT built here)', async ({ page }) => {
  await openAndType(page, 'raise-defect');
  await page.getByTestId('steer-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();
  await expect(page.locator(PANEL).getByRole('button', { name: /copy/i })).toHaveCount(0);
  await expect(page.getByTestId('copy-toast')).toHaveCount(0);
});
