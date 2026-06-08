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
 * LOCAL-PARITY: this suite drives the LAMBDA engineer's local WS server `chat`
 * route (landed on trunk — src/app/local/server.ts + chat-handler.ts: relay to
 * the other connection + echo to sender). It is UN-gated and runs as standing
 * regression in `make test-local`. (During the build it was test.skip-gated on
 * `CHAT_LOCAL_READY` until that local relay landed — the gate is retained as an
 * escape hatch but defaults ON now the parity is in.)
 */
const CHAT_LOCAL_READY = process.env.CHAT_LOCAL_READY !== '0';

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

  // F3 / T-CHAT-3 — an injection attempt never becomes an executable node in the
  // recipient's DOM. End-to-end BOTH controls are active: the server strips
  // `<>&"'` before relay (T-CHAT-4 depth) AND React renders the result as text
  // (T-CHAT-3 display — THE control). The display-side render-as-text guarantee
  // (raw string in → literal textContent, no node) is pinned exactly in the
  // ChatMessage component test (AC2.10); here we pin the end-to-end USER symptom:
  // no <img> node, no script execution, message shown as plain text.
  test('an injection attempt creates no <img> node and renders as plain text (T-CHAT-3)', async ({ browser }) => {
    const injection = '<img src=x onerror=alert(1)>';
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    let dialogFired = false;
    guest.on('dialog', (d) => {
      dialogFired = true;
      void d.dismiss();
    });
    try {
      await openHost(host);
      await openGuest(guest);

      await sendChat(host, injection);

      // The message arrives and renders as a plain-text node (whatever the
      // server-normalised form — the angle brackets are stripped server-side).
      const guestText = guest.getByTestId('chat-messages').getByTestId('chat-message-text').first();
      await expect(guestText).toBeVisible({ timeout: 5_000 });
      await expect(guestText).toContainText('img src=x onerror=alert(1)');
      // The real XSS guard: NO <img> element was created from the markup, and no
      // onerror handler fired a dialog, in the recipient's DOM.
      expect(await guest.locator('.chat-messages img').count()).toBe(0);
      expect(dialogFired).toBe(false);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // POLISH (s014, ui-designer, iter 16) — the Send control must read as the
  // project's STANDARD button. s009 converged every action button onto the
  // outline idiom (.play-options/.copy-controls: transparent fill + currentColor
  // hairline). The Send button shipped as a one-off filled-accent button — the
  // exact one-off s009 converged away from. Pin the outline idiom so the chat
  // affordance stays consistent with the design system, not a parallel style.
  test('Send button uses the project outline-button idiom (transparent fill)', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    try {
      await openHost(host);
      const send = host.getByTestId('chat-send-btn');
      await expect(send).toBeVisible({ timeout: 10_000 });
      const bg = await send.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      // Outline idiom = transparent fill (rgba alpha 0), like the other buttons.
      expect(bg).toMatch(/rgba?\([^)]*,\s*0\s*\)|transparent/);
    } finally {
      await hostCtx.close();
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
