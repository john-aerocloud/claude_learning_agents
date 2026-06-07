import { test, expect, type Page } from '@playwright/test';

/**
 * s007 UC3-S4 — local survivor-flow browser suite (principles/02, real browser).
 *
 * @covers spa-online-disconnect (class-deps), adapter-local-relay
 *
 * Two browser contexts pair into one local online game against the LOCAL WS
 * server. Browser A (host) closes its tab; the local server's $disconnect parity
 * drives the SAME pure disconnect decision over the local adapters and posts ONE
 * `opponent-disconnected` frame to Browser B (the survivor). Browser B must then
 * show the pinned "Your opponent disconnected." message and return to the mode
 * selector WITHOUT a reload — the exact UC4 prod smoke, proven locally first.
 *
 * SKIP-GATE (no silent skip): this spec is `test.describe.skip`-gated until the
 * UC1 local stand-up emits the survivor frame on socket close.
 *   - UC1 owns `src/app/local/server.ts` (its stand-up deliverable, route.md
 *     UC1-S6). Its current `ws.on('close')` only unregisters the connection
 *     (server.ts:104-108); it does NOT yet run decideDisconnect over the local
 *     adapters nor post `opponent-disconnected` to the survivor.
 *   - UN-SKIP CONDITION: when UC1-S6 ("local stand-up $disconnect parity") lands
 *     and the local server posts exactly 1 `opponent-disconnected` to the
 *     survivor on a host/guest close of an ACTIVE local game, remove the
 *     `.skip` below. The SPA side (this slice's UC3) is already wired and unit-
 *     proven (GameRoot.test.tsx AC3.1-AC3.4); this is the end-to-end local proof.
 *
 * The skeleton equivalent (tests/skeleton/disconnect.skeleton.spec.ts, the shared
 * UC1+UC3 §11a prod probe) is the cloud counterpart and is owned/landed jointly.
 */

const STABLE = {
  playOnline: /play online/i,
  joinGame: /join a game/i,
};

function cell(page: Page, index: number) {
  return page.locator(`[aria-label="cell ${index}"]`);
}

async function openHost(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: STABLE.playOnline }).click();
  await expect(page.getByTestId('online-role')).toHaveText('You are X', {
    timeout: 10_000,
  });
}

async function openGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: STABLE.joinGame }).click();
  await page.locator('#join-code').fill('LOCAL1');
  await page.locator('button.join-submit').click();
  await expect(page.getByTestId('online-role')).toHaveText('You are O', {
    timeout: 10_000,
  });
}

// UN-SKIPPED (s007 S007-RENDER-FIX): UC1-S6 local $disconnect parity has landed
// (server.ts runs handleLocalDisconnect on close + posts the survivor frame).
// This honest reproduction is RED because the guest-side JoinScreen drops the
// opponent-disconnected frame (no routing branch) — the live transport seam the
// SPA component tests (mocked socket) cannot see.
test.describe('s007 UC3 local stand-up — survivor flow (real browser)', () => {
  // AC3.1 + AC3.2 + T2 — host closes; survivor sees the message and returns to
  // the mode selector without a reload.
  test('survivor sees "Your opponent disconnected." and returns to the mode selector', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      await openGuest(guest);

      // An active game: one move so it is unambiguously `active`, not `waiting`.
      await cell(host, 0).click();
      await expect(cell(guest, 0)).toHaveText('X', { timeout: 5_000 });

      // The host's tab closes — the local server fires $disconnect parity.
      await hostCtx.close();

      // The survivor (guest) sees the pinned message within the smoke window and
      // is returned to the mode selector — the board goes inert, no reload.
      await expect(guest.getByTestId('opponent-disconnected')).toHaveText(
        'Your opponent disconnected.',
        { timeout: 10_000 },
      );
      await expect(
        guest.getByRole('group', { name: /game mode/i }),
      ).toBeVisible();
      await expect(guest.getByTestId('online-role')).toHaveCount(0);

      // Clean restart (F2/T6): the survivor immediately starts a FRESH online
      // game with no residual state. Against the local stand-up the host's
      // register short-circuits to game-ready (single-game server), so the
      // fresh session lands on the online board as X — the same contract
      // `openHost` asserts. Reaching a clean `You are X` over a NEW socket (no
      // prior board, gameId, or "You are O" survivor role retained) proves the
      // clean restart the abandoned session did not leak into.
      await guest.getByTestId('back-to-menu').click();
      await guest.getByRole('button', { name: STABLE.playOnline }).click();
      await expect(guest.getByTestId('online-role')).toHaveText('You are X', {
        timeout: 10_000,
      });
    } finally {
      await hostCtx.close().catch(() => {});
      await guestCtx.close();
    }
  });
});
