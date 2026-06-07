---
slice: s008
slug: share-link
author: engineer
process-ref: §11a (route + build per use case)
---

# Route — s008 share-link (engineer)

Client-only / arch-lite. SOLO, SERIAL: UC1 and UC2 touch the SAME SPA files
(App.tsx router, GameRoot.tsx, JoinScreen.tsx). UC2 first per product's call —
it defines the `/join/:code` URL form that UC1's copy control mirrors. No flags
needed (single engineer, sequential commits on trunk; no parallel WIP to isolate).

Router approach: **existing BrowserRouter** (already in `main.tsx`) + existing
`<Routes>` in `App.tsx`. We add one `<Route path="/join/:code">`. Tests mount
`<App>` under `MemoryRouter initialEntries={['/join/ABC123']}` (same pattern as
the existing App.test.tsx). `make test-local` keeps a real BrowserRouter; a
`/join/<code>` navigation just resolves the new route client-side.

class-deps seam: NEW node `spaJoinRoute` (App.tsx `/join/:code` route) → existing
`spaJoinScreen` (JoinScreen pre-fill) → existing JoinScreen submit (the s005/s006
WS join path, UNCHANGED). Traced as the ACTUAL runtime path: router mounts
GameRoot in the `joining` phase with the URL code; JoinScreen pre-fills + submits
over the existing socket seam. Marked `classDef changed`; cleared by tester.

## UC2 — deep-link route + pre-fill + one-click join (T1/T2/T4, SM-2/SM-3)

Build order (red→green→commit each):

1. **JoinScreen pre-fill seam.** RED: JoinScreen with `initialCode="ABC123"`
   pre-fills the code input; Join is enabled (it already is — `type=submit`,
   never disabled); submitting calls the SAME submit → `{action:'join',code}` +
   `credential:{code}`. @covers spaJoinScreen.
2. **App `/join/:code` route.** RED: `<App>` at `/join/ABC123` renders the join
   screen with the code pre-filled and the mode selector present; the WS join
   action fires on submit (reuse JoinScreen submit — do NOT fork). `/` still shows
   the normal mode-selector (existing App.test stays green). @covers spaJoinRoute.
3. **Invalid-code error (reuse, no regress).** RED: a `code-not-found` close
   (abnormal 1006) / 4040 frame on the deep-link join shows the EXISTING readable
   "Game not found…" message — same mapping as manual entry (s006/OI-33),
   asserted via the same JoinScreen path. @covers spaJoinScreen.

Commit UC2 when green. Push → SPA pipeline deploys.

## UC1 — copy-link control (T3/S3/SM-1)

4. **Copy-link control on the waiting screen.** RED: GameRoot waiting screen has a
   stable `[data-testid="copy-link"]` control; clicking it calls
   `navigator.clipboard.writeText` with EXACTLY `window.location.origin + "/join/" + code`
   (S3: no token/credential query param or fragment); label shows "Copied!"; the
   `[data-testid="game-code"]` stays visible. @covers spaCopyLink.

Commit UC1 when green. Push → SPA pipeline deploys.

## §11a probe (committed, skeleton-gated)

`make join-skeleton PROD_URL=…` — a deep-link probe: create a game in one browser
to mint a real code, then navigate a SECOND browser to
`https://<domain>/join/<code>` and assert the SPA boots (NOT an edge/CloudFront
error) with the code pre-filled and Join enabled, no WS/CSP console errors. Peer
to disconnect-skeleton; run post-deploy by orchestrator/tester. Needs a new
package.json script `test:skeleton:join` + Makefile target. If `make join-skeleton`
needs an allowlist entry → flag cicd (skeleton pattern class already exists for
move-skeleton/disconnect-skeleton).

## Suites per commit
`make test-app` + `make lint-app` + `make build-app` green; `make test-local`
stays green. Push each green commit to trunk → app pipeline deploys SPA.

## Deviation flagged up-front
The acceptance (AC2.3) pins the deep-link invalid-code text as
"Game not found. The link may have expired or already been used." The EXISTING
s006/OI-33 code-not-found mapping renders "Game not found. Check the code and try
again." — pinned by 6 JoinScreen tests + the s006 manual-entry contract. The task
says REUSE the existing mapping and do NOT regress it. Reuse wins: a single
code-not-found path cannot carry two different strings. Both start "Game not
found." Flagged to product/tester for an acceptance-text reconciliation.
