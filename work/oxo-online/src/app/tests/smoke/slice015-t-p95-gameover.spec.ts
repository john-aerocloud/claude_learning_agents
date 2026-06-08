import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s015-chat-scope-done
 * Iteration: 18
 * Acceptance cases pinned:
 *   AC1.3   — T-P95-1: formal p95 latency proof. >=5 chat sends A→B; measure
 *             A-types-to-B-sees latency for each; assert p95 <= 1000ms. Prod
 *             timing, real network (eu-west-2 @connections relay). Formalises the
 *             s014 UC3 single informal sample (199ms).
 *   AC1.4   — T-GAMEOVER-1: after a game reaches game-over (a player wins or draw),
 *             the chat input and chat panel are absent from BOTH players' screens.
 *             The ChatPanel (including ChatInput) unmounts when `result` is set
 *             (GameRoot.tsx: `{onlineGame.result === undefined && <ChatPanel .../>}`).
 *             If chat-input IS present post-game-over: DEFECT against s014.
 *
 * @covers S15UC1, spa-online-chat, chat-panel, chat-input, ws-chat-handler,
 *         domain-chat, relay, wsfn, spaWsClient, spa-online-move
 *
 * MULTI-INSTANCE (§12b TWO-INSTANCE):
 *   Host (X) + Guest (O) — two real browser contexts.
 *   Both state machines driven: host sends chat; guest receives; latency measured.
 *   Both reach game-over; both assert chat absent.
 *
 * IDENTITY-BEFORE-BEHAVIOUR (principles/01): first test asserts build-sha match.
 *
 * BROWSER-TRANSPORT (process v27): two-browser test FAILS if CSP connect-src
 *   blocks wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com.
 *
 * BUDGET-AWARE:
 *   1. CloudFront WAF: 100/5-min per IP — exemption via `make waf-runner-ip-add`.
 *   2. WS $connect authorizer: per-IP ConnectAttempts — same exemption.
 *   Opens 2 WS connections. Run via `make smoke-ci`.
 *
 * P95 METHODOLOGY:
 *   - Timer starts at page.evaluate() timestamp BEFORE sendChat() dispatches the frame.
 *   - Timer stops when Playwright's locator detects the new message in the opponent's
 *     chat-messages list (waitFor / expect with timeout).
 *   - We collect SAMPLES_REQUIRED (5) samples and compute p95 (the 95th percentile =
 *     the ceil(0.95 * N)-th sorted value for N samples).
 *   - All samples from a SINGLE active game (5 sends < 200-char limit each).
 *   - Network latency from the test runner machine to prod WS in eu-west-2 IS included —
 *     this is the realistic user-observed round-trip.
 *
 * STABLE SELECTORS (process v12 §23):
 *   [data-testid="chat-input"]        — chat text field
 *   [data-testid="chat-send-btn"]     — Send button
 *   [data-testid="chat-panel"]        — ChatPanel container
 *   [data-testid="chat-messages"]     — message list
 *   [data-testid="chat-message"]      — message row
 *   [data-testid="chat-message-text"] — message text
 *   [data-testid="online-role"]       — role label
 *   [data-testid="online-result"]     — result text post game-over
 *   [data-testid="game-code"]         — 6-char code on waiting screen
 *   [aria-label="cell N"]             — board cell N
 *   getByRole('button', {name:/play online/i})
 *   getByRole('button', {name:/join a game/i})
 *   #join-code — join code input
 *   button.join-submit — join submit button
 *
 * T-GAMEOVER-1 CODE BASIS (GameRoot.tsx lines 521-529):
 *   {onlineGame.result === undefined && (
 *     <ChatPanel messages={chatMessages} selfRole={onlineRole} onSend={sendChat} />
 *   )}
 *   When game-over sets result, the entire ChatPanel unmounts → chat-input,
 *   chat-send-btn, and chat-panel are ALL absent (count=0).
 *
 * Failure classification (process v30 §5a):
 *   WS connect 4xx = our request bug (engineering defect).
 *   p95 > 1000ms = relay latency DEFECT (engineering).
 *   chat-input present post-game-over = DEFECT against s014 (engineering).
 *
 * Relevancy: pinned (standing C7 done-condition — formal p95 is the done-condition
 *   text, game-over chat-absent is the last unasserted production guard).
 * Retire when: chat feature removed.
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
const SAMPLES_REQUIRED = 5;
const P95_LIMIT_MS = 1000;

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

/** p95 of an array of numbers (ceil(0.95 * N)-th sorted value). */
function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
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

/** Click board cell N on page. */
async function clickCell(page: Page, n: number): Promise<void> {
  await page.locator(`[aria-label="cell ${n}"]`).click();
}

