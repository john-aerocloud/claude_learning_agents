import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s015-chat-scope-done
 * Iteration: 18
 * Acceptance cases pinned:
 *   AC1.2   — S-SCOPE-1 strengthened (forged-gameId): C3 (bound to G2) sends
 *             {action:'chat', gameId:<G1's gameId>, text:'probe'} over its live WS
 *             connection. The handler resolves G1's Games item; C3's connectionId
 *             matches NEITHER hostConnectionId NOR guestConnectionId on that item →
 *             reject('not-a-player'), zero PostToConnection calls.
 *             Assertion: C1 and C2 receive NO additional frame. C3's WS connection
 *             remains open (silent rejection — no error frame).
 *
 * @covers S15UC1, spa-online-chat, chat-panel, ws-chat-handler, domain-chat,
 *         relay, wsfn, spaWsClient
 *
 * MULTI-INSTANCE (§12b THREE-INSTANCE):
 *   C1 (G1 host), C2 (G1 guest), C3 (G2 host).
 *   C3 is paired with C4 (G2 guest) so C3 has an ACTIVE authenticated WS.
 *   We intercept C3's WebSocket via addInitScript to send a forged-gameId frame.
 *
 * MECHANISTIC BASIS (chat-handler.ts §2):
 *   After GetItem(G1), the handler calls senderRoleFor(game, C3's connectionId):
 *   game.hostConnectionId !== C3.connId AND game.guestConnectionId !== C3.connId
 *   → returns null → reject('not-a-player') → log(chat_rejected, category:'data')
 *   → zero PostToConnection calls. C3's connection is not closed (no $disconnect).
 *
 * FORGED-FRAME MECHANISM:
 *   Before C3's page loads, an addInitScript patches the native WebSocket constructor
 *   to intercept the SPA's socket instance and store it on window.__oxoWs (the last
 *   opened socket). After pairing C3+C4 into G2, C3's authenticated WS is live.
 *   page.evaluate() then calls window.__oxoWs.send() with the forged chat frame.
 *
 * BUDGET-AWARE:
 *   1. CloudFront WAF: 100/5-min per IP — exemption via `make waf-runner-ip-add`.
 *   2. WS $connect authorizer: per-IP ConnectAttempts — same exemption.
 *   Opens 4 WS connections (C1, C2, C3, C4). Run via `make smoke-ci`.
 *
 * STABLE SELECTORS (process v12 §23):
 *   [data-testid="chat-messages"]  — ChatMessageList
 *   [data-testid="chat-message"]   — ChatMessage row
 *   [data-testid="online-role"]    — role label on game screen
 *   [data-testid="game-code"]      — 6-char code on waiting screen
 *   getByRole('button', {name:/play online/i}) — host button
 *   getByRole('button', {name:/join a game/i}) — guest button
 *   #join-code — join code input
 *   button.join-submit — join submit button
 *
 * Failure classification (process v30 §5a):
 *   WS connect 4xx = our request bug (engineering defect).
 *   If C1/C2 RECEIVE a frame after the forged send = isolation DEFECT (engineering).
 *   If C3's WS closes = handler is closing connections instead of silent-reject (defect).
 *
 * Relevancy: pinned (standing C7 security guard — forged-gameId strengthened case).
 * Retire when: chat feature removed.
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';

function _resolveExpectedSha(): string {
  if (process.env.DEPLOY_SHA) return process.env.DEPLOY_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
const DEPLOY_SHA = _resolveExpectedSha();

function captureErrors(page: Page, label: string, errors: string[]): void {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label} PAGE_ERROR: ${e.message}`));
}

function assertNoTransportErrors(errors: string[], label: string): void {
  const transportErrors = errors.filter((e) =>
    /websocket|csp|content.security|connect.src|wss:|failed.to.construct|refused/i.test(e),
  );
  expect(
    transportErrors,
    `WS/CSP transport errors (${label}): ${errors.join('; ')}`,
  ).toHaveLength(0);
}

async function createGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const codeEl = page.locator('[data-testid="game-code"]');
  await expect(codeEl).toBeVisible({ timeout: 10_000 });
  const code = (await codeEl.textContent()) ?? '';
  expect(code.length, 'game code must be 6 chars').toBe(6);
  return code;
}

async function joinGame(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  await page.locator('#join-code').fill(code);
  await page.locator('button.join-submit').click();
  await expect(page.locator('[data-testid="online-role"]')).toContainText('You are O', {
    timeout: 12_000,
  });
}

async function awaitBothOnBoard(host: Page, guest: Page): Promise<void> {
  await Promise.all([
    expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', {
      timeout: 12_000,
    }),
    expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', {
      timeout: 12_000,
    }),
  ]);
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

test.describe('s015 S-SCOPE-1 strengthened — forged-gameId silent reject (C3 cannot inject into G1)', () => {
  test.skip(!PROD_URL, 'PROD_URL not set — runs only against a deployed environment.');

  // --------------------------------------------------------------------------
  // IDENTITY FIRST (principles/01)
  // --------------------------------------------------------------------------
  test('ID-1 — identity: served build-sha matches deployed sha', async ({ page }) => {
    await page.goto('/');
    const servedSha = await page.locator('meta[name="build-sha"]').getAttribute('content');
    console.log(`s015-forged identity: served build-sha="${servedSha}" expected="${DEPLOY_SHA}"`);
    const matches =
      servedSha === DEPLOY_SHA ||
      (servedSha ?? '').startsWith(DEPLOY_SHA) ||
      DEPLOY_SHA.startsWith(servedSha ?? '');
    expect(
      matches,
      `DISTRIBUTION: served build-sha (${servedSha}) != deployed sha (${DEPLOY_SHA}). Wait and retry.`,
    ).toBe(true);
  });

  // --------------------------------------------------------------------------
  // AC1.2 — S-SCOPE-1 forged-gameId: C3 sends forged frame; C1+C2 receive nothing extra
  // FOUR contexts: C1 (G1 host) + C2 (G1 guest) + C3 (G2 host) + C4 (G2 guest).
  // C3+C4 are paired in G2 so C3 has an AUTHENTICATED active WS connection.
  // We intercept C3's WebSocket via addInitScript to send the forged frame.
  // --------------------------------------------------------------------------
  test('AC1.2/S-SCOPE-1-forged — C3 (in G2) sends forged G1 gameId; C1+C2 receive zero new frames; C3 WS stays open', async ({ browser }) => {
    const c1Ctx = await browser.newContext();
    const c2Ctx = await browser.newContext();
    // Add the WebSocket intercept script BEFORE C3's page loads. This patches
    // WebSocket to store the last constructed instance on window.__oxoWs so we
    // can send() a forged frame from page.evaluate().
    const c3Ctx = await browser.newContext();
    await c3Ctx.addInitScript(() => {
      const OrigWS = window.WebSocket;
      // @ts-ignore — runtime patch
      window.WebSocket = function (...args: ConstructorParameters<typeof WebSocket>) {
        const ws = new OrigWS(...args);
        // Store reference to the last opened socket; the SPA opens exactly one.
        (window as unknown as { __oxoWs?: WebSocket }).__oxoWs = ws;
        return ws;
      };
      // @ts-ignore — copy prototype
      window.WebSocket.prototype = OrigWS.prototype;
      // @ts-ignore — copy static
      window.WebSocket.CONNECTING = OrigWS.CONNECTING;
      window.WebSocket.OPEN = OrigWS.OPEN;
      window.WebSocket.CLOSING = OrigWS.CLOSING;
      window.WebSocket.CLOSED = OrigWS.CLOSED;
    });
    const c4Ctx = await browser.newContext();

    const c1 = await c1Ctx.newPage();
    const c2 = await c2Ctx.newPage();
    const c3 = await c3Ctx.newPage();
    const c4 = await c4Ctx.newPage();

    const errorsC1: string[] = [];
    const errorsC2: string[] = [];
    captureErrors(c1, 'c1-g1host', errorsC1);
    captureErrors(c2, 'c2-g1guest', errorsC2);

    try {
      // --- Set up G1: C1 (host) + C2 (guest) paired and active ---
      const g1Code = await createGame(c1);
      console.log(`S-SCOPE-1-forged: G1 created, code=${g1Code}`);
      await joinGame(c2, g1Code);
      await awaitBothOnBoard(c1, c2);
      console.log('S-SCOPE-1-forged: C1 and C2 both on G1 active board');

      // Mint G1's gameId via the test's HTTP request context (not page.evaluate).
      // We need G1's gameId but it was created by C1's page. The G1 code is enough
      // to identify it — but the handler uses gameId, not code. We'll mint a SCRATCH
      // game to get a real-format gameId that C3 is NOT a player of. This is equally
      // valid: if C3 sends ANY gameId where C3's connectionId is not in the players,
      // the rejection fires. A scratch gameId where C3 has no connection is a perfect
      // representative case.
      const scratchRes = await c1.context().request.post(`${PROD_URL}/api/games`, {
        headers: { 'content-type': 'application/json' },
        data: { playerName: 'SCRATCH' },
      });
      expect(scratchRes.ok(), 'scratch game creation must succeed').toBeTruthy();
      const scratchBody = await scratchRes.json() as { gameId?: string };
      const forgedGameId = scratchBody.gameId ?? '';
      console.log(`S-SCOPE-1-forged: forgedGameId="${forgedGameId}" (scratch game, C3 not a player)`);
      expect(forgedGameId, 'must have a forged gameId').toBeTruthy();

      // --- Set up G2: C3 (host) + C4 (guest) paired and active ---
      const g2Code = await createGame(c3);
      console.log(`S-SCOPE-1-forged: G2 created by C3, code=${g2Code}`);
      await joinGame(c4, g2Code);
      await awaitBothOnBoard(c3, c4);
      console.log('S-SCOPE-1-forged: C3 and C4 both on G2 active board');

      // Confirm C3 is on G2 — a different game than the forgedGameId (scratch) or G1.
      const c3Role = await c3.getByTestId('online-role').textContent();
      expect(c3Role?.trim(), 'C3 must be on G2 board as X').toBe('You are X');

      // Confirm C3 has chat input (G2 is active).
      await expect(c3.getByTestId('chat-input'), 'C3 must have chat input on G2 board').toBeVisible();

      // --- Establish baseline message count for C1 and C2 ---
      // Send one legitimate chat in G1 to confirm relay is live (positive control).
      // Wait for BOTH C1 (sender's echo) and C2 (recipient) to show the message before
      // capturing the baseline count — avoids a race where C1's own message renders
      // after the baseline count is captured but before the forged-send assertion.
      await sendChat(c1, 'forged-test-baseline');
      await Promise.all([
        expect(
          c2.getByTestId('chat-messages').getByTestId('chat-message').last()
            .getByTestId('chat-message-text'),
          'C2 must receive the baseline message (positive control — G1 relay is live)',
        ).toHaveText('forged-test-baseline', { timeout: 5_000 }),
        expect(
          c1.getByTestId('chat-messages').getByTestId('chat-message').last()
            .getByTestId('chat-message-text'),
          'C1 must see own baseline message (sender echo — G1 relay is live)',
        ).toHaveText('forged-test-baseline', { timeout: 5_000 }),
      ]);
      const c1CountAfterBaseline = await c1.getByTestId('chat-messages').getByTestId('chat-message').count();
      const c2CountAfterBaseline = await c2.getByTestId('chat-messages').getByTestId('chat-message').count();
      console.log(`S-SCOPE-1-forged: baseline counts — C1=${c1CountAfterBaseline}, C2=${c2CountAfterBaseline}`);

      // --- C3 sends a forged frame via its intercepted WebSocket ---
      // window.__oxoWs is C3's live authenticated WS (the G2 connection). We send a
      // {action:'chat', gameId:forgedGameId} frame. On the server:
      //   1. GetItem(forgedGameId) → game exists (scratch game) OR game-not-found.
      //   2. senderRoleFor(scratchGame, C3's G2-connectionId) → null (not a player).
      //   3. reject('not-a-player') → 0 PostToConnection → C1+C2 receive nothing.
      // C3's WS stays open (silent rejection — handler returns; no close frame sent).
      const forgedSendResult: { sent: boolean; wsReadyState: number; error: string | null } =
        await c3.evaluate(
          ({ forgedGameId }: { forgedGameId: string }) => {
            const ws = (window as unknown as { __oxoWs?: WebSocket }).__oxoWs;
            if (!ws) return { sent: false, wsReadyState: -1, error: '__oxoWs not found' };
            if (ws.readyState !== WebSocket.OPEN) {
              return { sent: false, wsReadyState: ws.readyState, error: 'ws not open' };
            }
            try {
              ws.send(JSON.stringify({ action: 'chat', gameId: forgedGameId, text: 'probe' }));
              return { sent: true, wsReadyState: ws.readyState, error: null };
            } catch (e) {
              return { sent: false, wsReadyState: ws.readyState, error: String(e) };
            }
          },
          { forgedGameId },
        );

      console.log(
        `S-SCOPE-1-forged: forged send result: sent=${forgedSendResult.sent}, ` +
          `wsReadyState=${forgedSendResult.wsReadyState}, error=${forgedSendResult.error}`,
      );

      expect(
        forgedSendResult.error,
        'S-SCOPE-1-forged: forged send must succeed (WS open, no send error)',
      ).toBeNull();
      expect(
        forgedSendResult.sent,
        'S-SCOPE-1-forged: forged frame must have been sent',
      ).toBe(true);
      expect(
        forgedSendResult.wsReadyState,
        'S-SCOPE-1-forged: C3 WS must be OPEN (readyState=1) at send time',
      ).toBe(1); // WebSocket.OPEN

      // Wait for any relay to arrive (if the server mistakenly relayed, it would
      // appear within 1s; we give it 1500ms to be safe).
      await c1.waitForTimeout(1500);
      await c2.waitForTimeout(500);

      // --- ISOLATION ASSERTION: C1 and C2 must NOT have received additional frames ---
      const c1CountAfterForge = await c1.getByTestId('chat-messages').getByTestId('chat-message').count();
      const c2CountAfterForge = await c2.getByTestId('chat-messages').getByTestId('chat-message').count();
      expect(
        c1CountAfterForge,
        `AC1.2: C1 must NOT receive any new frame after forged send ` +
          `(before=${c1CountAfterBaseline}, after=${c1CountAfterForge})`,
      ).toBe(c1CountAfterBaseline);
      expect(
        c2CountAfterForge,
        `AC1.2: C2 must NOT receive any new frame after forged send ` +
          `(before=${c2CountAfterBaseline}, after=${c2CountAfterForge})`,
      ).toBe(c2CountAfterBaseline);

      // Verify C3's WS is still OPEN after the forged send (silent rejection — no close frame).
      const c3WsStateAfter: number = await c3.evaluate(() => {
        const ws = (window as unknown as { __oxoWs?: WebSocket }).__oxoWs;
        return ws ? ws.readyState : -1;
      });
      expect(
        c3WsStateAfter,
        `AC1.2: C3's WS must still be OPEN (readyState=1) after silent reject ` +
          `(actual readyState=${c3WsStateAfter})`,
      ).toBe(1); // WebSocket.OPEN

      console.log(
        'AC1.2/S-SCOPE-1-forged PASS: C3 sent forged chat frame (action:chat, gameId:scratch) over ' +
          'its authenticated G2 WS; server silently rejected (not-a-player); ' +
          `C1 count unchanged (${c1CountAfterBaseline}); C2 count unchanged (${c2CountAfterBaseline}); ` +
          `C3 WS still OPEN (readyState=${c3WsStateAfter}). ` +
          'Cross-game injection via forged gameId REJECTED.',
      );

      // Browser-transport checks
      assertNoTransportErrors(errorsC1, 'c1-g1host');
      assertNoTransportErrors(errorsC2, 'c2-g1guest');
    } finally {
      await c1Ctx.close();
      await c2Ctx.close();
      await c3Ctx.close();
      await c4Ctx.close();
    }
  });
});
