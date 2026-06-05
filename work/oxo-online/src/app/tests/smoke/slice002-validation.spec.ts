import { test, expect, Page } from '@playwright/test';

/**
 * Slice 002 validation suite — local two-player game
 *
 * Exercises all acceptance criteria against the live production URL.
 * Requires PROD_URL env var.
 *
 * AC-1: Click empty square → symbol (X or O) appears
 * AC-2: Turn indicator alternates X ↔ O after each valid move
 * AC-3: Click taken square → no change to board or turn
 * AC-4: Completed line → board locked, "X wins" or "O wins" shown
 * AC-5: Full board, no winner → "Draw" shown
 * AC-6: "Play again" → board clears, turn resets to X's, new game playable
 * T1/S2: No network request (fetch/XHR/WebSocket) during gameplay beyond initial load
 * T3: Production HTTPS URL serves the game (not a 404, not the old placeholder)
 * S1: Cell values are closed to {X, O, empty} — no arbitrary user text rendered
 */

const PROD_URL = process.env.PROD_URL;

/**
 * Helper: get all 9 cell buttons on the board.
 * Cells carry aria-label="cell N" — this is stable against mode-selector
 * or other button additions to the game screen.
 */
function getCells(page: Page) {
  return page.locator('[aria-label^="cell "]');
}

/**
 * Helper: click a cell by zero-based index (row-major order 0-8).
 */
async function clickCell(page: Page, index: number) {
  const cells = getCells(page);
  await cells.nth(index).click();
}

/**
 * Helper: get the text content of a cell by index.
 */
async function cellText(page: Page, index: number): Promise<string> {
  const cells = getCells(page);
  return (await cells.nth(index).textContent()) ?? '';
}

