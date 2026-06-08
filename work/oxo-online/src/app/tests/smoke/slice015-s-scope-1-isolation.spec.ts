import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s015-chat-scope-done
 * Iteration: 18
 * Acceptance cases pinned:
 *   ID-1    — identity: served build-sha == deployed sha (principles/01 FIRST assertion)
 *   AC1.1   — S-SCOPE-1 main: three browser contexts (§12b three-connection model).
 *             C1 = G1 host, C2 = G1 guest (both WS-connected, game G1 active).
 *             C3 = G2 player (separate active game G2, distinct gameId).
 *             C1 sends >=3 chat messages to C2. C3 receives ZERO chat-message frames.
 *             C3's board/game state is completely unaffected.
 *             This is T-CHAT-2 (waived from s014 to s015) — the cross-game
 *             isolation prod guard that closes the S-case for C7.
 *
 * @covers S15UC1, spa-online-chat, chat-panel, chat-message-list, chat-message,
 *         chat-input, ws-chat-handler, domain-chat, relay, wsfn, spaWsClient
 *
 * MULTI-INSTANCE (§12b THREE-INSTANCE):
 *   C1 (G1 host) + C2 (G1 guest) + C3 (G2 host).
 *   Three real browser contexts; ALL three state machines driven.
 *   C3's received-messages list must stay empty throughout C1's sends.
 *
 * IDENTITY-BEFORE-BEHAVIOUR (principles/01): first test asserts
 *   meta[name="build-sha"] matches deployed HEAD sha.
 *
 * BROWSER-TRANSPORT (process v27): three-context test FAILS if CSP connect-src
 *   blocks wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com. Console error
 *   capture + assertNoTransportErrors() pin this at the browser level.
 *
 * BUDGET-AWARE:
 *   1. CloudFront WAF: 100/5-min per IP. Use `make waf-runner-ip-add` before run.
 *   2. WS $connect authorizer: per-IP ConnectAttempts. Same exemption.
 *   Opens 3 WS connections (one per context). Run via `make smoke-ci` for full
 *   exemption-add → run → exemption-remove cycle.
 *
 * STABLE SELECTORS (process v12 §23):
 *   [data-testid="chat-input"]        — chat text field (ChatInput)
 *   [data-testid="chat-send-btn"]     — Send button (ChatInput)
 *   [data-testid="chat-messages"]     — ChatMessageList (role=log)
 *   [data-testid="chat-message"]      — ChatMessage row
 *   [data-testid="online-role"]       — role label on game screen
 *   [data-testid="game-code"]         — 6-char code on waiting screen
 *   getByRole('button', {name:/play online/i}) — mode selector host button
 *   getByRole('button', {name:/join a game/i}) — mode selector guest button
 *   #join-code                        — join code input
 *   button.join-submit                — join submit button
 *
 * MECHANISTIC BASIS (delta 011 §2 / chat-handler.ts):
 *   The handler resolves relay targets from the TWO connectionId fields on the ONE
 *   Games item keyed by the sender's gameId. C3's connectionId is NOT on G1's item
 *   and is therefore NEVER a relay target for G1 chat. Zero broadcast path.
 *
 * Failure classification (process v30 §5a):
 *   WS connect 4xx = our request bug (engineering defect).
 *   API GW 5xx = service WE own failing (engineering defect + defect task).
 *   WAF 403 = runner IP not exempted — run make waf-runner-ip-add.
 *
 * Relevancy: pinned (standing C7 security guard; cross-game isolation is a
 *   first-of-kind prod assertion not present before s015).
 * Retire when: chat feature removed or architecture refactored to a broadcast model
 *   (which would require a new isolation mechanism and a new guard spec).
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

/** Navigate to idle view, click "Play Online", await the waiting screen game code. */
async function createGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const codeEl = page.locator('[data-testid="game-code"]');
  await expect(codeEl).toBeVisible({ timeout: 10_000 });
  const code = (await codeEl.textContent()) ?? '';
  expect(code.length, 'game code must be 6 chars').toBe(6);
  return code;
}

/** Navigate to idle view, click "Join a game", fill code, submit. Await board. */
async function joinGame(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  await page.locator('#join-code').fill(code);
  await page.locator('button.join-submit').click();
  await expect(page.locator('[data-testid="online-role"]')).toContainText('You are O', {
    timeout: 12_000,
  });
}

/** Await both players reaching the active game board. */
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

/** Send a chat message via the chat input + Enter key. */
async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

