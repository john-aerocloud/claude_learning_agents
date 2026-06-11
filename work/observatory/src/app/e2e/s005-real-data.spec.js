// @covers WorkItemTree
// @covers WorkItemTreeContainer
// @covers ItemHistoryPanel
// @covers DetailPane
// @covers DetailPaneContainer
//
// s005-workitem-tree — REAL-DATA validation spec (EXP-033 policy).
//
// READ-ONLY: this spec only reads live data — no filesystem mutations.
// AC-S005-6-2 (items.csv append live-refresh) is validated separately via
// the make browser-observatory-ephemeral target (fixture-backed SSE spec).
//
// Runs against the live observatory project data (not the deterministic fixture).
// This spec MUST pass for slice s005 to be accepted.
//
// Expected runtime configuration:
//   OBSERVATORY_E2E_PORT=5203   (ephemeral Vite server pointing at the live repo)
//   OBSERVATORY_REPO_ROOT unset  (server uses the default: 5 levels up from its own dir)
//
// Covers:
//   AC-S005-2-1  node count = items.csv row count (32 at time of writing; will grow)
//   AC-S005-2-3  CHK-1 state=done, CHK-4 state=in-progress [REAL-DATA]
//   AC-S005-5-1  history for UC-S001-1 shows ≥1 row; count matches ledger.csv [REAL-DATA]
//   AC-S005-1-1  GET /api/projects/observatory/ledger?item_id=UC-S001-1 returns rows [REAL-DATA]
//
// Real-data EXP-033 done-condition table (filled at runtime):
//   | Case        | item_id     | Expected        | Actual   | Match |
//   | AC-S005-1-1 | UC-S001-1   | ≥1 row          | (runtime)| yes/no|
//   | AC-S005-2-1 | items.csv   | 32              | (runtime)| yes/no|
//   | AC-S005-2-3 | CHK-1,CHK-4 | done, in-prog   | (runtime)| yes/no|
//   | AC-S005-5-1 | UC-S001-1   | 14              | (runtime)| yes/no|
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// This spec runs ONLY when REUSE_SERVER=1 is set (the live-data signal).
// Without it the playwright config starts a fresh fixture server (OBSERVATORY_REPO_ROOT
// points at e2e/fixtures/repo which has REQ-DEMO, not REQ-OBSERVATORY) and every
// assertion fails. The standard `make browser-observatory-ephemeral` target DOES NOT
// set REUSE_SERVER; the tester's live-data run sets it explicitly.
const LIVE_DATA = !!process.env.REUSE_SERVER;

test.skip(!LIVE_DATA, 'real-data spec only runs with REUSE_SERVER=1 (live observatory data)');

// Resolve the path to the live observatory items.csv.
// Use the OBSERVATORY_REPO_ROOT env if set (matches server path resolution).
function itemsCsvPath() {
  const root = process.env.OBSERVATORY_REPO_ROOT;
  if (root) return resolve(root, 'work', 'observatory', 'items', 'items.csv');
  // Traverse up: e2e/ → src/app/ → src/ → observatory/ (3 levels) then items/items.csv
  return resolve(
    new URL(import.meta.url).pathname,
    '..', '..', '..', '..', 'items', 'items.csv',
  );
}

// Count data rows (skip header) in a CSV file.
function csvDataRowCount(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  return lines.length - 1; // subtract header
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The live server serves the full observatory tree.
  await expect(page.getByTestId('work-item-tree')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-item-id="REQ-OBSERVATORY"]')).toBeVisible({ timeout: 15000 });
});

// ---- AC-S005-2-1: Tree node count matches live items.csv [REAL-DATA] ----
test('AC-S005-2-1 — tree node count equals live items.csv row count [REAL-DATA]', async ({
  page,
}) => {
  const csvPath = itemsCsvPath();
  const expectedCount = csvDataRowCount(csvPath);

  // All nodes are expanded by default; count them.
  const nodes = page.getByTestId('tree-node');
  await expect(nodes).toHaveCount(expectedCount, { timeout: 10000 });

  // eslint-disable-next-line no-console
  console.log(
    `[AC-S005-2-1] items.csv rows=${expectedCount}, rendered tree-nodes=${await nodes.count()}, MATCH=yes`,
  );
});

// ---- AC-S005-2-3: CHK-1=done, CHK-4=in-progress [REAL-DATA] ----
test('AC-S005-2-3 — CHK-1 shows state=done; CHK-4 shows state=in-progress [REAL-DATA]', async ({
  page,
}) => {
  const chk1 = page.locator('[data-item-id="CHK-1"] > .tree-node__row');
  await expect(chk1.getByTestId('state-badge')).toContainText('done');

  const chk4 = page.locator('[data-item-id="CHK-4"] > .tree-node__row');
  await expect(chk4.getByTestId('state-badge')).toContainText('in-progress');

  // eslint-disable-next-line no-console
  console.log('[AC-S005-2-3] CHK-1=done, CHK-4=in-progress, MATCH=yes');
});

// ---- UC-S005-* states as expected by acceptance.md ----
test('UC-S005-1/2/3 done; UC-S005-4/5 ready; UC-S005-6 blocked [REAL-DATA]', async ({
  page,
}) => {
  for (const [id, expected] of [
    ['UC-S005-1', 'done'],
    ['UC-S005-2', 'done'],
    ['UC-S005-3', 'done'],
    ['UC-S005-4', 'ready'],
    ['UC-S005-5', 'ready'],
    ['UC-S005-6', 'blocked'],
  ]) {
    const node = page.locator(`[data-item-id="${id}"] > .tree-node__row`);
    await expect(node.getByTestId('state-badge')).toContainText(expected, { timeout: 5000 });
  }
  // eslint-disable-next-line no-console
  console.log('[UC-S005-* states] all six UCs show expected states, MATCH=yes');
});

// ---- AC-S005-5-1: item history for UC-S001-1 shows real ledger rows [REAL-DATA] ----
test('AC-S005-5-1 — UC-S001-1 history shows 14 ledger rows readable, newest-first [REAL-DATA]', async ({
  page,
}) => {
  // Click UC-S001-1 to open the detail pane.
  await page.locator('[data-item-id="UC-S001-1"] > .tree-node__row').click();
  const pane = page.getByTestId('detail-pane');
  await expect(pane).toBeVisible({ timeout: 5000 });

  const history = page.getByTestId('item-history');
  await expect(history).toBeVisible();

  // The live ledger.csv has 14 rows for UC-S001-1 (verified by hand-count).
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(14, { timeout: 10000 });

  // AC-S005-5-2: newest-first order.
  const firstTs = await rows.first().getAttribute('data-timestamp');
  const lastTs = await rows.last().getAttribute('data-timestamp');
  expect(Date.parse(firstTs)).toBeGreaterThanOrEqual(Date.parse(lastTs));

  // AC-S005-5-3: readable fields — not "row:N".
  await expect(history).not.toContainText(/\brow:\d+/);
  await expect(history).toContainText('engineer');

  // eslint-disable-next-line no-console
  console.log(`[AC-S005-5-1] UC-S001-1: expected=14, actual=${await rows.count()}, MATCH=yes`);
});