test.describe('Slice 002 — local two-player game', () => {
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — validation runs only against a deployed environment.',
  );

  // -------------------------------------------------------------------
  // T3: Production URL serves the game (not a 404, not the old placeholder)
  // -------------------------------------------------------------------
  test('T3 — production HTTPS URL serves the game (not 404, not placeholder)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response, 'no response from PROD_URL').not.toBeNull();
    expect(response!.status()).toBe(200);
    expect(response!.url()).toMatch(/^https:\/\//);

    // 9 cell buttons must be present — placeholder had none
    const cells = getCells(page);
    await expect(cells).toHaveCount(9);

    // Turn indicator must show "X's turn" — old placeholder never showed this
    await expect(page.getByText(/x's turn/i)).toBeVisible();
  });

  // -------------------------------------------------------------------
  // AC-1: Click empty square → player symbol appears in that square
  // -------------------------------------------------------------------
  test('AC-1 — clicking an empty square renders the player symbol', async ({ page }) => {
    await page.goto('/');

    // X goes first — click top-left (index 0)
    await clickCell(page, 0);
    const xSymbol = await cellText(page, 0);
    expect(xSymbol.trim()).toBe('X');

    // O goes next — click top-middle (index 1)
    await clickCell(page, 1);
    const oSymbol = await cellText(page, 1);
    expect(oSymbol.trim()).toBe('O');
  });

  // -------------------------------------------------------------------
  // AC-2: Turn indicator alternates X ↔ O after each valid move
  // -------------------------------------------------------------------
  test('AC-2 — turn indicator alternates between X and O', async ({ page }) => {
    await page.goto('/');

    // Initial state: X's turn
    await expect(page.getByText(/x's turn/i)).toBeVisible();

    // After X moves → O's turn
    await clickCell(page, 0);
    await expect(page.getByText(/o's turn/i)).toBeVisible();

    // After O moves → X's turn
    await clickCell(page, 1);
    await expect(page.getByText(/x's turn/i)).toBeVisible();

    // After X moves → O's turn again
    await clickCell(page, 2);
    await expect(page.getByText(/o's turn/i)).toBeVisible();
  });

  // -------------------------------------------------------------------
  // AC-3: Click a taken square → no change to board or turn
  // -------------------------------------------------------------------
  test('AC-3 — clicking a taken square has no effect', async ({ page }) => {
    await page.goto('/');

    // X claims cell 0
    await clickCell(page, 0);
    await expect(page.getByText(/o's turn/i)).toBeVisible();

    // Verify cell 0 is disabled (the app's mechanism for preventing re-click).
    // A disabled button cannot be activated by user input — this satisfies AC-3.
    const cells = getCells(page);
    await expect(cells.nth(0)).toBeDisabled();

    // Force-click to confirm the React handler does not fire on a disabled cell
    // (i.e., turn does not advance even if the DOM event is dispatched).
    await cells.nth(0).click({ force: true });

    // Turn must NOT have advanced — still O's turn
    await expect(page.getByText(/o's turn/i)).toBeVisible();
    await expect(page.getByText(/x's turn/i)).not.toBeVisible();

    // Cell 0 still shows X, not changed
    const symbol = await cellText(page, 0);
    expect(symbol.trim()).toBe('X');
  });

  // -------------------------------------------------------------------
  // AC-4: Completing a winning line locks the board and shows winner
  // -------------------------------------------------------------------
  test('AC-4 — completing a winning line locks board and shows "X wins"', async ({ page }) => {
    await page.goto('/');

    // X wins top row: 0, 1, 2 with O playing 3, 4
    // Move sequence: X:0, O:3, X:1, O:4, X:2 (X wins top row)
    await clickCell(page, 0); // X
    await clickCell(page, 3); // O
    await clickCell(page, 1); // X
    await clickCell(page, 4); // O
    await clickCell(page, 2); // X wins

    // Result must show "X wins"
    await expect(page.getByText(/x wins/i)).toBeVisible();

    // Board must be locked — clicking remaining empty cells should have no effect.
    // After a win all cells are disabled; force-click to confirm the lock holds.
    const cells = getCells(page);
    await cells.nth(5).click({ force: true });
    await expect(page.getByText(/x wins/i)).toBeVisible();
    // Turn indicator should not show (game is over)
    await expect(page.getByText(/x's turn/i)).not.toBeVisible();
    await expect(page.getByText(/o's turn/i)).not.toBeVisible();
  });

  test('AC-4 — "O wins" is shown when O completes a winning line', async ({ page }) => {
    await page.goto('/');

    // O wins left column: cells 0, 3, 6
    // X: 1, 2, 4  O: 0, 3, 6
    // Move sequence: X:1, O:0, X:2, O:3, X:4, O:6 → O wins left column
    await clickCell(page, 1); // X
    await clickCell(page, 0); // O
    await clickCell(page, 2); // X
    await clickCell(page, 3); // O
    await clickCell(page, 4); // X
    await clickCell(page, 6); // O wins

    await expect(page.getByText(/o wins/i)).toBeVisible();
  });

  // -------------------------------------------------------------------
  // AC-5: Full board, no winner → "Draw" shown
  // -------------------------------------------------------------------
  test('AC-5 — full board with no winner shows "Draw"', async ({ page }) => {
    await page.goto('/');

    // Fill board to a known draw:
    // Board layout (0-8, row major):
    //   0 | 1 | 2
    //   3 | 4 | 5
    //   6 | 7 | 8
    //
    // Draw sequence: X:0, O:1, X:2, O:4, X:3, O:6, X:5, O:2...
    // Use a provably draw sequence:
    //   X: 0 2 5 6 7
    //   O: 1 3 4 7 8  — need to verify no win
    //
    // Classic draw sequence (no three-in-a-row for either player):
    //   X:0, O:4, X:2, O:1, X:7, O:3, X:5, O:8, X:6  — this is a known draw
    const moves = [0, 4, 2, 1, 7, 3, 5, 8, 6];
    for (const idx of moves) {
      await clickCell(page, idx);
    }

    await expect(page.getByText(/draw/i)).toBeVisible();
  });

  // -------------------------------------------------------------------
  // AC-6: "Play again" resets board and turn, new game is playable
  // -------------------------------------------------------------------
  test('AC-6 — "Play again" resets the game', async ({ page }) => {
    await page.goto('/');

    // Play to a win first
    await clickCell(page, 0); // X
    await clickCell(page, 3); // O
    await clickCell(page, 1); // X
    await clickCell(page, 4); // O
    await clickCell(page, 2); // X wins

    await expect(page.getByText(/x wins/i)).toBeVisible();

    // Click "Play again"
    await page.getByRole('button', { name: /play again/i }).click();

    // Board must be clear: all 9 cells empty
    const cells = getCells(page);
    await expect(cells).toHaveCount(9);
    for (let i = 0; i < 9; i++) {
      const text = (await cells.nth(i).textContent()) ?? '';
      expect(text.trim(), `cell ${i} should be empty after reset`).toBe('');
    }

    // Turn indicator must show X's turn
    await expect(page.getByText(/x's turn/i)).toBeVisible();

    // A full new game must be playable
    await clickCell(page, 0);
    expect((await cellText(page, 0)).trim()).toBe('X');
    await expect(page.getByText(/o's turn/i)).toBeVisible();
  });

  // -------------------------------------------------------------------
  // T1 / S2: No network requests during gameplay (moves, win, draw, reset)
  // -------------------------------------------------------------------
  test('T1/S2 — no fetch/XHR/WebSocket during gameplay after initial page load', async ({ page }) => {
    const postLoadRequests: string[] = [];

    // Navigate and wait for initial load to settle
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // NOW register the listener — any request after this point is a gameplay request
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['fetch', 'xhr', 'websocket'].includes(type)) {
        postLoadRequests.push(`${req.method()} ${type} ${req.url()}`);
      }
    });

    // Exercise gameplay: moves, win, then play again (reset)
    await clickCell(page, 0); // X
    await clickCell(page, 3); // O
    await clickCell(page, 1); // X
    await clickCell(page, 4); // O
    await clickCell(page, 2); // X wins

    await expect(page.getByText(/x wins/i)).toBeVisible();

    // Click "Play again" (reset)
    await page.getByRole('button', { name: /play again/i }).click();
    await expect(page.getByText(/x's turn/i)).toBeVisible();

    // Play a few more moves
    await clickCell(page, 4); // X
    await clickCell(page, 0); // O

    // Flush any async network activity
    await page.waitForTimeout(500);

    expect(
      postLoadRequests,
      `Unexpected network requests during gameplay: ${postLoadRequests.join(', ')}`,
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // S1: Cell values are closed to {X, O, empty} — no arbitrary user text
  // -------------------------------------------------------------------
  test('S1 — cell values are closed to X, O, or empty', async ({ page }) => {
    await page.goto('/');

    // Play several moves
    await clickCell(page, 0); // X
    await clickCell(page, 4); // O
    await clickCell(page, 2); // X
    await clickCell(page, 6); // O

    const cells = getCells(page);
    const count = await cells.count();

    for (let i = 0; i < count; i++) {
      const text = ((await cells.nth(i).textContent()) ?? '').trim();
      expect(
        ['X', 'O', ''],
        `Cell ${i} contains unexpected value: "${text}"`,
      ).toContain(text);
    }
  });
});
