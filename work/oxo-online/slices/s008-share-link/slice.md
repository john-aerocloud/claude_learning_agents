---
slice: s008
slug: share-link
status: in-planning
decision-log-ref: SEL-S008
chunk: C4
created: 2026-06-07
completes-chunk: C4
---

# s008 — share-link UX

**This slice completes chunk C4 (online two-player match).**

---

## Job served

**[CORE] Playing against a real human** — social coordination dimension.

When I want to challenge a specific friend to a game, I want to share a single
URL that drops them directly into the join flow, so that the friction between
"we decided to play" and "we are both on the board" is as close to zero as
possible.

Today, after creating a game, I must separately communicate the 6-char code to
my friend — by text, message, voice. They must then manually type it on the join
screen. That out-of-band step is unnecessary given the code is already knowable
at URL construction time. This slice eliminates that friction: one URL copy,
one click, no typing.

The job has a social dimension: "I want to look like I know what I'm doing when
I invite someone to play" (low-friction invite = social confidence). The
functional and social dimensions converge here — the share link serves both.

---

## Killick test

Could a user do something valuable they could not do before?

YES. Before s008, to start an online game a player must:
1. Create the game.
2. Separately read out / copy the 6-char code.
3. The friend manually navigates to the app and types the code.

After s008, the host copies one URL and sends it. The friend clicks the link and
lands on the join screen with the code already filled in. One click to join. The
minimum social coordination friction for the core job is met.

A player could not share a playable invitation link before this slice. Now they
can.

---

## OI-5 decision — CloudFront WS single-origin proxying

**Decision: path-based deep-link on the existing CloudFront SPA origin suffices.
CloudFront WebSocket single-origin proxying (WS behind CloudFront) is NOT
required by the share-link UX and is deferred or dropped.**

Reasoning: the share-link mechanism is a path-routed deep link on the SPA
(`/join/<code>`). The SPA is already served from the CloudFront distribution.
All that is needed is that CloudFront's SPA fallback (CustomErrorResponses
4xx→200+index.html) continues to route `/join/*` paths to the React app, which
React Router then handles client-side. The client-side app reads the code from
the URL path and pre-fills the join form. The WebSocket connection is then
opened from the browser directly to the API Gateway WSS endpoint — exactly as
it works today. The share link does NOT create a WS connection through
CloudFront; it only deep-links the SPA. Therefore OI-5's question ("does
share-link demand single-origin WS proxying?") is answered: no, it does not.

A single-origin URL (where `/wss` is also on the CloudFront domain) would
simplify the UI config and remove the separate WSS origin in config.js, but
that is a developer-convenience / CORS-hygiene improvement unrelated to the
share-link job. OI-31 noted the CustomErrorResponse blanket-4xx fallback already
has observability downsides; adding WS proxying behind it is a separate
architectural decision with its own tradeoffs (path conflict, caching, origin
config). This slice does not require it.

**This slice is client-only (arch-lite). No backend changes, no new infrastructure,
no CloudFront rule changes beyond what already serves the SPA.**

---

## Thin scope

**1. Copy-link control on the waiting screen.**

The game creation screen (currently shows the 6-char code and a "waiting for
opponent" indicator) gains a "Copy link" button or icon control immediately
adjacent to the code. Clicking it copies `https://<domain>/join/<code>` to the
clipboard. A brief confirmation ("Copied!") replaces the button label for ~2
seconds. The code is also still visible as plain text (unchanged).

**2. Deep-link URL construction.**

The URL is constructed client-side using the code: `window.location.origin +
"/join/" + code`. No backend call. No new route on the server.

**3. React Router route for `/join/:code`.**

A new client-side route is added: `/join/:code`. When the SPA loads on this
path (e.g. via a direct navigation from the share link), the join screen is
rendered with the `:code` parameter pre-filled in the code input field and the
"Join" button immediately enabled. The user clicks once to submit.

CloudFront's existing CustomErrorResponse (4xx→200+index.html) already handles
unknown paths — `/join/<code>` will reach the SPA. No CloudFront change is
needed.

**4. Invalid-code error on URL path.**

If the user navigates to `/join/<code>` and the code does not match a waiting
game (server returns 404 on the join attempt), the join screen shows a readable
error message: "Game not found. The link may have expired or already been used."
This is the same error path as manual code entry, re-used here. No new server
logic.

**5. Manual code entry still works.**

The existing join screen (manual code entry via `/join` or the mode selector)
is not removed. Players who receive the code by other means can still type it.

---

## What is explicitly NOT in scope

- Deep-link authentication (the share link carries no auth token; it only
  pre-fills the code — the join auth flow is unchanged from s005-h2).
- Game lobbies or invite lists.
- Match history or persistent game records.
- CloudFront WebSocket single-origin proxying (OI-5 decided above: not required).
- Link expiry UI (games expire at the existing 24h TTL; expired-code error
  message is the signal — no separate "link expired" state).
- QR code or social-share metadata (og: tags, etc.).
- Reconnect-after-reload (s007 OI-10 decision stands: unscheduled).
- s005-h3 (code uniqueness guarantee) — parallel, not this slice.
- OI-36 (oxo-ws-fn BUILD_SHA gap) — residual from s007; opportunistic fix but
  not a scope item for this slice.

---

## Success measures

**SM-1 — Copy-link control copies a valid URL.**
On the game creation / waiting screen, the "Copy link" control is present. Clicking
it places a URL of the form `https://<domain>/join/<6-char-code>` on the clipboard.
Confirmed via Playwright clipboard read or navigation-based assertion.

**SM-2 — Deep-link pre-fills and enables one-click join.**
Navigating to `/join/<code>` in a fresh browser tab (no prior app state):
- The join screen is rendered.
- The code input field is pre-filled with the `<code>` from the URL.
- The "Join" button is enabled without any user interaction.
- Clicking "Join" submits the join request and transitions both players to the
  game board (same as the manual-entry join flow).

**SM-3 — Invalid code in URL shows a readable error.**
Navigating to `/join/XXXXXX` where XXXXXX is not a valid waiting-game code renders
the join screen with the error message visible: "Game not found. The link may have
expired or already been used." The page does not crash or show a generic 500.

**SM-4 — Manual code entry is unaffected.**
The existing join flow (typing the code manually on the join screen reached via
the mode selector) still works. No regression on s005 acceptance cases.

**SM-5 (C4 done-condition proof) — End-to-end game via share link, intent to
result in under 5 minutes.**
Player A creates a game, copies the share link, sends it to Player B (different
browser, different tab or session). Player B clicks the link, one-click joins,
and both players play a complete game to result screen. The elapsed time from
Player A clicking "Create" to both players seeing the result screen is under 5
minutes. Measured in a two-browser Playwright smoke run.

This is the C4 done-condition proof. C4 done condition: "Two players in separate
browsers can complete a full game: host creates a game and shares a code; joiner
enters the code and joins; moves made in one browser appear in the other within
1 second (p95); win/draw is detected and shown to both players; disconnection is
handled gracefully. No accounts required." All elements are now satisfied: game
play (s006), disconnect (s007), frictionless share (this slice).

---

## Residual open items carried into this slice

- OI-31 (CustomErrorResponse observability) — the existing blanket 4xx→200
  fallback is what makes `/join/:code` deep-links work. No change is made to
  that rule in this slice, but the architect should note the dependency in the
  architecture delta so any future change to the fallback does not silently break
  deep-link routing.
- OI-36 (oxo-ws-fn BUILD_SHA not injected) — opportunistic fix if the engineer
  touches game-stack in this slice; otherwise remains open.
