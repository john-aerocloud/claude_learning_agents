// @covers SPA_DEFECTSPANEL
// @covers SPA_DEFECTDRILL
// @covers SPA_MARKDOWNLIB
// @covers uc-s013-3
//
// s013 defect drill — REAL-DATA validation spec (EXP-033 policy, UC-S013-3).
//
// Drives the drill against the LIVE GET /api/projects/observatory/defects on
// :5173. Resolved-path ground truth is LIVE DEFECT-001 (reconciled from
// process/dora/ledger.csv rows 817→821): mttr_s=815 → "13 min", reported
// 2026-06-10T06:17:47Z → recovered 06:31:22Z, fix_sha "3d8c21c, 82a622c",
// actual carries **0 for everything** (the live FIG-6 case).
//
// OPEN-PATH NOTE: all 12 live records are currently CLOSED (DEFECT-012 closed
// 2026-06-11T07:43:41Z), so the open MttrCard path has NO live instance — it
// is exercised by the FIXTURE spec (defect-drill.spec.js, demo DEFECT-003),
// per the ui-design.md open-path decision. This spec asserts the resolved
// path + the ledger-only null-field path (DEFECT-011).
//
// Relevancy: pinned (real-data ground truth; re-verify after any change to
//   the drill components, lib/markdown.js, DEFECT-001.md, or the live ledger).
//
// Runs only when REUSE_SERVER=1 is set (live-server signal).
import { test, expect } from '@playwright/test';

const LIVE_DATA = !!process.env.REUSE_SERVER;
test.skip(!LIVE_DATA, 'real-data spec: runs only with REUSE_SERVER=1 (live observatory server on :5173)');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-tab-defects').click();
  await expect(page.getByTestId('defects-panel')).toBeVisible();
  await expect(page.getByTestId('defect-row').first()).toBeVisible();
});

function row(page, id) {
  return page.locator(`[data-defect-id="${id}"][data-testid="defect-row"]`);
}

async function openDrill(page, id) {
  await row(page, id).getByTestId('defect-row-trigger').click();
  const drill = page.getByTestId('defect-drill');
  await expect(drill).toBeVisible();
  await expect(drill).toHaveAttribute('data-defect-id', id);
  return drill;
}

test('AC-S013-3-3/4/5 — live DEFECT-001: expected text from the live file, fix shas 3d8c21c + 82a622c, MTTR "13 min" with human timestamps', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-001');
  await expect(page.getByTestId('defect-drill-heading')).toContainText('DEFECT-001');
  // AC-S013-3-3: the live file's Expected field appears in the drawer
  await expect(page.locator('[data-field="expected"]')).toContainText(
    'Opening the Observatory UI',
  );
  // AC-S013-3-4 / S13-3-FIG-4: both live fix shas render as <code> refs
  const shas = page.getByTestId('defect-fix-sha');
  await expect(shas).toHaveCount(2);
  await expect(shas.nth(0)).toHaveText('3d8c21c');
  await expect(shas.nth(1)).toHaveText('82a622c');
  // AC-S013-3-5 / S13-3-FIG-1/3: resolved MttrCard from live ledger rows
  await expect(page.getByTestId('mttr-card')).toHaveAttribute('data-mttr-state', 'resolved');
  await expect(page.getByTestId('mttr-figure')).toHaveText('13 min');
  await expect(page.getByTestId('mttr-figure')).toHaveAttribute('data-mttr-seconds', '815');
  await expect(page.getByTestId('mttr-reported')).toHaveText('2026-06-10 06:17:47 UTC');
  await expect(page.getByTestId('mttr-recovered')).toHaveText('2026-06-10 06:31:22 UTC');
});

test('AC-S013-3-2 / S13-3-FIG-6 — live markdown renders as HTML: DEFECT-001 actual shows real <strong>, no literal ** anywhere in the drawer', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-001');
  const actual = page.locator('[data-field="actual"]');
  await expect(actual.locator('strong')).toContainText('0 for everything');
  const drillText = await page.getByTestId('defect-drill').textContent();
  expect(drillText).not.toContain('**');
  expect(drillText).not.toMatch(/(^|\s)##\s/);
});

test('AC-S013-3-7 / S13-3-FIG-5/7 — live ledger-only DEFECT-011: severity "—", absent fields "—", ledger provenance; no crash', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await openDrill(page, 'DEFECT-011');
  await expect(page.getByTestId('defect-detail-severity')).toHaveText('—');
  await expect(page.locator('[data-field="expected"]')).toHaveText('—');
  await expect(page.getByTestId('defect-fix')).toContainText('—');
  await expect(page.getByTestId('defect-detail')).toHaveAttribute(
    'data-source',
    'process/dora/ledger.csv#ref=DEFECT-011',
  );
  await expect(page.getByTestId('mttr-card')).toHaveAttribute(
    'data-source',
    'process/dora/ledger.csv#ref=DEFECT-011',
  );
  expect(errors).toEqual([]);
});

