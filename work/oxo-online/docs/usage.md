# oxo-online — Usage

## What is this?

oxo-online is a feature-complete noughts and crosses (tic-tac-toe) game that
runs in a web browser, live at https://d3pf3kcvzpau1x.cloudfront.net. No
accounts or installation are required. The full C1–C7 roadmap has shipped.

You can play locally against another person on the same device, play solo against
an unbeatable computer opponent, or play a complete online game against a friend
in a separate browser in real time. The full online flow is live: the host enters
an arcade name (optional — defaults to "AAA"), creates a game and shares it using
either "Copy code" (the 6 characters, for a friend who types) or "Copy link" (the
/join/ URL, for one-click join); the friend opens the URL and joins in one click;
moves relay between browsers via a server-authoritative Lambda; the server detects
wins and draws; both players see the result simultaneously; and if either player
disconnects mid-game, the survivor is notified and returned to the mode selector
within 10 seconds. During an active online game, each player has a **chat box**
below the board — type a message and press Enter (or click Send) and the opponent
sees it within approximately 1 second (p95 196 ms in production validation),
labelled "Opponent"; your own message is echoed back labelled "You". When a game
ends the result is recorded on a **shared arcade leaderboard**, visible to all
players: rank, name, wins, draws, and losses. Player B can see Player A's scores
within approximately 1.2 seconds of game-over (SLA: 10 seconds).

**Arcade name model:** names are not unique or authenticated. Two players can
both call themselves "AAA". Scores accumulate on a single shared row per name —
intentional arcade behaviour. The name you last used is pre-filled on your next
visit (sessionStorage).

**Chat model:** your in-game chat is private to the two players in your game — a
player in any other game can never see your messages (proven adversarially in
production, including forged-gameId rejection). Messages are in-memory only —
they vanish when the game ends or a player disconnects, and the chat input
disappears from the screen at game-over. There is no message history. Names and
messages are not authenticated; anyone can type anything. The chat box is only
visible during an active online game (absent on idle and waiting screens).
Messages are limited to 200 characters.

**Known limitation — no reconnect after reload:** a player who reloads the page
loses the session and must start a new game. Reconnection requires player identity
(unscheduled).

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

## Play Online — setting your name

Before or after clicking Play Online you will see a **"Your name"** text field
pre-filled with "AAA" (or your last-used name from sessionStorage). You can
change it to anything you like, or leave it as is — there is no gate. The name
you enter is what appears on the shared leaderboard after your game ends.

Names are not unique. Two players can both use "AAA" — their results accumulate
on the same leaderboard row (arcade model).

---

## Play Online — starting a game (host)

1. Click **Play Online** on the mode selector.
2. A loading spinner appears while the game is created on the server.
3. Within 3 seconds a "waiting for opponent" screen appears with a prominent
   **6-character game code** and **two copy buttons**. Each code is
   storage-guaranteed unique — two simultaneous games can never share a code,
   so a friend's link always reaches the right game.
4. Share with your friend using one of these controls:
   - **Copy code** — copies the 6-character code to your clipboard (e.g.
     `5R2R4U`). Useful if your friend will type it into the join screen.
   - **Copy link** — copies the full URL
     `https://d3pf3kcvzpau1x.cloudfront.net/join/<code>` to your clipboard.
     Your friend opens this link and joins in one click.
5. Wait. When your friend joins, both screens automatically transition to the
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

## Play Online — in-game chat

A chat panel appears below the board while the game is active.

1. Type a message in the "Chat message" text field.
2. Press **Enter** or click **Send** to send. Your message appears labelled
   "You"; your opponent sees the same message labelled "Opponent" within
   approximately 1 second (p95 196 ms measured in production).
3. Messages are limited to 200 characters. Leading/trailing whitespace and
   the characters `< > & " '` are stripped by the server before relay.
4. **Your chat is private to your game.** Only the two players in your game
   can see your messages. A player in any other game — on the same server, at
   the same time — receives zero chat frames from your game. This is enforced
   server-side and proven adversarially in production.
5. **Messages are not saved.** When the game ends, the chat input disappears
   from both screens and the chat history vanishes. There is no history across
   games.
6. Sending a message after your opponent has disconnected does not cause any
   error; the message is silently discarded server-side.
7. The chat box is absent on the idle and waiting-for-opponent screens — it
   only appears during an active game.

---

## Example session — Play Online via share link (full game, ~2.3 s total)

```
Host types "ACE" in the "Your name" field (optional; default is "AAA")

Host clicks "Play Online"
  → spinner briefly
  → "Waiting for opponent"
     Game code: 5R2R4U
     [Copy code] button  [Copy link] button

Host clicks "Copy link"
  → clipboard: https://d3pf3kcvzpau1x.cloudfront.net/join/5R2R4U
  (or clicks "Copy code" → clipboard: 5R2R4U, for a friend who will type it)

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

Host types "gg" in the chat box and presses Enter
  → Host sees "You: gg" immediately
  → Guest sees "Opponent: gg" within ~1s

Final move completes a row
  → both screens: "X wins" — board locked
  → chat panel disappears (no longer an active game)

Either player returns to the idle/title screen
  → shared leaderboard appears under the mode selector
     #  Name  W  D  L
     1  ACE   2  0  1
     …
  (ACE's win from this game is visible within ~1.2 s of game-over)
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
- **Names are not unique.** Two players can share the same name; their results
  accumulate on one leaderboard row. There are no accounts or passwords.
- **Chat has no history and no persistence.** Messages exist only in the browser
  for the duration of the active game. Reloading or disconnecting loses all chat.
- **Chat sender labels are not tied to arcade names.** The "You" / "Opponent"
  labels are derived from the server-side connection binding, not the player's
  arcade name. There is no way to verify who typed a message beyond the connection
  identity.

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

### Walking-skeleton probe for the scoring path (production — requires deployed stack)

Drive a complete game through the stream scoring path (Probe A: one game-over →
exactly one leaderboard increment; Probe B: replay → no double-count). This is
the operator health-check for the DynamoDB Stream → oxo-board-fn → leaderboard
path:

```bash
make board-stream-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
```

### Validation tests (requires AWS credentials + live stack)

```bash
make validate ITER=14 SLICE=s009-arcade-scoreboard
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
- **Leaderboard names are not authenticated.** Anyone can enter any name. Two
  players sharing a name share one leaderboard row. This is intentional arcade
  behaviour, not a bug.
- **Leaderboard has a 5-second CloudFront cache.** A score from a game that just
  ended may take up to 5 seconds to appear (measured at 1.2 s in production
  validation; SLA is 10 s).
- Mobile layout is functional but not optimised for small screens.
- There is no undo and no move history.
