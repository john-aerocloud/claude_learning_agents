# oxo-online — Usage

## What is this?

oxo-online is a noughts and crosses (tic-tac-toe) game that runs in a web
browser. You can play locally against another person on the same device, play
solo against an unbeatable computer opponent, or start an online game and
receive a shareable 6-character code to give to a friend. The game detects
wins and draws, locks the board when the game ends, and lets you start a new
game without refreshing the page.

**Not yet available:** a second player joining by code (the join flow ships in
slice 005), move relay between players in real time, player accounts, score
tracking across sessions, and in-game chat.

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
  with a friend. The friend cannot join yet (that is slice 005).

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

## Play Online — starting a game

1. Click **Play Online** on the mode selector.
2. A loading spinner appears while the game is created on the server (shown
   only if the request takes longer than 500 ms).
3. Within 3 seconds a "waiting for opponent" screen appears with a prominent
   **6-character game code** (uppercase letters and digits, no ambiguous
   characters such as O, 0, 1, I, or L — example: `GZU3U2`).
4. Share the code with your friend by any means (copy and paste it manually).
5. The friend cannot join yet — joining by code ships in slice 005.

**If the backend is unavailable:** the UI displays "Could not start online game
— please try again". The mode selector remains usable and no page reload is
needed. The browser will not show a blank white screen.

---

## Example session — Play Online

```
User clicks "Play Online"
  → spinner briefly (if server takes >500 ms)
  → "Waiting for opponent"
     Game code: GZU3U2
     (share this code with your friend)
```

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

- **infra-oxo-online.yml** — triggered on changes to `src/infra/**`. Runs CDK
  deploy for `OxoGameProd` (Lambda + DynamoDB + HTTP API) first, then
  `OxoOnlineProd` (CloudFront + S3) second. The order is mandatory — see
  `work/oxo-online/src/infra/STACK_ORDER.md`.

- **deploy-oxo-online.yml** — triggered on changes to `src/app/**` or
  `src/lambda/**`. Builds and syncs the SPA to S3, issues a CloudFront
  invalidation, and (when `src/lambda/**` changed) hot-swaps the Lambda code
  via `aws lambda update-function-code`.

Both pipelines use GitHub OIDC (no static AWS keys). The GitHub Actions
variable `OXO_ONLINE_LAMBDA_FUNCTION_NAME` must be set to `oxo-game-fn`.

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

- A friend cannot join an online game by code yet (slice 005).
- Mobile layout is functional but not optimised for small screens.
- There is no undo, no move history, and no score tally across sessions.
- Games expire after 24 hours (DynamoDB TTL). There is no UI notification when
  a game has expired.
