import { test, expect, type Page } from '@playwright/test';

/**
 * UC2 local stand-up — in-game chat (real browser, two contexts).
 *
 * @covers spa-online-chat, chat-panel, chat-message-list, chat-message, chat-input
 *
 * Two browser contexts on the LOCAL WS server exchange chat over the SAME ports
 * the cloud adapters implement (send → relay → echo, SP-C1..C4). This proves the
 * SPA chat send/receive/render loop end-to-end in a REAL browser (not a node
 * probe — a node probe would false-green below CSP/transport) BEFORE any cloud
 * deploy, and pins LAYOUT-S014-1 geometry + the display-side XSS-as-text control
 * against real CSS + real React rendering.
 *
 * SKIP-GATE (NO silent skip — declared in the engineer return): this suite is
 * test.skip-gated until the LAMBDA engineer lands the local WS server `chat`
 * route (src/app/local/ — relay to the other connection + echo to sender). The
 * UC2 SPA is complete and its component tests are green; this two-browser proof
 * needs the local relay parity to stand. Flip CHAT_LOCAL_READY=1 (or remove the
 * gate) once `npm run local`'s WS server handles the `chat` action. Tracked as
 * the UC1↔UC2 local-parity seam in use-cases.md §infra-enabler-4.
 */
const CHAT_LOCAL_READY = process.env.CHAT_LOCAL_READY === '1';

const STABLE = {
  playOnline: /play online/i,
  joinGame: /join a game/i,
};

/** Reach the online board as the HOST (X) — the first connection. */
async function openHost(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: STABLE.playOnline }).click();
  await expect(page.getByTestId('online-role')).toHaveText('You are X', { timeout: 10_000 });
}

/** Reach the online board as the GUEST (O) — the second connection. */
async function openGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: STABLE.joinGame }).click();
  await page.locator('#join-code').fill('LOCAL1');
  await page.locator('button.join-submit').click();
  await expect(page.getByTestId('online-role')).toHaveText('You are O', { timeout: 10_000 });
}

/** Send a chat message from `page` via the chat input + Enter. */
async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

test.describe('UC2 local stand-up — in-game chat (real browser)', () => {
  test.skip(!CHAT_LOCAL_READY, 'local WS chat relay not landed yet (LAMBDA UC1 §infra-4)');

  // F1/F2 — A sends; both A (echo, "You") and B (relay, "Opponent") see it.
  test('two browsers exchange chat; sender sees "You", opponent sees "Opponent"', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      await openGuest(guest);

      await sendChat(host, 'good luck');

      // Host sees their own echo labelled "You".
      const hostRow = host.getByTestId('chat-messages').getByTestId('chat-message').first();
      await expect(hostRow.getByTestId('chat-message-sender')).toHaveText('You', { timeout: 5_000 });
      await expect(hostRow.getByTestId('chat-message-text')).toHaveText('good luck');

      // Guest sees it within ~1s, labelled "Opponent".
      const guestRow = guest.getByTestId('chat-messages').getByTestId('chat-message').first();
      await expect(guestRow.getByTestId('chat-message-sender')).toHaveText('Opponent', { timeout: 5_000 });
      await expect(guestRow.getByTestId('chat-message-text')).toHaveText('good luck');

      // Bidirectional: guest replies, host sees it as "Opponent".
      await sendChat(guest, 'you too');
      const hostReply = host.getByTestId('chat-messages').getByTestId('chat-message').nth(1);
      await expect(hostReply.getByTestId('chat-message-sender')).toHaveText('Opponent', { timeout: 5_000 });
      await expect(hostReply.getByTestId('chat-message-text')).toHaveText('you too');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // F3 — XSS injection renders as literal text; no <img> node, no script run.
  test('an injection string renders as literal text, no <img> node (T-CHAT-3)', async ({ browser }) => {
    const injection = '<img src=x onerror=alert(1)>';
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      await openGuest(guest);

      await sendChat(host, injection);

      const guestText = guest.getByTestId('chat-messages').getByTestId('chat-message-text').first();
      await expect(guestText).toHaveText(injection, { timeout: 5_000 });
      // No <img> element was created from the injected markup in the guest DOM.
      expect(await guest.locator('.chat-messages img').count()).toBe(0);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // LAYOUT-S014-1 — chat panel sits BELOW the board; messages stack vertically.
  test('LAYOUT-S014-1 — chat panel is below the board; messages stack vertically', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      await openGuest(guest);

      // Populate two messages so vertical stacking is observable.
      await sendChat(host, 'first');
      await sendChat(host, 'second');
      await expect(
        host.getByTestId('chat-messages').getByTestId('chat-message'),
      ).toHaveCount(2, { timeout: 5_000 });

      // Chat panel top is at/below the board container bottom (no overlap).
      const board = await host.locator('.online-board').boundingBox();
      const panel = await host.locator('[data-testid="chat-panel"]').boundingBox();
      expect(board, 'board box').not.toBeNull();
      expect(panel, 'chat-panel box').not.toBeNull();
      expect(panel!.y).toBeGreaterThanOrEqual(board!.y + board!.height - 1);

      // Messages stack vertically: row1 top >= row0 bottom.
      const rows = host.getByTestId('chat-messages').getByTestId('chat-message');
      const r0 = await rows.nth(0).boundingBox();
      const r1 = await rows.nth(1).boundingBox();
      expect(r0, 'row 0 box').not.toBeNull();
      expect(r1, 'row 1 box').not.toBeNull();
      expect(r1!.y).toBeGreaterThanOrEqual(r0!.y + r0!.height - 1);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
