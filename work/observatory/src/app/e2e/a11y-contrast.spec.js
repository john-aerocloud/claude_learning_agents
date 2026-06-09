// @covers PipelineMap
// @covers BufferStateIndicator
// UC-S002-4 — A11Y-8 contrast scan (axe) in a REAL browser. UC-S002-4 introduces
// the new buffer-state colour tokens (--c-state-starving/-over + their *-bd
// border tokens) applied to the badge. A11Y-8 requires zero axe contrast
// violations on the rendered surface: queue name/count ≥ 4.5:1, meta ≥ 4.5:1,
// and the state/constraint border colours ≥ 3:1 vs surface (WCAG 1.4.11). The
// fixture renders the starving Ready badge, so the new state tokens are on
// screen and in scope of the scan.
//
// Tagged @a11y so `make a11y-observatory` (test:a11y → --grep @a11y) runs it.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('queue-intake')).toBeVisible();
  // ensure the new state-badge (starving Ready) is rendered before the scan
  await expect(page.getByTestId('queue-ready').getByTestId('state-badge')).toBeVisible();
  // UC-S002-5: the fixture baseline names "ready" the constraint, so the
  // constraint-badge (new --c-constraint / --c-constraint-bd tokens) is also on
  // screen and in scope of the contrast scan.
  await expect(page.getByTestId('queue-ready').getByTestId('constraint-badge')).toBeVisible();
});

test('@a11y A11Y-8 — axe reports zero colour-contrast violations on the rendered map (incl. new state-badge tokens)', async ({
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
