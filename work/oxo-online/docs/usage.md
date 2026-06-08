# oxo-online — Usage

## What is this?

oxo-online is a noughts and crosses (tic-tac-toe) game that runs in a web
browser. You can play locally against another person on the same device, play
solo against an unbeatable computer opponent, or play a complete online game
against a friend in a separate browser in real time. The full online flow is
live: the host enters an arcade name (optional — defaults to "AAA"), creates a
game and shares it using either "Copy code" (the 6 characters, for a friend who
types) or "Copy link" (the /join/ URL, for one-click join); the friend opens the
URL and joins in one click; moves relay between browsers via a server-authoritative
Lambda; the server detects wins and draws; both players see the result
simultaneously; and if either player disconnects mid-game, the survivor is
notified and returned to the mode selector within 10 seconds. When a game ends
the result is recorded on a **shared arcade leaderboard**, visible to all players:
rank, name, wins, draws, and losses. Player B can see Player A's scores within
approximately 1.2 seconds of game-over (SLA: 10 seconds). No accounts are
required.

**Arcade name model:** names are not unique or authenticated. Two players can
both call themselves "AAA". Scores accumulate on a single shared row per name —
intentional arcade behaviour. The name you last used is pre-filled on your next
visit (sessionStorage).

**Not yet available:** reconnect after reload (a player who reloads their tab
loses the session and must start a new game — deferred until player identity
ships) and player accounts.

---

## How to access it

Open this URL in any modern browser:

```
https://d3pf3kcvzpau1x.cloudfront.net
```

No installation, no account, no login required.

---

## Choosing a mode

Three options appear on the mode selector at the top of the screen:

- **Two player** (default) — both players share the same device and take turns
  clicking squares.
- **vs Computer** — you play as X; the computer plays as O automatically.
- **Play Online** — creates a game on the server and shows you a code to share
  with a friend; the friend joins from their own browser using the code.

---

## How to play — Two player

1. X always goes first. The turn indicator shows "X's turn" or "O's turn".
2. Click an empty square to place your symbol. The square is then disabled.
3. Turns alternate automatically.
4. **Win:** the first to complete a row, column, or diagonal wins. The board
   locks and "X wins" or "O wins" is displayed.
5. **Draw:** if all nine squares are filled with no winner, "Draw" is shown.
6. Click **Play again** to clear the board and start fresh.

---

## How to play — vs Computer

The same rules apply, with these differences:

- You are always X. The computer is always O.
- After you click a square, the computer places its move automatically
  (response under 200 ms).
- The computer plays optimally using the minimax algorithm. **You cannot win.**
  Every game ends in a draw or an O win.

---

## Play Online — starting a game (host)

1. Click **Play Online** on the mode selector.
2. A loading spinner appears while the game is created on the server.
3. Within 3 seconds a "waiting for opponent" screen appears with a prominent
   **6-character game code** and a **"Copy link"** button. Each code is
   storage-guaranteed unique — two simultaneous games can never share a code,
   so a friend's link always reaches the right game.
4. Click **Copy link**. The URL `https://d3pf3kcvzpau1x.cloudfront.net/join/<code>`
   is placed on your clipboard.
5. Send the link to your friend by any means (message, email, etc.).
6. Wait. When your friend joins, both screens automatically transition to the
   game board.

**Authentication is handled automatically.** When you click Play Online, the
server returns a short-lived connection token alongside the game code. The
browser appends it to the WebSocket URL invisibly — you never see or type it.

**If the backend is unavailable:** the UI displays "Could not start online game
— please try again". The mode selector remains usable.

---

## Play Online — joining via share link (easiest)

1. Open the link your host sent you. The URL has the form
   `https://d3pf3kcvzpau1x.cloudfront.net/join/<code>`.
2. The join screen opens with the 6-character code already filled in.
3. Click **Join** (one click — no typing required).
4. Within 3 seconds both players see the game board. The host is **X**;
   the joiner is **O**.

**If the link is stale or the code is wrong:**
"Game not found. Check the code and try again." appears. Ask the host
to create a new game and share a fresh link.

---

## Play Online — joining by typing the code (alternative)

If you have the code but not the link:

1. Click **Play Online** on the mode selector, then choose **Join a game**.
2. Enter the 6-character code and click **Join**.
3. Within 3 seconds both players see the game board.

**Error messages you may see on the join screen:**

| Message | Meaning |
|---------|---------|
| "Game not found. Check the code and try again." | The code does not match any active game. The link may be stale or the code was mistyped. |
| "This game is no longer available." | The game already has two players, or has ended. Ask the host to create a new game. |
| "Something went wrong. Please try again." | An unexpected server error occurred. Try again; if it persists the service may be briefly unavailable. |

---

## Play Online — playing moves

Once both players are on the board:

1. X moves first. The turn indicator shows whose turn it is.
2. Click an empty square to send your move. **The board does not update until
   the server confirms the move** — it waits for the server broadcast (no
   optimistic update). This ensures both browsers always show identical state.
3. After each accepted move, both boards update simultaneously (p95 latency
   measured at 308 ms in production validation).
4. If you click when it is not your turn, nothing happens on either board.
   The server rejects the move silently.
5. **Win:** when a winning line is completed, both browsers display "X wins" or
   "O wins" within 1 second of each other. Neither player can make further
   moves.
6. **Draw:** when all 9 squares are filled with no winner, both browsers display
   "Draw" within 1 second of each other.
7. Click **Play again** to start a new game.

