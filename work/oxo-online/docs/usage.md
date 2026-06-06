# oxo-online — Usage

## What is this?

oxo-online is a noughts and crosses (tic-tac-toe) game that runs in a web
browser. You can play locally against another person on the same device, play
solo against an unbeatable computer opponent, or start an online game and
share a 6-character code so a friend can join from their own device. Both
players see the board together and know their role (X or O). The game detects
wins and draws, locks the board when the game ends, and lets you start a new
game without refreshing the page.

**Not yet available:** move relay between players (clicking squares has no
effect in the online mode — that ships in slice 006), player accounts, score
tracking across sessions, share-link URL pre-fill, and in-game chat.

---

## How to access it

Open this URL in any modern browser:

```
https://d3pf3kcvzpau1x.cloudfront.net
```

No installation, no account, no login required. The page loads immediately.

---

## Choosing a mode

Three options appear on the mode selector at the top of the screen:

- **Two player** (default) — both players share the same device and take turns
  clicking squares.
- **vs Computer** — you play as X; the computer plays as O automatically.
- **Play Online** — creates a game on the server and shows you a code to share
  with a friend; the friend joins from their own browser using the code.

Click the option you want. The board resets and "X's turn" is shown.

---

## How to play — Two player

1. X always goes first. The turn indicator shows "X's turn" or "O's turn".
2. Click an empty square to place your symbol. The square is then disabled.
3. Turns alternate automatically.
4. **Win:** the first to complete a row, column, or diagonal wins. The board
   locks and "X wins" or "O wins" is displayed.
5. **Draw:** if all nine squares are filled with no winner, "Draw" is shown.
6. Click **Play again** to clear the board and start fresh. The mode stays
   active.

---

## How to play — vs Computer

The same rules apply, with these differences:

- You are always X. The computer is always O.
- After you click a square, the computer places its move automatically
  (no second click required, response under 200 ms).
- The computer plays optimally using the minimax algorithm. **You cannot win.**
  Every game ends in a draw or an O win.

---

## Play Online — starting a game (host)

1. Click **Play Online** on the mode selector.
2. A loading spinner appears while the game is created on the server (shown
   only if the request takes longer than 500 ms).
3. Within 3 seconds a "waiting for opponent" screen appears with a prominent
   **6-character game code** (uppercase letters and digits, no ambiguous
   characters such as O, 0, 1, I, or L — example: `GZU3U2`).
4. Share the code with your friend by any means (copy and paste it manually).
5. Wait on the waiting screen. When your friend joins, both screens
   automatically transition to the game board.

**If the backend is unavailable:** the UI displays "Could not start online game
— please try again". The mode selector remains usable and no page reload is
needed. The browser will not show a blank white screen.

---

## Play Online — joining a game (second player)

1. Ask the host for their 6-character game code.
2. Click **Play Online** on the mode selector, then choose **Join a game**.
3. Enter the 6-character code and click **Join**.
4. Within 3 seconds both players see the game board. The host is **X**; the
   joiner is **O**. Each player's screen shows "You are X" or "You are O".
5. The board is visible but squares cannot be clicked yet — move relay ships
   in slice 006. A status line reads "Game active — moves coming in the next
   update".

**Error messages you may see on the join screen:**

| Message | Meaning |
|---------|---------|
| "Game not found. Check the code and try again." | The code does not match any active game. Check for typos; the host's code is 6 characters. |
| "This game is no longer available." | The game already has two players, or has ended. Ask the host to create a new game. |
| "Something went wrong. Please try again." | An unexpected server error occurred. Try again; if the problem persists the service may be briefly unavailable. |

---

## Example session — Play Online

```
Host clicks "Play Online"
  → spinner briefly (if server takes >500 ms)
  → "Waiting for opponent"
     Game code: GZU3U2

Friend clicks "Play Online" → "Join a game"
  → enters GZU3U2 → clicks Join
  → "connecting..."

Both screens → game board (within 3 seconds of join)
  Host:  "You are X — Game active — moves coming in the next update"
  Guest: "You are O — Game active — moves coming in the next update"
```

---

## Known limitations (online mode)

- **Reload loses the session.** If either player reloads the page they lose
  their WebSocket connection and cannot reconnect to the same game. Both
  players must create/join a fresh game. Reconnection is not in scope for
  this release.
- **Moves do not relay.** Clicking squares has no effect in online mode.
  Move relay ships in slice 006.
- **Games expire silently.** DynamoDB TTL removes games after 24 hours and
  WebSocket connections after 2 hours. There is no UI countdown or
  notification.
- **Code sharing is manual.** There is no share-link URL pre-fill; copy the
  code yourself. Share-link UX is planned for slice 008.

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

# Start the development server
npm --prefix work/oxo-online/src/app run dev
```

Note: `npm --prefix work/oxo-online/src/app run test` runs Vitest in **watch
mode**. Use `test:run` for a single-pass run (e.g. in CI or to check green
before committing).

### Lambda (TypeScript)

```bash
# Install dependencies and run tests
npm --prefix work/oxo-online/src/lambda install
npm --prefix work/oxo-online/src/lambda test
```

### Infrastructure (CDK TypeScript)

```bash
# Install and run infra unit tests
npm --prefix work/oxo-online/src/infra install
npm --prefix work/oxo-online/src/infra test
```

### Smoke tests (Playwright, against production)

```bash
# Install dependencies first, then:
npm --prefix work/oxo-online/src/app run test:smoke
```

Smoke specs live in `work/oxo-online/src/app/tests/smoke/` and run against the
live CloudFront URL. They require network access to production.

---

## Deploying

### Normal deploy (push to main)

Pushing to `main` with changes under `work/oxo-online/src/` triggers two
GitHub Actions pipelines automatically:

- **infra-oxo-online.yml** — triggered on changes to `src/infra/**` or
  `src/lambda/**`. Builds the CDK app and all Lambda code, then deploys
  `OxoGameProd` (both Lambdas + DynamoDB + HTTP API + WebSocket API) first,
  then `OxoOnlineProd` (CloudFront + S3) second. The order is mandatory — see
  `work/oxo-online/src/infra/STACK_ORDER.md`. After deploying, writes the
  WebSocket URL into `/config.js` on S3 so the SPA can connect to the right
  endpoint.

- **deploy-oxo-online.yml** — triggered on changes to `src/app/**` only.
  Builds and syncs the SPA to S3, issues a CloudFront invalidation (waits for
  completion), and writes `/config.js`. Lambda code is deployed exclusively
  by the infra pipeline (CDK `fromAsset`) — not by this pipeline.

Both pipelines use GitHub OIDC (no static AWS keys).

### OIDC stack (one-time manual)

`OxoOnlineOidcStack` is deployed once, manually, and is never included in the
automated pipeline. From `work/oxo-online/src/infra`:

```bash
make -C work/oxo-online/src/infra deploy-oidc
```

This requires local AWS credentials with sufficient permissions. See
`work/oxo-online/src/infra/DEPLOY_ROLE_EXTENSIONS.md` for the Lambda deploy
permissions that must be added to `oxo-deploy` and re-deployed before the app
pipeline can update Lambda code.

---

## Known limitations

- **Online mode — moves do not relay** (slice 006). The board is visible but
  clicking squares has no effect in online mode.
- **Online mode — no reconnect.** Reloading the page loses the session; start
  a new game.
- **Online mode — silent expiry.** Games expire after 24 hours; WebSocket
  connections expire after 2 hours. No UI notification is shown.
- Mobile layout is functional but not optimised for small screens.
- There is no undo, no move history, and no score tally across sessions.
