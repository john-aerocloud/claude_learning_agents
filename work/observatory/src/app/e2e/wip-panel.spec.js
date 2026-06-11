// @covers SPA_VIEWSWITCH
// @covers SPA_WIPPANEL
// @covers SPA_WIPHOOK
// @covers uc-s015-1
// UC-S015-1 browser spec — a REAL browser driving the FULL path: view-switch
// tablist → WipPanel fed by /stage-flow open_items + LIVE wip_horizon_ms +
// /items. Proves what jsdom cannot: real geometry (GEO-S015-1..4 — the
// lossless view switch, the stacked list, the untouched rail, the aligned
// figure line), real keyboard focus through the tablist, axe on the rendered
// WIP view, and reduced-motion behaviour.
//
// Fixture (e2e/fixtures/repo + OBSERVATORY_NOW=2026-06-09T01:15:00Z):
//   - CHK-4   engineer task_start 01:00, no end → dwell 15 min (fresh)
//   - UC-D1-2 tester  task_start 06-08T20:00 (FIX-16), no end → dwell 5 h 15 min
//     → OLDER than the 2 h horizon: dropped from the VSM WIP headline (recency)
//     but MUST appear here flagged stale (S15-1-WIP-2 — the DEFECT-011 guard).
// Sorted longest-in-stage first → UC-D1-2 leads, CHK-4 second.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // the engineer in-flight badge proves stage-flow data is fully rendered
  await expect(page.getByTestId('inflight-engineer')).toBeVisible();
});

async function openWip(page) {
  await page.getByTestId('view-tab-wip').click();
  await expect(page.getByTestId('wip-panel')).toBeVisible();
  await expect(page.getByTestId('wip-row').first()).toBeVisible();
}

test('F-1/F-2 — the nav entry shows the panel listing every open item incl. the stale one; 1 click each way', async ({
  page,
}) => {
  await openWip(page);
  const rows = page.getByTestId('wip-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-item-id', 'UC-D1-2');
  await expect(rows.nth(1)).toHaveAttribute('data-item-id', 'CHK-4');
  // back to the pipeline in 1 click
  await page.getByTestId('view-tab-pipeline').click();
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
});

test('S15-1-WIP-2 — the >2h stale-open item is PRESENT, flagged with text+glyph+data-stale (never colour alone), and LEADS the list', async ({
  page,
}) => {
  // the VSM WIP headline (recency-only) does NOT count UC-D1-2…
  await expect(page.getByTestId('stage-validate')).toHaveAttribute('data-wip', '0');
  // …but the WIP navigation panel shows it, stale-flagged, at the top (F-4).
  await openWip(page);
  const stale = page.getByTestId('wip-row').first();
  await expect(stale).toHaveAttribute('data-item-id', 'UC-D1-2');
  await expect(stale).toHaveAttribute('data-stale', 'true');
  const badge = stale.getByTestId('stale-badge');
  await expect(badge).toContainText('stale — over 2h'); // live-horizon text, not a client literal
  await expect(badge.locator('[aria-hidden="true"]')).toHaveText('⏳'); // shape cue
  const fresh = page.getByTestId('wip-row').nth(1);
  await expect(fresh).toHaveAttribute('data-stale', 'false');
  await expect(fresh.getByTestId('stale-badge')).toHaveCount(0);
});

test('F-3/F-4 + S15-1-FIG-1/2 — rows show job sentence, human stage label, value, cost, unit-bearing dwell; longest first', async ({
  page,
}) => {
  await openWip(page);
  const first = page.getByTestId('wip-row').nth(0);
  await expect(first.getByTestId('wip-job')).toHaveText('Demo use case two'); // items.csv job sentence
  await expect(first.getByTestId('wip-stage')).toHaveText('Validate (tester)'); // label, not enum key
  await expect(first.getByTestId('wip-value')).toHaveText('MED');
  await expect(first.getByTestId('wip-cost')).toHaveText('2');
  await expect(first.getByTestId('wip-dwell')).toHaveText('5 h 15 min'); // 20:00 → 01:15 pinned now
  const second = page.getByTestId('wip-row').nth(1);
  await expect(second.getByTestId('wip-job')).toHaveText('Fourth demo chunk - tree and zoom');
  await expect(second.getByTestId('wip-dwell')).toHaveText('15 min');
  // unit-bearing pattern, never a bare integer (S15-1-FIG-1)
  for (const dwell of await page.getByTestId('wip-dwell').allTextContents()) {
    expect(dwell).toMatch(/\d+\s*(h|min|s)/);
    expect(dwell).not.toMatch(/^\d+$/);
  }
});

test('GEO-S015-1 — the view switch is LOSSLESS: VSM bbox + page scrollHeight byte-identical after switch away and back; VSM absent while WIP active', async ({
  page,
}) => {
  const before = {
    bbox: await page.getByTestId('value-stream-map').boundingBox(),
    scrollHeight: await page.evaluate(() => document.documentElement.scrollHeight),
  };
  await openWip(page);
  // genuinely unmounted — not hidden-but-present reflowing (EXP-016)
  await expect(page.getByTestId('value-stream-map')).toHaveCount(0);
  await page.getByTestId('view-tab-pipeline').click();
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('inflight-engineer')).toBeVisible(); // data fully re-rendered
  const after = {
    bbox: await page.getByTestId('value-stream-map').boundingBox(),
    scrollHeight: await page.evaluate(() => document.documentElement.scrollHeight),
  };
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
});