---

## Example session — Play Online via share link (full game, ~2.3 s total)

```
Host clicks "Play Online"
  → spinner briefly
  → "Waiting for opponent"
     Game code: 5R2R4U
     [Copy link] button

Host clicks "Copy link"
  → clipboard: https://d3pf3kcvzpau1x.cloudfront.net/join/5R2R4U

Host sends that URL to friend

Friend opens the URL in their browser
  → join screen; code "5R2R4U" already filled in
  → clicks "Join" (one click)

Both screens → game board
  Host:  "You are X — X's turn"
  Guest: "You are O — X's turn"

Host clicks square 0
  → board updates on BOTH screens: X in top-left
  → turn indicator: "O's turn"

Guest clicks square 3
  → board updates on both: O in middle-left
  → turn indicator: "X's turn"

… game continues to win or draw …

Final move completes a row
  → both screens: "X wins" — board locked
```

---

## Known limitations (online mode)

- **Reload loses the session.** If either player reloads the page they lose
  their WebSocket connection and cannot reconnect to the same game. The reloading
  player lands on the mode selector; the surviving player receives "Your opponent
  disconnected." and is also returned to the mode selector. Reconnection requires
  player identity (unscheduled).
- **Games expire silently.** DynamoDB TTL removes games after 24 hours and
  WebSocket connections after 2 hours. There is no UI countdown or notification.
  A share link for an expired game shows "Game not found. Check the code and
  try again." — ask the host to create a new game.

---

## Running the project locally (developers)

### Prerequisites

- Node.js 20 or later
- npm 10 or later

### App (React SPA)

```bash
# Install dependencies
npm --prefix work/oxo-online/src/app install

# Run unit + component tests (single run)
npm --prefix work/oxo-online/src/app run test:run

# Start the development server (no cloud needed)
npm --prefix work/oxo-online/src/app run dev
```

### Local full-stack stand-up (no cloud credentials required)

Run the full move-relay stack locally — a local WS server backed by in-memory
adapters plus the SPA dev server. Two browser tabs at `http://localhost:5183`
can play a complete game.

```bash
make run-local
```

Run the committed Playwright browser suite against the local stand-up (starts
the stand-up itself; no separate `run-local` process needed):

```bash
make test-local
```

### Walking-skeleton probes (production — requires deployed stack)

Drive one real move through the full deployed path in two real browsers
(Playwright). Requires the SPA deployed with the move feature enabled and the
`move` route live in `OxoGameProd`:

```bash
make move-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
```

Drive the disconnect path end-to-end: one browser closes its tab; the other
browser must receive "Your opponent disconnected." and return to the mode
selector (operator probe for the disconnect handler):

```bash
make disconnect-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
```

Verify the deep-link `/join/<code>` boots the SPA via CloudFront's SPA fallback
and pre-fills the join code (operator probe for the share-link path):

```bash
make join-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
```

### Lambda tests

```bash
npm --prefix work/oxo-online/src/lambda install
npm --prefix work/oxo-online/src/lambda test
```

### Infrastructure (CDK TypeScript)

```bash
npm --prefix work/oxo-online/src/infra install
npm --prefix work/oxo-online/src/infra test
```

### Smoke tests (Playwright, against production)

```bash
npm --prefix work/oxo-online/src/app install
npm --prefix work/oxo-online/src/app run test:smoke
```

### Validation tests (requires AWS credentials + live stack)

```bash
make validate ITER=11 SLICE=s008-share-link
```

---

## Deploying

### Normal deploy (push to main)

Pushing to `main` with changes under `work/oxo-online/src/` triggers two
GitHub Actions pipelines automatically:

- **infra-oxo-online.yml** — triggered on changes to `src/infra/**` or
  `src/lambda/**`. Builds the CDK app and all Lambda code, then deploys
  `OxoGameProd` (both Lambdas + DynamoDB + HTTP API + WebSocket API with 5
  routes including `move`) first, then `OxoOnlineProd` (CloudFront + S3) second.
  After deploying, writes the WebSocket URL into `/config.js` on S3.

- **deploy-oxo-online.yml** — triggered on changes to `src/app/**` only.
  Builds and syncs the SPA to S3, issues a CloudFront invalidation, and writes
  `/config.js`. Injects `VITE_BUILD_SHA` (the commit SHA) into the SPA as
  `<meta name="build-sha">` for version identity.

Both pipelines use GitHub OIDC (no static AWS keys).

### OIDC stack (one-time manual)

```bash
make -C work/oxo-online/src/infra deploy-oidc
```

---

## Known limitations

- **Online mode — no reconnect.** Reloading the page loses the session; both
  players are returned to the mode selector. Reconnection requires player
  identity (unscheduled).
- **Online mode — silent expiry.** Games expire after 24 hours; WebSocket
  connections expire after 2 hours. No UI notification is shown.
- **Rate limiting on game creation.** A WAF rate rule limits POST /api/games to
  100 requests per 5 minutes per IP. If exceeded, the server returns HTTP 429
  and the UI shows "Could not start online game — please try again". Wait a few
  minutes and try again.
- **Per-IP WebSocket connection budget.** More than approximately 20 rapid
  connection attempts from the same network within a 5-minute window are
  temporarily blocked. The block self-clears automatically. This is most likely
  to affect automated test suites or scripts; it is unlikely to affect normal
  play.
- Mobile layout is functional but not optimised for small screens.
- There is no undo, no move history, and no score tally across sessions.
