// @covers def-014
// @covers StageNode
// @covers MetricSource
// DEFECT-014 — REAL-BROWSER pins for the single composite MetricSource panel.
// The reproduction (live :5173, 2026-06-12): hovering Intake opened FOUR
// metric-source panels absolutely positioned into an overlapping stack
// (bboxes y=381/381/432/483) that obscured each other and the queue beneath.
// UI-designer ruling (b): node hover/focus+Enter opens ONE panel with the four
// metrics sectioned. These specs assert the geometry half of D14-AC-5 (at most
// one visible tooltip box — jsdom cannot measure layout) plus the open/close
// paths and the UC-S014-1 click-transparency against the real fixture board.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('stage-intake')).toBeVisible();
});

/** All VISIBLE role=tooltip elements inside one stage node. */
function visiblePanels(page, stage) {
  return page.locator(`[data-testid="stage-${stage}"] [role="tooltip"]:visible`);
}

test('D14-AC-1/5 — hover Intake ⇒ EXACTLY ONE visible source panel, single footprint (the repro)', async ({
  page,
}) => {
  await page.getByTestId('stage-intake').hover();
  const panels = visiblePanels(page, 'intake');
  // exactly one — never the four-panel stack
  await expect(panels).toHaveCount(1);
  // geometry: at most one visible panel box ⇒ no overlapping bboxes possible
  const boxes = await page
    .locator('[data-testid="stage-intake"] [role="tooltip"]')
    .evaluateAll((els) =>
      els
        .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
        .filter((el) => !el.hidden)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
    );
  expect(boxes.length).toBe(1);
  expect(boxes[0].w).toBeGreaterThan(0);
  expect(boxes[0].h).toBeGreaterThan(0);
});

test('D14-AC-1 — same exactly-one invariant on Ready; zero when closed', async ({ page }) => {
  await expect(visiblePanels(page, 'ready')).toHaveCount(0);
  await page.getByTestId('stage-ready').hover();
  await expect(visiblePanels(page, 'ready')).toHaveCount(1);
  // move away → closed again
  await page.getByTestId('value-stream-map').hover({ position: { x: 1, y: 1 } });
  await expect(visiblePanels(page, 'ready')).toHaveCount(0);
});

test('D14-AC-2 — the one panel is SECTIONED: every metric keeps its provenance', async ({
  page,
}) => {
  await page.getByTestId('stage-intake').hover();
  const panel = page.getByTestId('metric-source-intake');
  await expect(panel).toBeVisible();
  // intake is a queue stage → throughput / dwell / depth / rework sections
  for (const kind of ['throughput', 'dwell', 'depth', 'rework']) {
    const section = panel.getByTestId(`metric-source-intake-${kind}`);
    await expect(section).toBeVisible();
    await expect(section.getByTestId(`source-file-intake-${kind}`)).toContainText(
      'process/dora/ledger.csv',
    );
  }
});

test('D14-AC-3 — keyboard (focus + Enter) reaches the identical one-panel state', async ({
  page,
}) => {
  const node = page.getByTestId('stage-intake');
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(visiblePanels(page, 'intake')).toHaveCount(1);
  await expect(page.getByTestId('metric-source-intake')).toBeVisible();
});

test('D14-AC-4 — Esc closes the panel (keyboard-dismissible, count → 0)', async ({ page }) => {
  const node = page.getByTestId('stage-intake');
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(visiblePanels(page, 'intake')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(visiblePanels(page, 'intake')).toHaveCount(0);
});

test('D14-AC-6 — panel is pointer-transparent; steer buttons stay clickable while open', async ({
  page,
}) => {
  const node = page.getByTestId('stage-intake');
  await node.hover();
  const panel = page.getByTestId('metric-source-intake');
  await expect(panel).toBeVisible();
  // UC-S014-1 click-transparency survives on the composite panel
  await expect(panel).toHaveCSS('pointer-events', 'none');
  // the queue chip's steer trigger is still clickable with the panel open
  await page.locator('[data-testid="queued-item-intake-D-1"] [data-testid="steer-btn"]').click();
  await expect(page.locator('[data-testid="steer-menu"]')).toBeVisible();
});

test('D14-AC-6 — every metric value aria-describedby resolves INSIDE the one panel', async ({
  page,
}) => {
  const ok = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="stage-intake"]');
    const panel = node.querySelector('[data-testid="metric-source-intake"]');
    const metrics = Array.from(node.querySelectorAll('[data-metric]'));
    if (!panel || metrics.length === 0) return false;
    return metrics.every((m) => {
      const t = document.getElementById(m.getAttribute('aria-describedby') || '');
      return !!t && panel.contains(t);
    });
  });
  expect(ok).toBe(true);
});
