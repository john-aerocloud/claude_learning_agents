// @covers WizardStepIndicator
// @covers IntakeWizard
// UC-S018-1 — de-emphasis survival after A11Y-S018-1-12 rework.
//
// The rework removed `opacity: 0.85` from `.wizard-step--planned` and the
// opacity fade from the drawer slide-in keyframe. This spec asserts that the
// INTENT of de-emphasising planned steps is still visually present through the
// three remaining de-emphasis signals:
//   1. Colour:   planned steps use --c-text-dim (a dimmer token than the
//                current step's --c-text); assert computed colour DIFFERS
//                between a planned and the current (step-1) label.
//   2. Size:     planned step labels are smaller than the current step's font
//                (var(--fs-tree-badge) vs the current step inheriting base size
//                — assert font-size <= current step font-size).
//   3. "(soon)": each planned step contains a visible "(soon)" text node
//                inside .wizard-step__soon.
//   4. No alpha: cumulative opacity on every planned label is exactly 1
//                (asserted alongside contrast in the broader a11y spec — here
//                it is the regression pin for this specific concern).
//
// This spec is point-in-time (tied to the s018 design token contract) and
// should be reviewed if the WizardStepIndicator design changes.
//
// Slice: s018-guided-cod-intake / UC-S018-1
// SHA under test: ed7848c

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('view-switch')).toBeVisible();
  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();
});

test('@s018 de-emphasis (A11Y-S018-3-8): the lone planned step (4 — steps 2/3 are LIVE since UC-S018-2/3) has distinct dim colour, ≤ font-size, "(soon)" text, and NO alpha vs current step (1)', async ({
  page,
}) => {
  // Measure the current step (step 1) label properties
  const currentStep = page.getByTestId('wizard-step-1');
  await expect(currentStep).toHaveAttribute('data-step-state', 'current');

  const currentProps = await currentStep.locator('.wizard-step__label').evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return {
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      opacity: cs.opacity,
    };
  });

  // Measure all planned steps and assert de-emphasis signals
  // (step 2 is the live CodStep since UC-S018-2, step 3 the live QueueRankStep
  // since UC-S018-3 — only step 4 remains planned; step 3 has LOST its "(soon)")
  await expect(
    page.getByTestId('wizard-step-3'),
    'step 3 is now BUILT (UC-S018-3) — no longer planned',
  ).toHaveAttribute('data-step-state', 'upcoming');
  await expect(page.getByTestId('wizard-step-3').locator('.wizard-step__soon')).toHaveCount(0);
  for (const stepN of [4]) {
    const plannedStep = page.getByTestId(`wizard-step-${stepN}`);
    await expect(
      plannedStep,
      `step ${stepN} must carry data-step-state="planned"`,
    ).toHaveAttribute('data-step-state', 'planned');

    const plannedProps = await plannedStep.locator('.wizard-step__label').evaluate((el) => {
      const cs = window.getComputedStyle(el);
      // cumulative opacity walk
      let o = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        o *= parseFloat(getComputedStyle(n).opacity);
      }
      return {
        color: cs.color,
        fontSize: parseFloat(cs.fontSize),
        cumulativeOpacity: o,
      };
    });

    // 1. Colour: planned dim != current full-text (signals de-emphasis via token)
    expect(
      plannedProps.color,
      `step ${stepN} planned label colour "${plannedProps.color}" must differ from ` +
        `current step colour "${currentProps.color}" (de-emphasis via token, not alpha)`,
    ).not.toBe(currentProps.color);

    // 2. Font-size: planned ≤ current (badge-scale de-emphasis)
    expect(
      plannedProps.fontSize,
      `step ${stepN} planned font-size ${plannedProps.fontSize}px must be ≤ current step ` +
        `${currentProps.fontSize}px`,
    ).toBeLessThanOrEqual(currentProps.fontSize);

    // 3. "(soon)" text visible
    const soonText = await plannedStep.locator('.wizard-step__soon').textContent();
    expect(
      soonText,
      `step ${stepN} must have a visible "(soon)" text node in .wizard-step__soon`,
    ).toMatch(/soon/i);

    // 4. Cumulative opacity = 1 (no alpha de-emphasis anywhere in the tree)
    expect(
      plannedProps.cumulativeOpacity,
      `step ${stepN} planned label cumulative opacity must be 1 ` +
        `(de-emphasis is colour/text only — no alpha)`,
    ).toBe(1);
  }
});
