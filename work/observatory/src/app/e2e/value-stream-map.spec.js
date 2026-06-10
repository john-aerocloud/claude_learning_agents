// @covers ValueStreamMap
// @covers VsmContainer
// @covers StageNode
// @covers InFlightBadge
// @covers GateMarker
// @covers ReworkLoopConnector
// UC-S004-2/3/4 browser spec — a REAL browser (Playwright/chromium) driving the
// FULL DEFECT-001 fix path: SPA on :5173 → SPA client → read layer on :3001
// against the committed fixture ledger (e2e/fixtures/repo/process/dora/
// ledger.csv, project=demo). This proves what jsdom cannot: real layout geometry
// (a banded flow, not a stacked column), the wip>0 in-flight badge actually
// rendering on the right node, and — the DEFECT-001 symptom-gone proof — that the
// primary mounted view shows REAL NON-ZERO numbers, not 0,0,0,0.
//
// Fixture (project=demo) expected: engineer throughput 3, wip 1 (UC-D3 in-flight),
// intake throughput 2, deploy throughput 1, validate throughput 1.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // wait for the live load to populate from the :3001 fixture ledger
  await expect(page.getByTestId('stage-engineer')).toBeVisible();
});

test('DEFECT-001 — the primary view shows REAL non-zero throughput, not 0 (engineer=3)', async ({
  page,
}) => {
  const eng = page.getByTestId('stage-engineer');
  await expect(eng.getByTestId('metric-engineer-throughput')).toContainText('3');
  // not the zero-everywhere symptom: intake + deploy also non-zero
  await expect(page.getByTestId('stage-intake').getByTestId('metric-intake-throughput')).toContainText('2');
  await expect(page.getByTestId('stage-deploy').getByTestId('metric-deploy-throughput')).toContainText('1');
});

test('UC-S004-4 — a wip>0 node shows its in-flight badge with VISIBLE "in-flight" text (not colour-only)', async ({
  page,
}) => {
  const eng = page.getByTestId('stage-engineer');
  await expect(eng).toHaveAttribute('data-wip-active', 'true');
  const badge = eng.getByTestId('inflight-engineer');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/1 in-flight/i);
  // the glyph is decorative; meaning rides on text + the accessible name
  const glyphHidden = await badge.locator('[aria-hidden="true"]').first().getAttribute('aria-hidden');
  expect(glyphHidden).toBe('true');
});

test('AC2.2 — all 10 canonical stage nodes render in flow order (rework is a loop, not a node)', async ({
  page,
}) => {
  const order = ['intake', 'decompose', 'ready', 'capabilities', 'ui-design', 'engineer', 'ui-validate', 'deploy', 'validate', 'done'];
  for (const s of order) {
    await expect(page.getByTestId(`stage-${s}`)).toBeVisible();
  }
  await expect(page.getByTestId('stage-rework')).toHaveCount(0);
});

test('GEO-1 — within the build lane the nodes flow left→right (x increasing, share a y band)', async ({
  page,
}) => {
  const cap = await page.getByTestId('stage-capabilities').boundingBox();
  const uid = await page.getByTestId('stage-ui-design').boundingBox();
  const eng = await page.getByTestId('stage-engineer').boundingBox();
  expect(cap && uid && eng).toBeTruthy();
  expect(cap.x).toBeLessThan(uid.x);
  expect(uid.x).toBeLessThan(eng.x);
  const overlaps = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(cap, uid)).toBe(true);
  expect(overlaps(uid, eng)).toBe(true);
});

test('GEO-3 — lane bands stack top→bottom queue < build < release (flow order)', async ({ page }) => {
  const q = await page.getByTestId('vsm-lane-queue').boundingBox();
  const b = await page.getByTestId('vsm-lane-build').boundingBox();
  const r = await page.getByTestId('vsm-lane-release').boundingBox();
  expect(q && b && r).toBeTruthy();
  expect(q.y).toBeLessThan(b.y);
  expect(b.y).toBeLessThan(r.y);
});

test('GEO-2 — each stage node is at least ~200px wide (name + 2×2 figures fit)', async ({ page }) => {
  for (const s of ['engineer', 'intake', 'done']) {
    const bb = await page.getByTestId(`stage-${s}`).boundingBox();
    expect(bb.width).toBeGreaterThanOrEqual(190);
  }
});

test('GEO-6 — the in-flight badge silhouette exceeds a normal metric area (shape cue is real)', async ({
  page,
}) => {
  const badge = await page.getByTestId('inflight-engineer').boundingBox();
  const metric = await page.getByTestId('metric-engineer-throughput').boundingBox();
  expect(badge && metric).toBeTruthy();
  expect(badge.width * badge.height).toBeGreaterThan(metric.width * metric.height);
});

test('AC2.4 / A11Y-6 — the rework loop has a visible "Rework" text node outside the aria-hidden SVG', async ({
  page,
}) => {
  const loop = page.getByTestId('rework-loop');
  await expect(loop).toBeVisible();
  await expect(loop.getByText(/rework/i)).toBeVisible();
  await expect(loop.locator('svg')).toHaveAttribute('aria-hidden', 'true');
});

test('@a11y A11Y-1 — map root is a region named "Value-stream map" with an h2', async ({ page }) => {
  await expect(page.getByRole('region', { name: /value-stream map/i })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /value-stream map/i })).toBeVisible();
});

test('@a11y A11Y-2/4 — the engineer node accessible name carries its figures incl. "in-flight"', async ({
  page,
}) => {
  await expect(
    page.getByRole('group', { name: /Build \/ TDD.*throughput 3.*WIP.*1 in-flight.*rework/i }),
  ).toBeVisible();
});

test('@a11y A11Y-3 — Tab reaches the stage nodes in canonical flow order', async ({ page }) => {
  const order = ['intake', 'decompose', 'ready', 'capabilities', 'ui-design', 'engineer'];
  for (const s of order) {
    await page.keyboard.press('Tab');
    const testid = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(testid).toBe(`stage-${s}`);
  }
});

test('no console errors on initial load (the value-stream map mounts clean)', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/');
  await expect(page.getByTestId('stage-engineer')).toBeVisible();
  expect(errors).toEqual([]);
});
