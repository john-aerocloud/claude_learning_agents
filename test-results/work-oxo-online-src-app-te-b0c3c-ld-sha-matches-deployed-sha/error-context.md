# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work/oxo-online/src/app/tests/smoke/slice015-s-scope-1-forged.spec.ts >> s015 S-SCOPE-1 strengthened — forged-gameId silent reject (C3 cannot inject into G1) >> ID-1 — identity: served build-sha matches deployed sha
- Location: work/oxo-online/src/app/tests/smoke/slice015-s-scope-1-forged.spec.ts:134:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
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
  91  |   await page.goto('/');
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
> 135 |     await page.goto('/');
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
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
  192 |       const g1Code = await createGame(c1);
  193 |       console.log(`S-SCOPE-1-forged: G1 created, code=${g1Code}`);
  194 |       await joinGame(c2, g1Code);
  195 |       await awaitBothOnBoard(c1, c2);
  196 |       console.log('S-SCOPE-1-forged: C1 and C2 both on G1 active board');
  197 | 
  198 |       // Mint G1's gameId via the test's HTTP request context (not page.evaluate).
  199 |       // We need G1's gameId but it was created by C1's page. The G1 code is enough
  200 |       // to identify it — but the handler uses gameId, not code. We'll mint a SCRATCH
  201 |       // game to get a real-format gameId that C3 is NOT a player of. This is equally
  202 |       // valid: if C3 sends ANY gameId where C3's connectionId is not in the players,
  203 |       // the rejection fires. A scratch gameId where C3 has no connection is a perfect
  204 |       // representative case.
  205 |       const scratchRes = await c1.context().request.post(`${PROD_URL}/api/games`, {
  206 |         headers: { 'content-type': 'application/json' },
  207 |         data: { playerName: 'SCRATCH' },
  208 |       });
  209 |       expect(scratchRes.ok(), 'scratch game creation must succeed').toBeTruthy();
  210 |       const scratchBody = await scratchRes.json() as { gameId?: string };
  211 |       const forgedGameId = scratchBody.gameId ?? '';
  212 |       console.log(`S-SCOPE-1-forged: forgedGameId="${forgedGameId}" (scratch game, C3 not a player)`);
  213 |       expect(forgedGameId, 'must have a forged gameId').toBeTruthy();
  214 | 
  215 |       // --- Set up G2: C3 (host) + C4 (guest) paired and active ---
  216 |       const g2Code = await createGame(c3);
  217 |       console.log(`S-SCOPE-1-forged: G2 created by C3, code=${g2Code}`);
  218 |       await joinGame(c4, g2Code);
  219 |       await awaitBothOnBoard(c3, c4);
  220 |       console.log('S-SCOPE-1-forged: C3 and C4 both on G2 active board');
  221 | 
  222 |       // Confirm C3 is on G2 — a different game than the forgedGameId (scratch) or G1.
  223 |       const c3Role = await c3.getByTestId('online-role').textContent();
  224 |       expect(c3Role?.trim(), 'C3 must be on G2 board as X').toBe('You are X');
  225 | 
  226 |       // Confirm C3 has chat input (G2 is active).
  227 |       await expect(c3.getByTestId('chat-input'), 'C3 must have chat input on G2 board').toBeVisible();
  228 | 
  229 |       // --- Establish baseline message count for C1 and C2 ---
  230 |       // Send one legitimate chat in G1 to confirm relay is live (positive control).
  231 |       await sendChat(c1, 'forged-test-baseline');
  232 |       await expect(
  233 |         c2.getByTestId('chat-messages').getByTestId('chat-message').last()
  234 |           .getByTestId('chat-message-text'),
  235 |         'C2 must receive the baseline message (positive control — G1 relay is live)',
```