test('GEO-S015-2 — the WIP list STACKS (monotonically increasing tops, shared left), not a line', async ({
  page,
}) => {
  await openWip(page);
  const rows = page.getByTestId('wip-row');
  await expect(rows).toHaveCount(2);
  const a = await rows.nth(0).boundingBox();
  const b = await rows.nth(1).boundingBox();
  expect(a && b).toBeTruthy();
  expect(b.y).toBeGreaterThan(a.y); // strictly below
  expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1); // shared left offset
});

test('GEO-S015-3 — the tree rail bbox is IDENTICAL with the Pipeline vs WIP view active (rail orthogonal to the switch)', async ({
  page,
}) => {
  const railBefore = await page.getByTestId('work-item-tree').boundingBox();
  await openWip(page);
  const railDuring = await page.getByTestId('work-item-tree').boundingBox();
  expect(JSON.stringify(railDuring)).toBe(JSON.stringify(railBefore));
});

test('GEO-S015-4 — within one row the figure <dd>s share a top offset (one scannable line, not a ragged stack)', async ({
  page,
}) => {
  await openWip(page);
  const dds = page.getByTestId('wip-row').first().locator('dd');
  const count = await dds.count();
  expect(count).toBeGreaterThanOrEqual(6);
  const tops = [];
  for (let i = 0; i < count; i++) {
    const box = await dds.nth(i).boundingBox();
    expect(box).toBeTruthy();
    tops.push(box.y);
  }
  const min = Math.min(...tops);
  const max = Math.max(...tops);
  expect(max - min).toBeLessThanOrEqual(2); // small tolerance
});

test('@a11y S15-1-A11Y-1/2 — keyboard-only: Arrow moves between tabs, Enter activates, focus lands on the panel heading', async ({
  page,
}) => {
  const pipelineTab = page.getByTestId('view-tab-pipeline');
  const wipTab = page.getByTestId('view-tab-wip');
  // roving tabindex: exactly the ACTIVE tab is the tab stop
  await expect(pipelineTab).toHaveAttribute('tabindex', '0');
  await expect(wipTab).toHaveAttribute('tabindex', '-1');
  await pipelineTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(wipTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('wip-panel')).toBeVisible();
  await expect(wipTab).toHaveAttribute('aria-selected', 'true');
  await expect(pipelineTab).toHaveAttribute('aria-selected', 'false');
  // S15-1-A11Y-2: focus moved into the panel — on its visible <h2>
  await expect(
    page.getByTestId('wip-panel').getByRole('heading', { level: 2, name: 'In-flight WIP' }),
  ).toBeFocused();
});

test('@a11y S15-1-A11Y-3/4 — visible focus ring on tabs; tab hit boxes ≥ 24×24 CSS px', async ({
  page,
}) => {
  const wipTab = page.getByTestId('view-tab-wip');
  const box = await wipTab.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
  const pBox = await page.getByTestId('view-tab-pipeline').boundingBox();
  expect(pBox.width).toBeGreaterThanOrEqual(24);
  expect(pBox.height).toBeGreaterThanOrEqual(24);
  // keyboard focus produces a non-empty visible ring (box-shadow), not nothing
  await page.getByTestId('view-tab-pipeline').focus();
  await page.keyboard.press('ArrowRight');
  const shadow = await wipTab.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe('none');
});

test('@a11y S15-1-A11Y-5/6/7 — axe zero violations on the WIP view; one h2; polite live-region count', async ({
  page,
}) => {
  await openWip(page);
  // exactly one <h2> "In-flight WIP"; no skipped levels under the page <h1>
  await expect(page.locator('h2', { hasText: 'In-flight WIP' })).toHaveCount(1);
  // the count is in a polite live region (LiveStatusDot pattern reused)
  const count = page.getByTestId('wip-count');
  await expect(count).toHaveAttribute('aria-live', 'polite');
  await expect(count).toHaveText('2 items in flight');
  // axe over the rendered WIP view (tablist + panel)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .include('[data-testid="view-switch"]')
    .include('[data-testid="wip-panel"]')
    .analyze();
  expect(
    results.violations,
    `axe violations:\n${JSON.stringify(results.violations, null, 2)}`,
  ).toEqual([]);
});

test('@a11y reduced-motion — the switch works identically under prefers-reduced-motion', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await page.getByTestId('view-tab-wip').click();
  await expect(page.getByTestId('wip-panel')).toBeVisible();
  await expect(page.getByTestId('wip-row')).toHaveCount(2);
  await page.getByTestId('view-tab-pipeline').click();
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await context.close();
});

test('F-5 surrogate — no console errors while switching views (live fixture data)', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await openWip(page);
  await page.getByTestId('view-tab-pipeline').click();
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await page.getByTestId('view-tab-wip').click();
  await expect(page.getByTestId('wip-panel')).toBeVisible();
  expect(errors).toEqual([]);
});
