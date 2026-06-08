# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work/oxo-online/src/app/tests/smoke/slice015-s-scope-1-forged.spec.ts >> s015 S-SCOPE-1 strengthened — forged-gameId silent reject (C3 cannot inject into G1) >> AC1.2/S-SCOPE-1-forged — C3 (in G2) sends forged G1 gameId; C1+C2 receive zero new frames; C3 WS stays open
- Location: work/oxo-online/src/app/tests/smoke/slice015-s-scope-1-forged.spec.ts:154:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | import { execFileSync } from 'node:child_process';
  3   | 
  4   | /**
  5   |  * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
  6   |  * Slice: s015-chat-scope-done
  7   |  * Iteration: 18
  8   |  * Acceptance cases pinned:
  9   |  *   AC1.2   — S-SCOPE-1 strengthened (forged-gameId): C3 (bound to G2) sends
  10  |  *             {action:'chat', gameId:<G1's gameId>, text:'probe'} over its live WS
  11  |  *             connection. The handler resolves G1's Games item; C3's connectionId
  12  |  *             matches NEITHER hostConnectionId NOR guestConnectionId on that item →
  13  |  *             reject('not-a-player'), zero PostToConnection calls.
  14  |  *             Assertion: C1 and C2 receive NO additional frame. C3's WS connection
  15  |  *             remains open (silent rejection — no error frame).
  16  |  *
  17  |  * @covers S15UC1, spa-online-chat, chat-panel, ws-chat-handler, domain-chat,
  18  |  *         relay, wsfn, spaWsClient
  19  |  *
  20  |  * MULTI-INSTANCE (§12b THREE-INSTANCE):
  21  |  *   C1 (G1 host), C2 (G1 guest), C3 (G2 host).
  22  |  *   C3 is paired with C4 (G2 guest) so C3 has an ACTIVE authenticated WS.
  23  |  *   We intercept C3's WebSocket via addInitScript to send a forged-gameId frame.
  24  |  *
  25  |  * MECHANISTIC BASIS (chat-handler.ts §2):
  26  |  *   After GetItem(G1), the handler calls senderRoleFor(game, C3's connectionId):
  27  |  *   game.hostConnectionId !== C3.connId AND game.guestConnectionId !== C3.connId
  28  |  *   → returns null → reject('not-a-player') → log(chat_rejected, category:'data')
  29  |  *   → zero PostToConnection calls. C3's connection is not closed (no $disconnect).
  30  |  *
  31  |  * FORGED-FRAME MECHANISM:
  32  |  *   Before C3's page loads, an addInitScript patches the native WebSocket constructor
  33  |  *   to intercept the SPA's socket instance and store it on window.__oxoWs (the last
  34  |  *   opened socket). After pairing C3+C4 into G2, C3's authenticated WS is live.
  35  |  *   page.evaluate() then calls window.__oxoWs.send() with the forged chat frame.
  36  |  *
  37  |  * BUDGET-AWARE:
  38  |  *   1. CloudFront WAF: 100/5-min per IP — exemption via `make waf-runner-ip-add`.
  39  |  *   2. WS $connect authorizer: per-IP ConnectAttempts — same exemption.
  40  |  *   Opens 4 WS connections (C1, C2, C3, C4). Run via `make smoke-ci`.
  41  |  *
  42  |  * STABLE SELECTORS (process v12 §23):
  43  |  *   [data-testid="chat-messages"]  — ChatMessageList
  44  |  *   [data-testid="chat-message"]   — ChatMessage row
  45  |  *   [data-testid="online-role"]    — role label on game screen
  46  |  *   [data-testid="game-code"]      — 6-char code on waiting screen
  47  |  *   getByRole('button', {name:/play online/i}) — host button
  48  |  *   getByRole('button', {name:/join a game/i}) — guest button
  49  |  *   #join-code — join code input
  50  |  *   button.join-submit — join submit button
  51  |  *
  52  |  * Failure classification (process v30 §5a):
  53  |  *   WS connect 4xx = our request bug (engineering defect).
  54  |  *   If C1/C2 RECEIVE a frame after the forged send = isolation DEFECT (engineering).
  55  |  *   If C3's WS closes = handler is closing connections instead of silent-reject (defect).
  56  |  *
  57  |  * Relevancy: pinned (standing C7 security guard — forged-gameId strengthened case).
  58  |  * Retire when: chat feature removed.
  59  |  */
  60  | 
  61  | const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
  62  | 
  63  | function _resolveExpectedSha(): string {
  64  |   if (process.env.DEPLOY_SHA) return process.env.DEPLOY_SHA;
  65  |   try {
  66  |     return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  67  |   } catch {
  68  |     return 'unknown';
  69  |   }
  70  | }
  71  | const DEPLOY_SHA = _resolveExpectedSha();
  72  | 
  73  | function captureErrors(page: Page, label: string, errors: string[]): void {
  74  |   page.on('console', (m) => {
  75  |     if (m.type() === 'error') errors.push(`${label}: ${m.text()}`);
  76  |   });
  77  |   page.on('pageerror', (e) => errors.push(`${label} PAGE_ERROR: ${e.message}`));
  78  | }
  79  | 
  80  | function assertNoTransportErrors(errors: string[], label: string): void {
  81  |   const transportErrors = errors.filter((e) =>
  82  |     /websocket|csp|content.security|connect.src|wss:|failed.to.construct|refused/i.test(e),
  83  |   );
  84  |   expect(
  85  |     transportErrors,
  86  |     `WS/CSP transport errors (${label}): ${errors.join('; ')}`,
  87  |   ).toHaveLength(0);
  88  | }
  89  | 
  90  | async function createGame(page: Page): Promise<string> {
> 91  |   await page.goto('/');
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  92  |   await page.getByRole('button', { name: /play online/i, exact: false }).click();
  93  |   const codeEl = page.locator('[data-testid="game-code"]');
  94  |   await expect(codeEl).toBeVisible({ timeout: 10_000 });
  95  |   const code = (await codeEl.textContent()) ?? '';
  96  |   expect(code.length, 'game code must be 6 chars').toBe(6);
  97  |   return code;
  98  | }
  99  | 
  100 | async function joinGame(page: Page, code: string): Promise<void> {
  101 |   await page.goto('/');
  102 |   await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  103 |   await page.locator('#join-code').fill(code);
  104 |   await page.locator('button.join-submit').click();
  105 |   await expect(page.locator('[data-testid="online-role"]')).toContainText('You are O', {
  106 |     timeout: 12_000,
  107 |   });
  108 | }
  109 | 
  110 | async function awaitBothOnBoard(host: Page, guest: Page): Promise<void> {
  111 |   await Promise.all([
  112 |     expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', {
  113 |       timeout: 12_000,
  114 |     }),
  115 |     expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', {
  116 |       timeout: 12_000,
  117 |     }),
  118 |   ]);
  119 | }
  120 | 
  121 | async function sendChat(page: Page, text: string): Promise<void> {
  122 |   const input = page.getByTestId('chat-input');
  123 |   await input.click();
  124 |   await input.fill(text);
  125 |   await input.press('Enter');
  126 | }
  127 | 
  128 | test.describe('s015 S-SCOPE-1 strengthened — forged-gameId silent reject (C3 cannot inject into G1)', () => {
  129 |   test.skip(!PROD_URL, 'PROD_URL not set — runs only against a deployed environment.');
  130 | 
  131 |   // --------------------------------------------------------------------------
  132 |   // IDENTITY FIRST (principles/01)
  133 |   // --------------------------------------------------------------------------
  134 |   test('ID-1 — identity: served build-sha matches deployed sha', async ({ page }) => {
  135 |     await page.goto('/');
  136 |     const servedSha = await page.locator('meta[name="build-sha"]').getAttribute('content');
  137 |     console.log(`s015-forged identity: served build-sha="${servedSha}" expected="${DEPLOY_SHA}"`);
  138 |     const matches =
  139 |       servedSha === DEPLOY_SHA ||
  140 |       (servedSha ?? '').startsWith(DEPLOY_SHA) ||
  141 |       DEPLOY_SHA.startsWith(servedSha ?? '');
  142 |     expect(
  143 |       matches,
  144 |       `DISTRIBUTION: served build-sha (${servedSha}) != deployed sha (${DEPLOY_SHA}). Wait and retry.`,
  145 |     ).toBe(true);
  146 |   });
  147 | 
  148 |   // --------------------------------------------------------------------------
  149 |   // AC1.2 — S-SCOPE-1 forged-gameId: C3 sends forged frame; C1+C2 receive nothing extra
  150 |   // FOUR contexts: C1 (G1 host) + C2 (G1 guest) + C3 (G2 host) + C4 (G2 guest).
  151 |   // C3+C4 are paired in G2 so C3 has an AUTHENTICATED active WS connection.
  152 |   // We intercept C3's WebSocket via addInitScript to send the forged frame.
  153 |   // --------------------------------------------------------------------------
  154 |   test('AC1.2/S-SCOPE-1-forged — C3 (in G2) sends forged G1 gameId; C1+C2 receive zero new frames; C3 WS stays open', async ({ browser }) => {
  155 |     const c1Ctx = await browser.newContext();
  156 |     const c2Ctx = await browser.newContext();
  157 |     // Add the WebSocket intercept script BEFORE C3's page loads. This patches
  158 |     // WebSocket to store the last constructed instance on window.__oxoWs so we
  159 |     // can send() a forged frame from page.evaluate().
  160 |     const c3Ctx = await browser.newContext();
  161 |     await c3Ctx.addInitScript(() => {
  162 |       const OrigWS = window.WebSocket;
  163 |       // @ts-ignore — runtime patch
  164 |       window.WebSocket = function (...args: ConstructorParameters<typeof WebSocket>) {
  165 |         const ws = new OrigWS(...args);
  166 |         // Store reference to the last opened socket; the SPA opens exactly one.
  167 |         (window as unknown as { __oxoWs?: WebSocket }).__oxoWs = ws;
  168 |         return ws;
  169 |       };
  170 |       // @ts-ignore — copy prototype
  171 |       window.WebSocket.prototype = OrigWS.prototype;
  172 |       // @ts-ignore — copy static
  173 |       window.WebSocket.CONNECTING = OrigWS.CONNECTING;
  174 |       window.WebSocket.OPEN = OrigWS.OPEN;
  175 |       window.WebSocket.CLOSING = OrigWS.CLOSING;
  176 |       window.WebSocket.CLOSED = OrigWS.CLOSED;
  177 |     });
  178 |     const c4Ctx = await browser.newContext();
  179 | 
  180 |     const c1 = await c1Ctx.newPage();
  181 |     const c2 = await c2Ctx.newPage();
  182 |     const c3 = await c3Ctx.newPage();
  183 |     const c4 = await c4Ctx.newPage();
  184 | 
  185 |     const errorsC1: string[] = [];
  186 |     const errorsC2: string[] = [];
  187 |     captureErrors(c1, 'c1-g1host', errorsC1);
  188 |     captureErrors(c2, 'c2-g1guest', errorsC2);
  189 | 
  190 |     try {
  191 |       // --- Set up G1: C1 (host) + C2 (guest) paired and active ---
```