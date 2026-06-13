// @covers uc-s013-4
// @covers SPA_DEFECTSHOOK
// @covers SPA_DEFECTSPANEL
// @covers SPA_DEFECTDRILL
// UC-S013-4 — the SSE live-refresh drive for the Defects view (AC-S013-4-1/2/3):
// REAL file mutations — a defect md file added/removed, a record edited under
// an open drawer — through the REAL EventSource in a REAL browser, refresh the
// grouped list + polite count line WITHOUT a manual reload, while the open
// drill honours the freeze discipline (EXP-036): content never silently
// mutates; the defect-drill-cue announces the divergence; an explicit
// re-activation of the row refreshes it.
//
// LIVE-MUTATION ISOLATION (the UC-S014-4 LIVE_PORT idiom): this spec MUTATES
// watched fixture files, so it targets the DEDICATED live-mutation server
// (playwright.config webServer #2) watching the per-run throwaway fixture copy
// (e2e/fixtures/repo-live-tmp, recreated by global-setup.mjs). The shared
// read-only fixture is never written.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const E2E_PORT = Number(process.env.OBSERVATORY_E2E_PORT || 5173);
const LIVE_PORT = Number(process.env.OBSERVATORY_E2E_LIVE_PORT || E2E_PORT + 50);
test.use({ baseURL: `http://localhost:${LIVE_PORT}` });

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFECTS_DIR = resolve(HERE, 'fixtures', 'repo-live-tmp', 'work', 'demo', 'defects');
const TEMP_DEFECT = resolve(DEFECTS_DIR, 'DEFECT-011-temp-sse-probe.md');
const DEFECT_003 = resolve(DEFECTS_DIR, 'DEFECT-003-stuck-validation.md');

const TEMP_DEFECT_MD = `# DEFECT-011 — Temp SSE probe defect

**Status:** CONFIRMED · **Severity:** MED

## Four fields

- **Expected:** The defects list updates live when this file appears.
- **Actual:** Probe record — exists only during the UC-S013-4 e2e run.
- **Intent:** Pin AC-S013-4-1/2 against a real file mutation.
- **Importance:** Staleness is a trust issue (DEFECT-003 lesson).
`;

// the DEFECT-003 Actual sentence we flip under the open drawer (AC-S013-4-3)
const ACTUAL_V1 = 'The open validation is invisible until someone greps the ledger.';
const ACTUAL_V2 = 'The open validation is invisible until someone greps the ledger. (updated live)';

function flipDefect003(from, to) {
  const now = readFileSync(DEFECT_003, 'utf8');
  if (now.includes(from)) writeFileSync(DEFECT_003, now.replace(from, to));
}

async function openDefects(page) {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await page.getByTestId('view-tab-defects').click();
  await expect(page.getByTestId('defects-panel')).toBeVisible();
  await expect(page.getByTestId('defect-row').first()).toBeVisible();
}

test('AC-S013-4-1/2 — a defect md file added then removed updates the list + count line live, no reload', async ({ page }) => {
  await openDefects(page);
  // fixture baseline: DEFECT-001 (md, closed) + DEFECT-002 (ledger-only,
  // closed) + DEFECT-003 (md, open)
  await expect(page.getByTestId('defect-row')).toHaveCount(3);
  await expect(page.getByTestId('defects-count')).toHaveText('3 defects, 1 open');

  try {
    // ADD: a new CONFIRMED defect file lands → row count increments, the new
    // row joins the OPEN group, the polite count line follows — no reload
    writeFileSync(TEMP_DEFECT, TEMP_DEFECT_MD);
    await expect(page.getByTestId('defect-row')).toHaveCount(4, { timeout: 4000 });
    await expect(page.getByTestId('defects-count')).toHaveText('4 defects, 2 open');
    const probe = page.locator('[data-defect-id="DEFECT-011"]');
    await expect(probe).toHaveAttribute('data-open', 'true');
    await expect(probe.getByTestId('defect-mttr')).toHaveText('open');

    // REMOVE: the file unlinks → the list shrinks back, live
    rmSync(TEMP_DEFECT);
    await expect(page.getByTestId('defect-row')).toHaveCount(3, { timeout: 4000 });
    await expect(page.getByTestId('defects-count')).toHaveText('3 defects, 1 open');
  } finally {
    rmSync(TEMP_DEFECT, { force: true }); // throwaway copy, but keep the worker coherent
  }
});

test('AC-S013-4-3 — drawer open during SSE: stays open, content FROZEN, cue announces; explicit re-open refreshes', async ({ page }) => {
  await openDefects(page);
  // drill the open defect (md-backed → its record can be edited underneath)
  await page.locator('[data-defect-id="DEFECT-003"] [data-testid="defect-row-trigger"]').click();
  const drill = page.getByTestId('defect-drill');
  await expect(drill).toBeVisible();
  await expect(page.getByTestId('defect-drill-cue')).toHaveAttribute('data-state', 'live');
  await expect(drill.locator('[data-field="actual"]')).not.toContainText('(updated live)');

  try {
    // MUTATE the displayed record's md file underneath the open drawer
    flipDefect003(ACTUAL_V1, ACTUAL_V2);

    // EXP-036 freeze: the drawer does NOT close, does NOT crash, and its
    // content does NOT silently move — the cue flips to 'updated'
    await expect(page.getByTestId('defect-drill-cue')).toHaveAttribute('data-state', 'updated', {
      timeout: 4000,
    });
    await expect(drill).toBeVisible();
    await expect(drill.locator('[data-field="actual"]')).not.toContainText('(updated live)');
    await expect(page.getByTestId('defect-drill-cue')).toContainText(/re-open to refresh/i);

    // …and an EXPLICIT re-open shows the current record. In the real geometry
    // the floating drawer overlays the list (pointer events intercepted —
    // discovered by this drive), so re-open = close (×, focus returns to the
    // row trigger) then activate again. That IS the stated behaviour: content
    // updates only on explicit re-open.
    await page.getByTestId('defect-drill-close').click();
    await expect(drill).toBeHidden();
    await page.locator('[data-defect-id="DEFECT-003"] [data-testid="defect-row-trigger"]').click();
    await expect(drill).toBeVisible();
    await expect(drill.locator('[data-field="actual"]')).toContainText('(updated live)', {
      timeout: 4000,
    });
    await expect(page.getByTestId('defect-drill-cue')).toHaveAttribute('data-state', 'live');
  } finally {
    flipDefect003(ACTUAL_V2, ACTUAL_V1); // restore on current bytes
  }
});
