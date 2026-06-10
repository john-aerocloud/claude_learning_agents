// @covers ValueStreamMap
// @covers InFlightBadge
// A11Y-7/11 contrast scan (axe) in a REAL browser, REPOINTED for DEFECT-001/s004:
// the value-stream map is now the PRIMARY mounted surface (it replaced the
// PipelineMap). The scan now covers the rendered value-stream map — its node
// figure/label text (≥ 4.5:1) and the NEW s004 in-flight tokens (--c-wip /
// --c-wip-bd, border ≥ 3:1 vs surface, WCAG 1.4.11). The fixture ledger renders
// a wip>0 engineer node, so the in-flight badge (and its --c-wip accent) is on
// screen and in scope of the scan.
//
// Tagged @a11y so `make a11y-observatory` (test:a11y → --grep @a11y) runs it.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // ensure the new in-flight badge (--c-wip tokens) is rendered before the scan
  await expect(page.getByTestId('stage-engineer').getByTestId('inflight-engineer')).toBeVisible();
});

test('@a11y A11Y-7/11 — axe reports zero colour-contrast violations on the rendered value-stream map (incl. new --c-wip tokens)', async ({
  page,
}) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const contrast = results.violations.filter(
    (v) => v.id === 'color-contrast' || v.id === 'color-contrast-enhanced',
  );
  expect(
    contrast,
    `axe contrast violations:\n${JSON.stringify(contrast, null, 2)}`,
  ).toEqual([]);
});
