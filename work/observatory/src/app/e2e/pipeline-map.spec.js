// @covers PipelineMap
// UC-S002-3 browser specs — a REAL browser (Playwright/chromium) driving the
// FULL path: SPA on :5173 → SPA client → read layer on :3001 (fixture repo).
// This is the surface the operator SEES; the live drive proves what jsdom
// cannot — real layout geometry (flow vs stacked list), real keyboard tab
// order, real focus-visible ring. CSP/runtime-config ordering also only
// surfaces in a real browser, hence no node fetch probe here.
//
// Fixture (e2e/fixtures/repo): intake 3 / ready 1 (starving, min_items 3) /
// deploy 0 / rework 2.
//
// SCOPE: GEO-1, GEO-2 + core A11Y (region, group names w/ count, tab order,
// focus visible). The badge-specific GEO-3 / A11Y-5/6/7 and axe contrast
// (A11Y-8) belong to UC4/UC5 once the badges exist.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // wait for the live load to populate the boxes from the :3001 fixture
  await expect(page.getByTestId('queue-intake')).toBeVisible();
});

test('AC3.2 — all four queue boxes render with numeric live counts', async ({ page }) => {
  const expected = { intake: '3', ready: '1', deploy: '0', rework: '2' };
  for (const [name, count] of Object.entries(expected)) {
    const box = page.getByTestId(`queue-${name}`);
    await expect(box).toBeVisible();
    await expect(box.getByTestId('queue-count')).toHaveText(count);
  }
});

test('GEO-1 — four boxes lay out left→right as a flow (x strictly increasing, forward row shares a y band)', async ({
  page,
}) => {
  const intake = await page.getByTestId('queue-intake').boundingBox();
  const ready = await page.getByTestId('queue-ready').boundingBox();
  const deploy = await page.getByTestId('queue-deploy').boundingBox();
  expect(intake && ready && deploy).toBeTruthy();
  // x strictly increasing intake → ready → deploy (a flow, not a stack)
  expect(intake.x).toBeLessThan(ready.x);
  expect(ready.x).toBeLessThan(deploy.x);
  // y ranges overlap → same forward row (not a vertical list)
  const overlaps = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(intake, ready)).toBe(true);
  expect(overlaps(ready, deploy)).toBe(true);
});

test('GEO-2 — Rework is the return loop BELOW the forward row, not a 5th inline box', async ({
  page,
}) => {
  const deploy = await page.getByTestId('queue-deploy').boundingBox();
  const rework = await page.getByTestId('queue-rework').boundingBox();
  expect(deploy && rework).toBeTruthy();
  // rework top is below the forward row's bottom (return-loop topology)
  expect(rework.y).toBeGreaterThanOrEqual(deploy.y + deploy.height);
});

test('@a11y A11Y-1 — map root is a region named "Pipeline map"', async ({ page }) => {
  await expect(page.getByRole('region', { name: /pipeline map/i })).toBeVisible();
});

test('@a11y A11Y-2 — each box is a group whose accessible name carries the count (and state when not ok)', async ({
  page,
}) => {
  await expect(page.getByRole('group', { name: /intake queue, 3 items/i })).toBeVisible();
  await expect(page.getByRole('group', { name: /ready queue, 1 item.*starving/i })).toBeVisible();
  await expect(page.getByRole('group', { name: /deploy queue, 0 items/i })).toBeVisible();
  await expect(page.getByRole('group', { name: /rework queue, 2 items/i })).toBeVisible();
});

test('@a11y A11Y-3 — Tab reaches all four boxes in flow order intake→ready→deploy→rework', async ({
  page,
}) => {
  const order = ['intake', 'ready', 'deploy', 'rework'];
  for (const name of order) {
    await page.keyboard.press('Tab');
    const testid = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(testid).toBe(`queue-${name}`);
  }
});

test('@a11y A11Y-3/4 — a focused box shows a visible focus ring (outline or box-shadow)', async ({
  page,
}) => {
  const box = page.getByTestId('queue-ready');
  await box.focus();
  const ring = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
  });
  const hasOutline = ring.outline !== 'none' && parseFloat(ring.outlineWidth) >= 2;
  const hasShadow = ring.boxShadow && ring.boxShadow !== 'none';
  expect(hasOutline || hasShadow).toBe(true);
});

test('@a11y A11Y-9 — each focusable QueueBox is at least 24×24px (WCAG 2.2 §2.5.8)', async ({
  page,
}) => {
  for (const name of ['intake', 'ready', 'deploy', 'rework']) {
    const bb = await page.getByTestId(`queue-${name}`).boundingBox();
    expect(bb.width).toBeGreaterThanOrEqual(24);
    expect(bb.height).toBeGreaterThanOrEqual(24);
  }
});

test('no console errors on initial load (UC1 AC1.2 still holds with the map mounted)', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('queue-intake')).toBeVisible();
  expect(errors).toEqual([]);
});
