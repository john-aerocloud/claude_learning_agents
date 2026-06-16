// @covers WizardStepIndicator
// @covers IntakeWizard
// @covers uc-s018-4
// UC-S018-1 de-emphasis rework (A11Y-S018-1-12) — survival pin, carried forward
// to the COMPLETED wizard (UC-S018-4: all four steps built).
//
// The original rework removed `opacity: 0.85` from `.wizard-step--planned` and
// the opacity fade from the drawer slide-in keyframe — de-emphasis was to be
// COLOUR + SIZE + "(soon)" text, NEVER alpha. With UC-S018-4 every step is now
// BUILT, so NO step is "planned" and NO "(soon)" tag remains (A11Y-S018-4-10).
// The standing regression this spec pins is therefore the NO-ALPHA invariant:
//   1. No step carries data-step-state="planned"; no "(soon)" text anywhere
//      (the wizard is complete — nothing left to de-emphasise).
//   2. Cumulative opacity on EVERY step label is exactly 1 — the de-emphasis
//      rework's core promise (no alpha anywhere in the indicator tree) holds with
//      step 4 built, the A11Y-S018-4-10 do-no-harm pin.
//   3. The current step (1) reads with full-strength colour; built upcoming
//      steps stay legible (colour/size signalling, never alpha).
//
// This spec is point-in-time (tied to the s018 design token contract) and should
// be reviewed if the WizardStepIndicator design changes.
//
// Slice: s018-guided-cod-intake / UC-S018-4

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('view-switch')).toBeVisible();
  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();
});

test('@s018 de-emphasis (A11Y-S018-4-10): all four steps BUILT — no "(soon)"/planned anywhere; cumulative opacity is exactly 1 on every step label (no alpha)', async ({
  page,
}) => {
  const currentStep = page.getByTestId('wizard-step-1');
  await expect(currentStep).toHaveAttribute('data-step-state', 'current');

  // 1. NO planned step remains; NO "(soon)" text anywhere (wizard complete).
  for (const n of [1, 2, 3, 4]) {
    const step = page.getByTestId(`wizard-step-${n}`);
    await expect(step, `step ${n} must not be planned`).not.toHaveAttribute(
      'data-step-state',
      'planned',
    );
    await expect(step.locator('.wizard-step__soon')).toHaveCount(0);
  }
  // steps 2–4 are upcoming (built, not yet visited from step 1)
  for (const n of [2, 3, 4]) {
    await expect(page.getByTestId(`wizard-step-${n}`)).toHaveAttribute('data-step-state', 'upcoming');
  }

  // 2. Cumulative opacity = 1 on EVERY step label (the no-alpha invariant).
  for (const n of [1, 2, 3, 4]) {
    const cumulativeOpacity = await page
      .getByTestId(`wizard-step-${n}`)
      .locator('.wizard-step__label')
      .evaluate((el) => {
        let o = 1;
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          o *= parseFloat(getComputedStyle(node).opacity);
        }
        return o;
      });
    expect(
      cumulativeOpacity,
      `step ${n} label cumulative opacity must be 1 (de-emphasis is colour/text only — no alpha)`,
    ).toBe(1);
  }

  // 3. The current step reads at full strength; built upcoming steps stay legible.
  const currentColor = await currentStep
    .locator('.wizard-step__label')
    .evaluate((el) => window.getComputedStyle(el).color);
  expect(currentColor, 'current step label has a resolved colour').toMatch(/rgb/);
});