test('AC-S013-3-8/9 — GEO no-reflow on live data; close returns to the list with focus on the row', async ({
  page,
}) => {
  const panelBefore = await page.getByTestId('defects-panel').boundingBox();
  const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
  await openDrill(page, 'DEFECT-001');
  expect(await page.getByTestId('defects-panel').boundingBox()).toEqual(panelBefore);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(heightBefore);
  await page.getByTestId('defect-drill-close').click();
  await expect(page.getByTestId('defect-drill')).toHaveCount(0);
  await expect(row(page, 'DEFECT-001').getByTestId('defect-row-trigger')).toBeFocused();
});

// EXP-033 BONUS: DEFECT-014 is the live open defect (CONFIRMED, recovered_ts=null,
// mttr_s=null). All 15 live records exist now. Validates the OPEN MttrCard path
// on real production data (complement to the fixture DEFECT-003 path).
test('EXP-033/S13-3-FIG-2 — live OPEN DEFECT-014: MttrCard shows "Not yet resolved", elapsed figure NOT labelled MTTR, no crash', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await openDrill(page, 'DEFECT-014');
  // drawer opened — identity confirmed
  await expect(page.getByTestId('defect-drill')).toHaveAttribute('data-defect-id', 'DEFECT-014');
  const card = page.getByTestId('mttr-card');
  await expect(card).toHaveAttribute('data-mttr-state', 'open');
  // recovered slot must say "Not yet resolved" — never a timestamp or "0"
  await expect(page.getByTestId('mttr-recovered')).toHaveText('Not yet resolved');
  const figure = page.getByTestId('mttr-figure');
  // the elapsed figure must be "open for …" format — NOT labelled MTTR (DEFECT-007 lesson)
  await expect(figure).toHaveText(/^open for \d+/);
  expect(await figure.textContent()).not.toMatch(/^0|null/);
  // the dt label over the elapsed figure must NOT say "MTTR"
  const label = await figure.evaluate((dd) => dd.closest('div').querySelector('dt').textContent);
  expect(label).not.toMatch(/MTTR/);
  // no raw-seconds data on the figure (open span has no mttr_s)
  await expect(figure).not.toHaveAttribute('data-mttr-seconds', /.+/);
  // fix_sha is null for DEFECT-014 — must show "—"
  await expect(page.getByTestId('defect-fix')).toContainText('—');
  expect(errors).toEqual([]);
});

// DEFECT-015 has mttr_s=0 (reported_ts === recovered_ts — instantaneous repair).
// The UI must not crash and must not show bare "0" or "0 s" as the MTTR.
// Acceptable: "< 1 min" / "0 s" is a known boundary — but "0" alone violates FIG-1
// (bare integer, no unit). The unit is mandatory. No crash is the hard floor.
test('EXP-033/S13-3-FIG-1/5 — live DEFECT-015 (mttr_s=0): no crash, bare "0" never visible, null fields render "—"', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await openDrill(page, 'DEFECT-015');
  await expect(page.getByTestId('defect-drill')).toHaveAttribute('data-defect-id', 'DEFECT-015');
  const card = page.getByTestId('mttr-card');
  await expect(card).toHaveAttribute('data-mttr-state', 'resolved');
  const figureText = await page.getByTestId('mttr-figure').textContent();
  // must NOT be bare "0" — must carry a unit or be a labelled boundary
  expect(figureText).not.toMatch(/^0$/);
  expect(figureText).not.toMatch(/^0\s*$/);
  // severity null -> "—" (same as DEFECT-011)
  await expect(page.getByTestId('defect-detail-severity')).toHaveText('—');
  expect(errors).toEqual([]);
});

// Count line now reflects 15 records, 1 open (DEFECT-014).
// Validates the updated live state (data drift from the original acceptance.md sketch).
test('EXP-033/AC-S013-2-1 — live defect list now shows 15 records with 1 open (DEFECT-014)', async ({
  page,
}) => {
  const countText = await page.getByTestId('defects-count').textContent();
  expect(countText).toContain('15');
  expect(countText).toContain('1');
  expect(countText.toLowerCase()).toContain('open');
  // DEFECT-014 leads the list (CONFIRMED group first)
  await expect(row(page, 'DEFECT-014')).toHaveAttribute('data-open', 'true');
  await expect(row(page, 'DEFECT-014')).toHaveAttribute('data-status', 'CONFIRMED');
});
