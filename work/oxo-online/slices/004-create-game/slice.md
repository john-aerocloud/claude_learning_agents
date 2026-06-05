---
slice: 004-create-game
chunk: 4 — Online two-player match
status: proposed
depends-on: s003 ✓
---

# Slice 004 — Create game and receive shareable code

## Job served

**Playing against a real human (partial — host side only)**

When I want to challenge a specific friend to a game, I want to create a game
session and receive a shareable code or URL, so that I can send it to my friend
and they can join. This is the minimum observable step in the host's job: without
a game session and a code there is no online match at all.

This slice proves that the Lambda + DynamoDB + API Gateway WebSocket backend
exists and is reachable from the production SPA — the first stateful backend call
ever made in this project.

---

## Scope (what is IN this slice)

A player can tap "Play Online", a game session is created server-side (Lambda
writes a `games` record to DynamoDB, generates a short alphanumeric game code),
and the UI shows the code so the player can share it with a friend.

Concretely:
- **UI:** New "Play Online" button on the mode selector screen. Tapping it calls
  the backend, enters a "waiting for opponent" view, and displays the game code
  prominently.
- **HTTP endpoint:** `POST /api/games` — Lambda handler creates the game record
  in DynamoDB (status=`waiting`, hostConnectionId=null, TTL=24h) and returns
  `{ gameId, code }`. No WebSocket connection is opened yet.
- **CDK delta:** HTTP API Gateway + Game Lambda + DynamoDB `Games` table (+ IAM
  role `oxo-game-fn`) are provisioned for the first time. CloudFront routes
  `/api/*` to the HTTP API.
- **Deploy role extension:** `oxo-deploy` role gains `lambda:UpdateFunctionCode`
  and minimal CDK bootstrap permissions so the pipeline can deploy the new infra.
- **Graceful degradation:** if the backend call fails (network error, cold-start
  timeout, 5xx), the UI shows an error message and the player can fall back to
  two-player or vs-AI modes without a page reload. Existing s002/s003 modes are
  untouched by this change.

---

## Explicitly NOT in scope

- Second player joining by code (s005)
- WebSocket connection opening — not needed until a second player joins (s005)
- Move relay or real-time sync (later slices)
- Win/draw detection on the server (later slices)
- Game code sharing via a deep link / URL (later slices — code is shown as text
  to copy manually)
- Opponent-waiting timeout or game expiry UX (TTL handles storage; no UI for it)
- WAF rate limiting (planned for C4/C5; deferred until the backend is exercised
  in production and attack surface is real)
- DynamoDB `Connections` table (not needed until WebSocket $connect, s005)
- Leaderboard service or `Leaderboard` DynamoDB table (Chunk 5)
- Player display names (Chunk 6)
- Any change to the two-player or vs-AI game flow

---

## Success measures

1. **Code is generated and shown.** A player in production taps "Play Online", the
   request completes within 3 seconds, and a 6-character alphanumeric game code
   appears on screen. Verifiable by a human clicking the button.

2. **Game record persists in DynamoDB.** The DynamoDB `Games` table contains a
   record with the returned `gameId`, status=`waiting`, and a TTL ~24h from
   creation time. Verifiable via AWS Console or CLI query immediately after
   step 1.

3. **Existing modes unaffected.** Both "Two Player (local)" and "vs Computer"
   modes continue to work exactly as in s003 — no regression. Verifiable by
   completing a game in each mode after deploying this slice.

4. **Backend failure degrades gracefully.** When the `POST /api/games` endpoint
   returns a 5xx (tested by temporarily misconfiguring the endpoint in a dev
   branch), the UI displays a user-readable error and does not white-screen.
   The mode selector remains accessible.

5. **Pipeline deploys new infra cleanly.** The GitHub Actions pipeline succeeds
   end-to-end (CDK deploy + SPA deploy + CloudFront invalidation) with no manual
   steps. The new HTTP API and Lambda are observable in the AWS Console after the
   pipeline run.

---

## Killick test

Could a user do something valuable they could not do before?

Yes: a player can initiate an online match and obtain a code to share with a
friend. Before this slice that was impossible. The value is partial (the friend
cannot yet join) but real — the host now has a tangible artefact (a code) that
represents an intent to play against a real person. Every subsequent online-match
slice depends on this foundation existing.

The slice is not purely enabling-infrastructure: the game code displayed to the
user is the observable customer outcome, not a hidden side-effect.
