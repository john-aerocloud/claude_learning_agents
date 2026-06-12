// @covers uc-s015-4
// @covers ReslicePreviewPanel
// @covers PromptBuilder
// @covers CopyPromptButton
// @covers CopyToast
// @covers SPA_OBSVIEW
// UC-S015-4 browser spec — the enriched re-slice/split prompt rendered into
// the ReslicePreviewPanel's reserved output slot, REAL-BROWSER conditions:
//   AC-1/2          the rendered prompt carries all five fields verbatim
//                   (item id + job before, Part A + Part B after, intent) and
//                   the /slice-next "Proposed split:" command form
//   AC-4            generation is client-side only — ZERO non-GET traffic
//   PROMPT-COPY-1   (inherited s014 idiom) clipboard read-back === displayed
//                   <pre> bytes; polite toast confirms
//   PromptOutput presentation (inherited): mono, 40vh cap, selectable text
//   GEO-S015-4-PROMPT  no-reflow on prompt render: the panel may grow
//                   downward INTERNALLY but the page/underlying view is
//                   byte-identical (WIP panel bbox + scrollHeight, document
//                   scroll size — the EXP-016 closed-vs-open discipline)
//
// Fixture (e2e/fixtures/repo): WIP row UC-D1-2 — same deterministic stand-up
// as e2e/reslice-preview.spec.js.
import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const ROW = (id) => `[data-testid="wip-row"][data-item-id="${id}"]`;
const BTN = (id) => `${ROW(id)} [data-testid="steer-btn"]`;
const PANEL = '[data-testid="reslice-preview-panel"]';
const OUTPUT = '[data-testid="prompt-output"]';
const ITEM_ID = 'UC-D1-2';
const ITEM_JOB = 'Demo use case two';

const PART_A = 'Part A delivers the read path';
const PART_B = 'Part B delivers the write path';
const INTENT = 'too big to flow as one item';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('inflight-engineer')).toBeVisible(); // data fully rendered
  await page.getByTestId('view-tab-wip').click();
  await expect(page.getByTestId('wip-panel')).toBeVisible();
});

/** Open the re-slice preview, fill the three fields, generate the prompt. */
async function openFillGenerate(page) {
  await page.locator(BTN(ITEM_ID)).click();
  await page.getByRole('menuitem', { name: 'Request re-slice / split' }).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByTestId('reslice-before-id')).toHaveText(new RegExp(`^${ITEM_ID} — `));
  await page.getByTestId('part-a-job').fill(PART_A);
  await page.getByTestId('part-b-job').fill(PART_B);
  await page.getByTestId('reslice-intent').fill(INTENT);
  await page.getByTestId('reslice-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();
}

test('AC-1/AC-2/AC-4 — Generate renders the enriched /slice-next prompt with all five fields; zero non-GET traffic', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => { if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`); });
  await openFillGenerate(page);

  const out = await page.locator(OUTPUT).textContent();
  expect(out).toMatch(/^\/slice-next\b/);
  expect(out).toContain(`${ITEM_ID} — ${ITEM_JOB}`); // before: id WITH job sentence
  expect(out).toContain('Proposed split:');
  expect(out).toContain(`Part A: ${PART_A}`);
  expect(out).toContain(`Part B: ${PART_B}`);
  expect(out).toContain(INTENT); // operator intent verbatim
  expect(out).toMatch(/before writing/i); // instructs Claude to preview first
  expect(out).not.toMatch(/\{\{[^}]*\}\}/); // no token residue
  expect(writes).toEqual([]); // client-side generation — clipboard is the only write surface
});

test('PromptOutput presentation inherited — mono, 40vh cap, selectable, focusable', async ({ page }) => {
  await openFillGenerate(page);
  const styles = await page.locator(OUTPUT).evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontFamily: s.fontFamily,
      maxHeight: s.maxHeight,
      userSelect: s.userSelect,
      whiteSpace: s.whiteSpace,
      tabindex: el.getAttribute('tabindex'),
      viewportH: window.innerHeight,
    };
  });
  expect(styles.fontFamily).toMatch(/mono/i);
  // 40vh cap (computed px against the 900px viewport)
  expect(parseFloat(styles.maxHeight)).toBeCloseTo(styles.viewportH * 0.4, 0);
  expect(styles.userSelect).toBe('text');
  expect(styles.whiteSpace).toBe('pre-wrap');
  expect(styles.tabindex).toBe('0'); // keyboard-reachable for review
});

test('PROMPT-COPY-1 inherited — copy puts the EXACT displayed bytes on the clipboard; polite toast confirms', async ({ page }) => {
  await openFillGenerate(page);
  await page.getByTestId('copy-prompt-btn').click();

  const toast = page.getByTestId('copy-toast');
  await expect(toast).toBeVisible({ timeout: 2000 });
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast).toHaveAttribute('aria-live', 'polite');
  await expect(toast).toContainText(/copied to clipboard/i);

  const shown = await page.locator(OUTPUT).textContent();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(shown); // byte-equal — the operator copies what they reviewed
  expect(copied).toContain(`Part A: ${PART_A}`);
});

test('GEO no-reflow on prompt render — the panel may grow downward internally; the page/underlying view is byte-identical', async ({ page }) => {
  // open + fill WITHOUT generating: this is the closed-state snapshot
  await page.locator(BTN(ITEM_ID)).click();
  await page.getByRole('menuitem', { name: 'Request re-slice / split' }).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByTestId('reslice-before-id')).toHaveText(new RegExp(`^${ITEM_ID} — `));
  await page.getByTestId('part-a-job').fill(PART_A);
  await page.getByTestId('part-b-job').fill(PART_B);
  await page.getByTestId('reslice-intent').fill(INTENT);

  const snap = () => page.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return [b.x, b.y, b.width, b.height, el.scrollHeight];
    };
    return {
      wip: r(document.querySelector('[data-testid="wip-panel"]')),
      rows: [...document.querySelectorAll('[data-testid="wip-row"]')].map(r),
      doc: [
        document.documentElement.scrollWidth,
        document.documentElement.scrollHeight,
        window.scrollX,
        window.scrollY,
      ],
    };
  });
  const before = await snap();

  await page.getByTestId('reslice-generate').click();
  await expect(page.locator(OUTPUT)).toBeVisible();

  const after = await snap();
  // underlying view byte-identical: WIP panel + every row + document scroll size
  expect(after).toEqual(before);
  // and the prompt rendered INSIDE the panel (internal growth is allowed)
  const panelBox = await page.locator(PANEL).boundingBox();
  const outBox = await page.locator(OUTPUT).boundingBox();
  expect(outBox.y).toBeGreaterThanOrEqual(panelBox.y);
  expect(outBox.y + outBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
});
