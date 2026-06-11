// @covers def-012
// @covers StagingQueueBox
// @covers R_STAGING
// DEFECT-012 pinning spec — decomposed work was INVISIBLE between product's
// decompose completion and the flow-manager's triage sweep (4 UCs existed
// nowhere on the board for ~35min). The fix: queues/staging.csv is a visible
// buffer — served by GET /api/projects/:id/queues/staging and rendered as the
// "Staging (awaiting triage)" box BETWEEN Decompose and Ready in the queue lane.
//
// Fixture (e2e/fixtures/repo/work/demo/queues/staging.csv): 2 staged rows
// (UC-D9, UC-D10) ⇒ the API returns depth 2 + the rows, and the board shows
// the box with depth > 0 between the Decompose and Ready stage nodes.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('stage-decompose')).toBeVisible();
});

test('D12-E2E-1 — the staging API serves the fixture rows with an explicit depth', async ({
  request,
}) => {
  const res = await request.get('/api/projects/demo/queues/staging');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.queue).toBe('staging');
  expect(body.depth).toBe(2);
  expect(body.rows.map((r) => r.item_id)).toEqual(['UC-D9', 'UC-D10']);
  expect(body.rows[0].job).toBe('Operator sees decomposed work immediately');
});

test('D12-E2E-2 — the board shows the staging buffer with depth > 0 and id + job rows (the defect symptom gone)', async ({
  page,
}) => {
  const box = page.getByTestId('staging-buffer');
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('data-depth', '2');
  await expect(page.getByTestId('staging-depth')).toContainText(/2 awaiting triage/i);
  // human-meaningful rows: id + job, never ids alone
  await expect(page.getByTestId('staging-item-UC-D9')).toContainText('UC-D9');
  await expect(page.getByTestId('staging-item-UC-D9')).toContainText(
    /Operator sees decomposed work immediately/,
  );
  await expect(page.getByTestId('staging-item-UC-D10')).toContainText(/Triage drains/);
});

test('D12-GEO — the staging box sits BETWEEN Decompose and Ready in the queue lane (left→right, same band)', async ({
  page,
}) => {
  const dec = await page.getByTestId('stage-decompose').boundingBox();
  const box = await page.getByTestId('staging-buffer').boundingBox();
  const rdy = await page.getByTestId('stage-ready').boundingBox();
  expect(dec && box && rdy).toBeTruthy();
  // left→right flow: decompose < staging < ready on the x axis
  expect(dec.x + dec.width).toBeLessThanOrEqual(box.x + 1);
  expect(box.x + box.width).toBeLessThanOrEqual(rdy.x + 1);
  // shares the queue lane's y band with its neighbours
  const overlaps = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(dec, box)).toBe(true);
  expect(overlaps(box, rdy)).toBe(true);
  // and it lives INSIDE the queue lane box
  const lane = await page.getByTestId('vsm-lane-queue').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(lane.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(lane.y + lane.height + 1);
});

test('D12-A11Y — the buffer is announced as a named group and adds NO tab stop between decompose and ready', async ({
  page,
}) => {
  await expect(
    page.getByRole('group', { name: /staging buffer.*awaiting triage.*2/i }),
  ).toBeVisible();
  // A11Y-3 invariant preserved: Tab from decompose reaches ready with only
  // steer triggers allowed to intervene — the staging box is NOT focusable.
  await page.getByTestId('stage-decompose').focus();
  let testid = null;
  for (let hops = 0; hops < 5; hops += 1) {
    await page.keyboard.press('Tab');
    testid = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (testid !== 'steer-btn') break;
  }
  expect(testid).toBe('stage-ready');
});
