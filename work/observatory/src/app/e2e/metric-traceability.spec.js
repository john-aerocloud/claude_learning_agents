// @covers StageNode
// @covers MetricSource
// UC-S004-5 — metric TRACEABILITY browser spec. A REAL browser (Playwright/
// chromium) driving the full path: SPA on :3001 → SPA client → read layer →
// the committed fixture ledger (project=demo). Proves what jsdom cannot: the
// MetricSource reveal actually opens against REAL /stage-flow source_rows when
// an operator focuses (keyboard) or hovers a stage, lists a real ledger row ref,
// and is keyboard-dismissible (Esc). This is the SM3 traceability proof.
//
// Fixture (project=demo): engineer throughput 3 with real source_rows; a wip>0
// node. The reveal must show a real "row:" / timestamp ref, never a placeholder.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('stage-engineer')).toBeVisible();
});

test('AC5.1/5.2 — focusing a stage + Enter reveals its throughput source rows (keyboard-operable)', async ({
  page,
}) => {
  const panel = page.getByTestId('metric-source-engineer-throughput');
  // hidden until revealed
  await expect(panel).toBeHidden();

  const node = page.getByTestId('stage-engineer');
  await node.focus();
  await page.keyboard.press('Enter');

  await expect(panel).toBeVisible();
  // a visible text "source" affordance (not colour-only)
  await expect(panel).toContainText(/source/i);
  // a REAL ledger row ref (row index or timestamp), not a placeholder
  await expect(panel.locator('[data-source-row]').first()).toBeVisible();
  const firstRow = await panel.locator('[data-source-row]').first().getAttribute('data-source-row');
  expect(firstRow).toBeTruthy();
  expect(firstRow).not.toMatch(/placeholder|todo|n\/?a/i);
});

test('A11Y-10 — the reveal is keyboard-dismissible (Esc closes it)', async ({ page }) => {
  const node = page.getByTestId('stage-engineer');
  const panel = page.getByTestId('metric-source-engineer-throughput');
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('AC5.1 — hovering a stage also reveals its source (click-or-hover)', async ({ page }) => {
  const panel = page.getByTestId('metric-source-engineer-throughput');
  await expect(panel).toBeHidden();
  await page.getByTestId('stage-engineer').hover();
  await expect(panel).toBeVisible();
});

test('A11Y-10 — each metric value is described by its source panel (aria-describedby)', async ({
  page,
}) => {
  const value = page.getByTestId('metric-value-engineer-throughput');
  const panel = page.getByTestId('metric-source-engineer-throughput');
  const describedby = await value.getAttribute('aria-describedby');
  const panelId = await panel.getAttribute('id');
  expect(describedby).toBeTruthy();
  expect(describedby).toBe(panelId);
});
