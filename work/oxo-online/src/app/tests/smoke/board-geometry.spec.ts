import { test, expect, Page } from '@playwright/test';

/**
 * EXP-016 visual-geometry assertion for DEFECT-S002-001.
 *
 * @covers board-grid (src/app/src/game/Board.tsx + index.css `.board` rule)
 *
 * The board MUST render as a 3×3 SQUARE grid, not a straight line. Every
 * functional spec (role=grid / cell-presence / clicks / win-detection) passed
 * while the nine cells fell into document flow as a single line, because none
 * asserted GEOMETRY. This spec pins geometry: it FAILS on a line layout and
 * passes only when the nine cells occupy three rows × three columns.
 *
 * Robust form: bounding-box positions in a REAL browser with REAL CSS — jsdom
 * cannot see external stylesheet `display:grid`, so a unit computed-style check
 * would false-green. Runs against PROD_URL (pipeline) or any served origin
 * (local dev: PROD_URL=http://localhost:5173).
 *
 * The geometry contract (row-major cells 0..8):
 *   - cells {0,1,2} share a row top (and {3,4,5}, {6,7,8})
 *   - cells {0,3,6} share a column left (and {1,4,7}, {2,5,8})
 *   - there are exactly 3 distinct row-tops and 3 distinct column-lefts
 *   - rows are stacked vertically: top(row1) > top(row0)  (gap > 0)
 *   A single line collapses either the distinct-row count (horizontal line:
 *   1 row, 9 columns) or the distinct-column count (vertical line) — both fail.
 */

const PROD_URL = process.env.PROD_URL;

function getCells(page: Page) {
  return page.locator('[aria-label^="cell "]');
}

/** Read the nine cell bounding boxes in row-major (DOM) order. */
async function cellBoxes(page: Page) {
  const cells = getCells(page);
  await expect(cells).toHaveCount(9);
  const boxes: { x: number; y: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const box = await cells.nth(i).boundingBox();
    expect(box, `cell ${i} has no bounding box`).not.toBeNull();
    // Use the cell centre to make the row/column clustering robust to borders.
    boxes.push({ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  }
  return boxes;
}

/** Cluster a list of coordinates into bands within `tol` px; returns sorted band centres. */
function bands(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > tol) {
      out.push(v);
    }
  }
  return out;
}

test.describe('DEFECT-S002-001 — board is a 3×3 grid (EXP-016 geometry)', () => {
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — geometry runs against a served origin (prod or local dev).',
  );

  test('the nine cells form three rows × three columns (not a line)', async ({ page }) => {
    await page.goto('/');
    const boxes = await cellBoxes(page);

    const tol = 8; // px clustering tolerance — generous vs. typical gap/cell sizes
    const rowBands = bands(boxes.map((b) => b.y), tol);
    const colBands = bands(boxes.map((b) => b.x), tol);

    // A 3×3 grid has exactly 3 distinct rows and 3 distinct columns.
    // A horizontal line → 1 row band; a vertical line → 1 column band.
    expect(rowBands.length, `expected 3 row bands, got ${rowBands.length} (a line collapses rows)`).toBe(3);
    expect(colBands.length, `expected 3 column bands, got ${colBands.length} (a line collapses columns)`).toBe(3);

    // Rows are stacked with a positive vertical gap (board is laid out top→bottom).
    expect(rowBands[1] - rowBands[0], 'row gap must be > 0').toBeGreaterThan(0);
    expect(rowBands[2] - rowBands[1], 'row gap must be > 0').toBeGreaterThan(0);

    // Row-major contract: cells 0,1,2 are on the top row; 0,3,6 are the left column.
    const tops = boxes.map((b) => b.y);
    const lefts = boxes.map((b) => b.x);
    expect(Math.abs(tops[0] - tops[1])).toBeLessThanOrEqual(tol);
    expect(Math.abs(tops[1] - tops[2])).toBeLessThanOrEqual(tol);
    expect(tops[3]).toBeGreaterThan(tops[0] + tol); // second row is below first
    expect(tops[6]).toBeGreaterThan(tops[3] + tol); // third row is below second
    expect(Math.abs(lefts[0] - lefts[3])).toBeLessThanOrEqual(tol);
    expect(Math.abs(lefts[3] - lefts[6])).toBeLessThanOrEqual(tol);
    expect(lefts[1]).toBeGreaterThan(lefts[0] + tol); // second column is right of first
  });
});