test.describe('s015 T-P95-1 + T-GAMEOVER-1 — formal p95 latency + chat absent post game-over', () => {
  test.skip(!PROD_URL, 'PROD_URL not set — runs only against a deployed environment.');

  // --------------------------------------------------------------------------
  // IDENTITY FIRST (principles/01)
  // --------------------------------------------------------------------------
  test('ID-1 — identity: served build-sha matches deployed sha', async ({ page }) => {
    await page.goto('/');
    const servedSha = await page.locator('meta[name="build-sha"]').getAttribute('content');
    console.log(`s015-p95 identity: served build-sha="${servedSha}" expected="${DEPLOY_SHA}"`);
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
  // AC1.3 — T-P95-1: formal p95 latency: >=5 sends, p95 <=1000ms, prod timing
  // --------------------------------------------------------------------------
  test(`AC1.3/T-P95-1 — formal p95: >= ${SAMPLES_REQUIRED} sends; p95 <= ${P95_LIMIT_MS}ms (prod)`, async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errorsHost: string[] = [];
    const errorsGuest: string[] = [];
    captureErrors(host, 'host-p95', errorsHost);
    captureErrors(guest, 'guest-p95', errorsGuest);

    try {
      const code = await createGame(host);
      console.log(`T-P95-1: game created, code=${code}`);
      await joinGame(guest, code);
      await awaitBothOnBoard(host, guest);
      console.log('T-P95-1: both players on active board');

      const latencies: number[] = [];
      let prevGuestCount = 0;

      for (let i = 0; i < SAMPLES_REQUIRED; i++) {
        const msgText = `p95-sample-${i}`;
        const expectedGuestCount = prevGuestCount + 1;

        // Timer starts immediately before the SPA dispatches the frame.
        const t0 = Date.now();

        // Send via chat input + Enter key.
        const chatInput = host.getByTestId('chat-input');
        await chatInput.click();
        await chatInput.fill(msgText);
        await chatInput.press('Enter');

        // Timer stops when guest's chat-messages list has expectedGuestCount rows.
        await expect(
          guest.getByTestId('chat-messages').getByTestId('chat-message'),
          `T-P95-1 sample ${i}: guest must receive message "${msgText}"`,
        ).toHaveCount(expectedGuestCount, { timeout: 5_000 });

        const latencyMs = Date.now() - t0;
        latencies.push(latencyMs);
        prevGuestCount = expectedGuestCount;

        console.log(`T-P95-1 sample ${i}: msg="${msgText}" latency=${latencyMs}ms`);
      }

      // Compute p95 and assert.
      const p95Value = p95(latencies);
      const minLatency = Math.min(...latencies);
      const maxLatency = Math.max(...latencies);
      const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

      console.log(
        `T-P95-1 latency summary: samples=${latencies.length}; ` +
          `values=[${latencies.join(', ')}]ms; ` +
          `min=${minLatency}ms; max=${maxLatency}ms; mean=${mean}ms; p95=${p95Value}ms`,
      );

      expect(
        p95Value,
        `T-P95-1/AC1.3: p95 latency must be <= ${P95_LIMIT_MS}ms. ` +
          `Actual p95=${p95Value}ms over ${latencies.length} samples: [${latencies.join(', ')}]ms. ` +
          `(min=${minLatency}, max=${maxLatency}, mean=${mean})`,
      ).toBeLessThanOrEqual(P95_LIMIT_MS);

      console.log(
        `AC1.3/T-P95-1 PASS: p95=${p95Value}ms <= ${P95_LIMIT_MS}ms ` +
          `(${latencies.length} samples; formal p95 prod latency CONFIRMED)`,
      );

      // Browser-transport checks.
      assertNoTransportErrors(errorsHost, 'host-p95');
      assertNoTransportErrors(errorsGuest, 'guest-p95');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // --------------------------------------------------------------------------
  // AC1.4 — T-GAMEOVER-1: chat input + panel absent on BOTH screens post game-over
  // Play a game to a win (X wins by filling row 0: cells 0, 1, 2 for X;
  // cells 3, 4 for O = a standard alternating game X:0 O:3 X:1 O:4 X:2 → X wins).
  // --------------------------------------------------------------------------
  test('AC1.4/T-GAMEOVER-1 — chat input + panel absent on both screens after game-over', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errorsHost: string[] = [];
    const errorsGuest: string[] = [];
    captureErrors(host, 'host-gameover', errorsHost);
    captureErrors(guest, 'guest-gameover', errorsGuest);

    try {
      const code = await createGame(host);
      console.log(`T-GAMEOVER-1: game created, code=${code}`);
      await joinGame(guest, code);
      await awaitBothOnBoard(host, guest);
      console.log('T-GAMEOVER-1: both players on active board');

      // Confirm chat IS present during active game (pre-condition).
      await expect(
        host.getByTestId('chat-input'),
        'T-GAMEOVER-1 pre-condition: chat-input must be present during active game (host)',
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        guest.getByTestId('chat-input'),
        'T-GAMEOVER-1 pre-condition: chat-input must be present during active game (guest)',
      ).toBeVisible({ timeout: 5_000 });
      console.log('T-GAMEOVER-1: chat-input present during active game — pre-condition CONFIRMED');

      // Play to X wins (row 0): X plays cells 0,1,2; O plays cells 3,4.
      // Move sequence: X:0, O:3, X:1, O:4, X:2 → game-over (X wins).
      // After each X move, wait for a board-update to be reflected before the O move.
      await clickCell(host, 0); // X plays cell 0
      await expect(
        guest.locator('[aria-label="cell 3"]'),
        'T-GAMEOVER-1: waiting for guest turn (O:3)',
      ).toBeEnabled({ timeout: 5_000 });
      await clickCell(guest, 3); // O plays cell 3

      await expect(
        host.locator('[aria-label="cell 1"]'),
        'T-GAMEOVER-1: waiting for host turn (X:1)',
      ).toBeEnabled({ timeout: 5_000 });
      await clickCell(host, 1); // X plays cell 1

      await expect(
        guest.locator('[aria-label="cell 4"]'),
        'T-GAMEOVER-1: waiting for guest turn (O:4)',
      ).toBeEnabled({ timeout: 5_000 });
      await clickCell(guest, 4); // O plays cell 4

      await expect(
        host.locator('[aria-label="cell 2"]'),
        'T-GAMEOVER-1: waiting for host turn (X:2 = win)',
      ).toBeEnabled({ timeout: 5_000 });
      await clickCell(host, 2); // X plays cell 2 → X wins

      // Wait for game-over frame to be processed by both players.
      await Promise.all([
        expect(host.getByTestId('online-result'), 'T-GAMEOVER-1: host must see result').toBeVisible({ timeout: 8_000 }),
        expect(guest.getByTestId('online-result'), 'T-GAMEOVER-1: guest must see result').toBeVisible({ timeout: 8_000 }),
      ]);

      const hostResult = await host.getByTestId('online-result').textContent();
      const guestResult = await guest.getByTestId('online-result').textContent();
      console.log(`T-GAMEOVER-1: game-over — host sees "${hostResult}"; guest sees "${guestResult}"`);
      expect(hostResult?.trim(), 'T-GAMEOVER-1: host must see "X wins" result').toBe('X wins');
      expect(guestResult?.trim(), 'T-GAMEOVER-1: guest must see "X wins" result').toBe('X wins');

      // --- CORE ASSERTION: chat-input, chat-send-btn, chat-panel ALL absent ---
      await expect(
        host.getByTestId('chat-input'),
        'AC1.4/T-GAMEOVER-1: chat-input must be ABSENT on host result screen',
      ).toHaveCount(0);
      await expect(
        host.getByTestId('chat-send-btn'),
        'AC1.4/T-GAMEOVER-1: chat-send-btn must be ABSENT on host result screen',
      ).toHaveCount(0);
      await expect(
        host.getByTestId('chat-panel'),
        'AC1.4/T-GAMEOVER-1: chat-panel must be ABSENT on host result screen',
      ).toHaveCount(0);

      await expect(
        guest.getByTestId('chat-input'),
        'AC1.4/T-GAMEOVER-1: chat-input must be ABSENT on guest result screen',
      ).toHaveCount(0);
      await expect(
        guest.getByTestId('chat-send-btn'),
        'AC1.4/T-GAMEOVER-1: chat-send-btn must be ABSENT on guest result screen',
      ).toHaveCount(0);
      await expect(
        guest.getByTestId('chat-panel'),
        'AC1.4/T-GAMEOVER-1: chat-panel must be ABSENT on guest result screen',
      ).toHaveCount(0);

      console.log(
        'AC1.4/T-GAMEOVER-1 PASS: game-over reached; chat-input, chat-send-btn, chat-panel ' +
          'all absent from BOTH players\' result screens. ' +
          'ChatPanel unmount on result===set CONFIRMED in prod.',
      );

      // Browser-transport checks.
      assertNoTransportErrors(errorsHost, 'host-gameover');
      assertNoTransportErrors(errorsGuest, 'guest-gameover');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
