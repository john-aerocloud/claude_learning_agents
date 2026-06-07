import { test, expect, type Page } from '@playwright/test';

/**
 * UC5 local stand-up — BUILD-phase browser suite (OI-28, principles/02).
 *
 * @covers adapter-local-store, adapter-local-relay, spa-online-move (class-deps)
 *
 * Two browser contexts play against the LOCAL WS server (in-memory Games store +
 * relay behind the SAME ports the cloud adapters implement, driving the REAL
 * domain applyMove). This proves the SPA move-send / render-on-broadcast /
 * board-lock loop end-to-end in a real browser BEFORE any cloud deploy. The flag
 * uc4Enabled is ON (set by the local /config.js).
 *
 * Connection binding: the FIRST connection to open is the host (X), the second
 * is the guest (O) — server-derived (S1). So we open the host page first.
 *
 * Mocked-adapter caution (§12a): the local map cannot prove real DynamoDB
 * conditional-write atomicity under genuine concurrency — that platform
 * guarantee is covered by the R2.6 ConditionExpression code-policy pin + UC6 prod
 * zero-divergence, NOT by this browser suite.
 */

const STABLE = {
  playOnline: /play online/i,
  joinGame: /join a game/i,
};

function cell(page: Page, index: number) {
  return page.locator(`[aria-label="cell ${index}"]`);
}

/** Reach the online board as the HOST (X) — the first connection. */
async function openHost(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: STABLE.playOnline }).click();
  await expect(page.getByTestId('online-role')).toHaveText('You are X', {
    timeout: 10_000,
  });
}

/** Reach the online board as the GUEST (O) — the second connection. */
async function openGuest(page: Page): Promise<void> {
  await page.goto('/');
  // The guest opens the join screen and submits any code (the local server binds
  // by connection order, not by code — the code is irrelevant locally).
  await page.getByRole('button', { name: STABLE.joinGame }).click();
  await page.locator('#join-code').fill('LOCAL1');
  await page.locator('button.join-submit').click();
  await expect(page.getByTestId('online-role')).toHaveText('You are O', {
    timeout: 10_000,
  });
}

/** Play a sequence of [page, square] moves, waiting for each to render. */
async function play(moves: Array<[Page, number, 'X' | 'O']>): Promise<void> {
  for (const [page, square, symbol] of moves) {
    await cell(page, square).click();
    // The move renders on BOTH boards from the server broadcast.
    await expect(cell(page, square)).toHaveText(symbol, { timeout: 5_000 });
  }
}

test.describe('UC5 local stand-up — move relay (real browser)', () => {
  // AC5.2 — full game to a WIN; both browsers show the winner.
  test('AC5.2 — two browsers play to a win; both show the result', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      await openGuest(guest);

      // X wins the top row: X:0 O:3 X:1 O:4 X:2.
      await play([
        [host, 0, 'X'],
        [guest, 3, 'O'],
        [host, 1, 'X'],
        [guest, 4, 'O'],
        [host, 2, 'X'],
      ]);

      // Both browsers render the X-wins result (render-on-broadcast game-over).
      await expect(host.getByText(/x wins/i)).toBeVisible({ timeout: 5_000 });
      await expect(guest.getByText(/x wins/i)).toBeVisible({ timeout: 5_000 });

      // Board lock: a further click on the guest fires no move (board unchanged).
      await guest.locator('[aria-label="cell 5"]').click({ force: true }).catch(() => {});
      await expect(cell(guest, 5)).toHaveText('');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // AC5.3 — full game to a DRAW; both browsers show Draw.
  test('AC5.3 — two browsers play to a draw; both show Draw', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      await openGuest(guest);

      // A drawn board:  X O X / X O O / O X X  (no line).
      // Order (X then O alternating): X0 O1 X2 O4 X3 O6 X5 O? ... build a known draw.
      // Final board target: 0X 1O 2X 3X 4O 5O 6O 7X 8X
      await play([
        [host, 0, 'X'],
        [guest, 1, 'O'],
        [host, 2, 'X'],
        [guest, 4, 'O'],
        [host, 3, 'X'],
        [guest, 5, 'O'],
        [host, 7, 'X'],
        [guest, 6, 'O'],
        [host, 8, 'X'],
      ]);

      await expect(host.getByText(/draw/i)).toBeVisible({ timeout: 5_000 });
      await expect(guest.getByText(/draw/i)).toBeVisible({ timeout: 5_000 });
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // AC5.4 — out-of-turn click is rejected politely; board unchanged.
  test('AC5.4 — out-of-turn click is rejected; board unchanged, turn unchanged', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      await openGuest(guest);

      // It is X's turn (host). The guest (O) clicks out of turn.
      await guest.locator('[aria-label="cell 0"]').click({ force: true }).catch(() => {});
      // The board stays empty on BOTH sides (no write, no broadcast).
      await expect(cell(host, 0)).toHaveText('');
      await expect(cell(guest, 0)).toHaveText('');

      // The legitimate X move still works afterwards (game continues normally).
      await play([[host, 0, 'X']]);
      await expect(cell(guest, 0)).toHaveText('X', { timeout: 5_000 });
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
