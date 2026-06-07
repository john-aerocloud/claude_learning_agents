import { test, expect, type Page } from '@playwright/test';

/**
 * s006 WALKING-SKELETON — ONE real move through the FULL deployed path in TWO
 * REAL BROWSERS (§17, process v25/v27). NOT a node probe: a node ws/fetch runs
 * below CSP/transport and gives a FALSE GREEN. This spec drives the deployed SPA
 * (create → pair → move) so it exercises the real authorizer, the real WS relay
 * (@connections), and the real conditional move write end-to-end.
 *
 * Three assertions (the engineer's skeleton proof obligation for Wave B):
 *   1. VALID MOVE RELAYED: an in-turn host move appears on BOTH browsers' boards
 *      (server-authoritative board-update fan-out — T1).
 *   2. OUT-OF-TURN REJECTED: a guest click while it is X's turn produces NO board
 *      change on either browser (sender-only reject, board byte-unchanged — S2).
 *   3. FORGED gameId REJECTED: a move frame with a foreign/guessed gameId is
 *      authorized against a record the sender is not bound to → rejected, no
 *      write, no broadcast (S1a). Driven through the live socket in-browser.
 *
 * Discovery→regression: any console error / blocked WS / undefined config found
 * driving this live becomes a committed assertion here (console-error capture).
 *
 * Stable selectors only (process v22/v23): game code [data-testid="game-code"],
 * role [data-testid="online-role"], cells [aria-label^="cell "], join #join-code
 * + button.join-submit — the same ones the s005-h2 pairing smoke uses.
 */

const PROD_URL = process.env.PROD_URL;

function cell(page: Page, index: number) {
  return page.locator(`[aria-label="cell ${index}"]`);
}

async function startHostGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const codeEl = page.locator('[data-testid="game-code"]');
  await expect(codeEl).toBeVisible({ timeout: 5000 });
  const code = (await codeEl.textContent()) ?? '';
  expect(code.length, 'host game code must be 6 chars').toBe(6);
  return code;
}

async function guestJoin(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 3000 });
  await page.locator('#join-code').fill(code);
  await page.locator('button.join-submit').click();
}

test.describe('s006 walking-skeleton — move relay through the deployed path', () => {
  test.skip(!PROD_URL, 'PROD_URL is not set — the skeleton runs only against a deployed environment.');

  test('valid move relays to both; out-of-turn rejected; forged gameId rejected', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    const errors: string[] = [];
    for (const [who, page] of [['host', host], ['guest', guest]] as const) {
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${who} PAGE_ERROR: ${e.message}`));
    }

    try {
      // Pair the two real browsers through the real authorizer + WS relay.
      // game-ready (and thus the role label) fires only once BOTH are bound, so
      // the guest joins first, then both roles are asserted.
      const code = await startHostGame(host);
      await guestJoin(guest, code);
      await expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', { timeout: 8000 });
      await expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', { timeout: 8000 });
      // Both boards become active (host's turn = X).
      await expect(host.locator('[data-testid="online-turn"]')).toBeVisible({ timeout: 5000 });

      // 1. VALID MOVE RELAYED (T1): host (X) plays square 4; it must render on BOTH.
      await cell(host, 4).click();
      await expect(cell(host, 4), 'host sees own move via server broadcast').toHaveText('X', { timeout: 5000 });
      await expect(cell(guest, 4), 'guest sees host move relayed').toHaveText('X', { timeout: 5000 });

      // 2. OUT-OF-TURN REJECTED (S2): it is now O's turn; host (X) clicks again.
      //    The board must NOT change on either side (sender-only reject, 0 writes).
      await cell(host, 0).click({ force: true }).catch(() => {});
      await guest.waitForTimeout(1000);
      await expect(cell(host, 0), 'out-of-turn host move not applied').toHaveText('');
      await expect(cell(guest, 0), 'out-of-turn move not relayed').toHaveText('');

      // 3. FORGED gameId REJECTED (S1a): open a REAL sibling WS in-browser with
      //    the guest's own `code` credential and fire a move carrying a forged,
      //    non-existent gameId. The deployed handler does GetItem(Games,forged)
      //    → miss (or a record the sender binds to neither slot) → reject, NO
      //    write, NO broadcast. Driven in-browser so it travels the real
      //    CSP/transport path (no FALSE GREEN). The legitimate board is unchanged.
      const forged = await guest.evaluate(async (joinCode) => {
        const cfg = (window as unknown as { OXO_CONFIG?: { wsUrl?: string } }).OXO_CONFIG;
        if (!cfg?.wsUrl) return { ok: false, reason: 'no-config' };
        const url = `${cfg.wsUrl}?code=${encodeURIComponent(joinCode)}`;
        return await new Promise<{ ok: boolean; reason: string }>((resolve) => {
          let settled = false;
          const finish = (r: { ok: boolean; reason: string }) => {
            if (!settled) { settled = true; resolve(r); }
          };
          let ws: WebSocket;
          try {
            ws = new WebSocket(url);
          } catch (e) {
            finish({ ok: false, reason: `construct-failed: ${String(e)}` });
            return;
          }
          ws.onopen = () => {
            ws.send(JSON.stringify({ action: 'move', gameId: 'forged-nonexistent-0000', square: 1 }));
          };
          ws.onmessage = (ev) => {
            try {
              const m = JSON.parse(String((ev as MessageEvent).data));
              // A reject frame to the sender is the correct, observable outcome.
              if (m.type === 'move-rejected') { finish({ ok: true, reason: 'move-rejected' }); }
              // A board-update would mean the forged move was WRONGLY applied.
              if (m.type === 'board-update') { finish({ ok: false, reason: 'forged-applied' }); }
            } catch { /* ignore non-JSON */ }
          };
          // No board-update within the window = not applied = correct (some
          // deploys drop the reject frame silently; board invariance below is
          // the authoritative check).
          setTimeout(() => finish({ ok: true, reason: 'no-broadcast' }), 3000);
        });
      }, code);

      expect(forged.ok, `forged-gameId move must not be applied (got: ${forged.reason})`).toBe(true);
      // Authoritative invariance: square 1 stayed empty on BOTH legitimate boards.
      await expect(cell(host, 1), 'forged-gameId move never written (host view)').toHaveText('');
      await expect(cell(guest, 1), 'forged-gameId move never written (guest view)').toHaveText('');

      // No WS/CSP console errors anywhere (browser-transport gate).
      const transportErrors = errors.filter((e) =>
        /websocket|csp|content.security|connect.src|wss:|failed.to.construct/i.test(e),
      );
      expect(transportErrors, `WS/CSP console errors: ${errors.join('; ')}`).toHaveLength(0);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