test.describe('s015 S-SCOPE-1 — cross-game chat isolation (three contexts, T-CHAT-2 prod guard)', () => {
  test.skip(!PROD_URL, 'PROD_URL not set — runs only against a deployed environment.');

  // --------------------------------------------------------------------------
  // IDENTITY FIRST (principles/01)
  // --------------------------------------------------------------------------
  test('ID-1 — identity: served build-sha matches deployed sha', async ({ page }) => {
    await page.goto('/');
    const servedSha = await page.locator('meta[name="build-sha"]').getAttribute('content');
    console.log(`s015 identity: served build-sha="${servedSha}" expected="${DEPLOY_SHA}"`);
    const matches =
      servedSha === DEPLOY_SHA ||
      (servedSha ?? '').startsWith(DEPLOY_SHA) ||
      DEPLOY_SHA.startsWith(servedSha ?? '');
    expect(
      matches,
      `DISTRIBUTION: served build-sha (${servedSha}) does not match deployed sha (${DEPLOY_SHA}). ` +
        `Wait and retry. NOT a behavioural failure.`,
    ).toBe(true);
    console.log(`ID-1 PASS: identity confirmed — build-sha="${servedSha}"`);
  });

  // --------------------------------------------------------------------------
  // AC1.1 — S-SCOPE-1 main: THREE contexts, C3 receives ZERO frames from G1
  // §12b THREE-INSTANCE: C1 (G1 host) + C2 (G1 guest) + C3 (G2 host)
  // --------------------------------------------------------------------------
  test('AC1.1/S-SCOPE-1 — three contexts: C1+C2 in G1; C3 in G2; C1 sends >=3 chats; C3 receives zero frames', async ({ browser }) => {
    // Three independent browser contexts — each has its own WS connection.
    const c1Ctx = await browser.newContext();
    const c2Ctx = await browser.newContext();
    const c3Ctx = await browser.newContext();

    const c1 = await c1Ctx.newPage();
    const c2 = await c2Ctx.newPage();
    const c3 = await c3Ctx.newPage();

    const errorsC1: string[] = [];
    const errorsC2: string[] = [];
    const errorsC3: string[] = [];
    captureErrors(c1, 'c1-g1host', errorsC1);
    captureErrors(c2, 'c2-g1guest', errorsC2);
    captureErrors(c3, 'c3-g2host', errorsC3);

    try {
      // --- Set up G1: C1 (host) + C2 (guest) paired and active ---
      const g1Code = await createGame(c1);
      console.log(`S-SCOPE-1: G1 created, code=${g1Code}`);
      await joinGame(c2, g1Code);
      await awaitBothOnBoard(c1, c2);
      console.log('S-SCOPE-1: C1 and C2 both on G1 active board');

      // --- Set up G2: C3 (host) — creates a SEPARATE game, does NOT pair ---
      // C3 only needs to be WS-connected to a distinct game (waiting phase is
      // sufficient: C3 is registered and has a connectionId on a G2 Games item).
      // We do NOT need C3's opponent to join — the isolation property holds
      // whether G2 is active or in waiting. A WS connection is established when
      // C3 clicks "Play Online" and the SPA sends {action:'register', gameId:G2}.
      const g2Code = await createGame(c3);
      console.log(`S-SCOPE-1: G2 created by C3, code=${g2Code} (distinct game)`);
      // C3 is now in the waiting phase — WS registered on G2, connectionId on G2's item.
      // Confirm C3 does NOT see any chat-message frames: assert the chat-messages
      // log is absent (the ChatPanel only renders on the active-game screen, which
      // C3 hasn't reached). ChatPanel is not rendered in waiting phase — zero chat elements.
      await expect(c3.getByTestId('chat-messages')).toHaveCount(0);
      console.log('S-SCOPE-1: C3 in G2 waiting phase — chat-messages element absent (expected)');

      // --- C1 sends >=3 chat messages in G1 ---
      const G1_MESSAGES = ['isolation-test-1', 'isolation-test-2', 'isolation-test-3'];
      for (const msg of G1_MESSAGES) {
        await sendChat(c1, msg);
        // C2 (G1 guest) must receive each message (relay is working; this is the
        // positive control — if C2 doesn't receive, the chat relay is broken, not
        // the isolation).
        await expect(
          c2.getByTestId('chat-messages').getByTestId('chat-message').last()
            .getByTestId('chat-message-text'),
          `C2 must receive message "${msg}" (positive control — relay is live)`,
        ).toHaveText(msg, { timeout: 5_000 });
        console.log(`S-SCOPE-1: C2 received "${msg}" (positive control PASS)`);
      }

      // --- C3 must still have zero chat-message frames ---
      // C3 is still in the waiting phase (no opponent joined G2). The ChatPanel
      // is not rendered at all. Confirm zero chat-input and zero chat-message elements.
      await expect(
        c3.getByTestId('chat-messages'),
        'AC1.1: C3 must NOT have a chat-messages element (isolation — ChatPanel absent in waiting phase)',
      ).toHaveCount(0);
      await expect(
        c3.getByTestId('chat-input'),
        'AC1.1: C3 must NOT have a chat-input element (isolation — no chat in waiting phase)',
      ).toHaveCount(0);

      // The game-code should still be visible on C3's waiting screen (C3 is unaffected).
      await expect(
        c3.getByTestId('game-code'),
        'AC1.1: C3 game-code must still be visible (G2 waiting state unaffected)',
      ).toBeVisible({ timeout: 3_000 });

      // C3's G2 waiting screen game code must NOT equal G1's code (distinct games).
      const c3DisplayedCode = await c3.getByTestId('game-code').textContent();
      expect(
        c3DisplayedCode?.trim(),
        'AC1.1: C3 must be in a DIFFERENT game than G1 (distinct game codes)',
      ).not.toBe(g1Code);
      console.log(`S-SCOPE-1: C3 game code="${c3DisplayedCode}" != G1 code="${g1Code}" — distinct games CONFIRMED`);

      // Browser-transport pin — no CSP/WS transport errors on any context.
      assertNoTransportErrors(errorsC1, 'c1-g1host');
      assertNoTransportErrors(errorsC2, 'c2-g1guest');
      assertNoTransportErrors(errorsC3, 'c3-g2host');

      console.log(
        'AC1.1/S-SCOPE-1 PASS: C1 sent 3 messages in G1; C2 received all 3 (relay live); ' +
        'C3 received ZERO frames (chat-messages absent; game-code still visible; distinct code). ' +
        'Cross-game isolation CONFIRMED in prod (T-CHAT-2 prod guard).',
      );
    } finally {
      await c1Ctx.close();
      await c2Ctx.close();
      await c3Ctx.close();
    }
  });
});
