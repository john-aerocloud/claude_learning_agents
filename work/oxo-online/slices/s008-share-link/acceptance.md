---
slice: s008
slug: share-link
gate: GATE-2-S008 (auto-accept §9a — no new attack surface / data flow / trust boundary)
co-authored: product + solution-architect
---

# Acceptance — s008: share-link UX

Three case classes:
- **F-cases (product / customer-observable)** — owned by Product. These are the
  conditions a real user in a real browser experiences. The slice closes the
  out-of-band coordination friction: a host can share one URL; the friend clicks
  once to join.
- **T-cases (technical / observable)** — owned by Solution Architect, lifted
  verbatim-or-tightened from delta 008 T1–T6. Encode the deep-link routing,
  pre-fill, copy-link, invalid-code error, manual-entry regression, and the C4
  done-condition end-to-end smoke.
- **S-cases (security policy)** — owned by Solution Architect, lifted
  verbatim-or-tightened from delta 008 S1–S3. Encode the no-CSP-change pin,
  no-new-infra synth pin, and the URL-carries-no-credential form pin.

Every case is tagged to its use case(s). The coverage map at the end shows
T/S distribution across UCs.

---

## F-cases — product / customer-observable

### F1 — Host copies one URL; friend is one click from the board [UC1, UC2, UC3]

After creating a game, the host sees a "Copy link" control next to their 6-char
code. Clicking it copies a URL. Sending that URL to a friend means the friend
clicks the link, lands on the join screen with the code already filled in, and
clicks "Join" once. Both players are on the board. No code dictation, no manual
typing, no separate navigation step required by the friend.

Observed in: AC1.2 (clipboard URL), AC2.4 (deep-link boots SPA), AC2.5
(one-click join transitions to board), AC3.4 (C4 done-condition smoke).

### F2 — A stale or mistyped link shows a clear, readable error [UC2, UC3]

If a friend opens a share link for a game that no longer exists (expired,
already used, or the code was mistyped), they see the message "Game not found.
The link may have expired or already been used." The page does not crash, show a
generic 500, or display a raw CloudFront/S3 error page. The error is human-
readable and self-explanatory.

Observed in: AC2.3, AC2.6, AC3.4 (C4 smoke — implicit: valid code path confirms
the counter case).

### F3 — Typing the code still works; nothing regressed [UC3]

A player who receives a code by voice, text message, or any other means can
still navigate to the join screen manually and type the code. The share-link
addition has not removed or broken the parameterless join screen. No regression
on the s005 join flow.

Observed in: AC3.1.

### F4 — C4 done-condition: two friends, different browsers, one shared link,
full game start-to-result under 5 minutes [UC1, UC2, UC3]

Player A creates an online game, copies the share link from the waiting screen,
and sends it to Player B. Player B opens the link in a different browser (or
session), sees the join screen with the code pre-filled, clicks "Join" once, and
both players are on the board. They play a complete game to a win or draw result
screen. The total elapsed time from Player A clicking "Create" to both players
seeing the result screen is under 5 minutes.

This is the C4 chunk done-condition proof. All C4 elements are now satisfied:
game play (s006), disconnect handling (s007), and frictionless share (this
slice). C4 is CLOSED by this acceptance case.

Observed in: AC3.4.

---

## T-cases — technical / observable

T-cases are lifted verbatim-or-tightened from delta 008 T1–T6. Each carries
its original T-id.

### T1 — Deep-link boots the SPA on the deployed origin [UC2, UC3]

A fresh-tab navigation to a real deployed `https://<domain>/join/<code>` returns
the SPA (HTTP 200, `index.html` body) — CloudFront's 403/404→200+index.html
fallback serves the unknown path — and the SPA renders the join screen, NOT a
CloudFront/S3 error page (SM-2; cloud-only CloudFront-fallback covering
control).

Observed in: AC2.4.

### T2 — Pre-fill + one-click enable [UC2, UC3]

On `/join/<code>`, the code input is pre-filled with `<code>` from the URL and
the "Join" button is enabled with no user interaction; clicking it once submits
the join and both players reach the board via the SAME WS join path as manual
entry (SM-2).

Observed in: AC2.1, AC2.2, AC2.5.

### T3 — Copy-link copies a valid URL [UC1, UC3]

On the waiting screen the copy control is present; clicking it places
`https://<domain>/join/<6-char-code>` on the clipboard (Playwright clipboard
read or navigation-based assertion); the code remains visible as plain text
(SM-1).

Observed in: AC1.1, AC1.2, AC1.5.

### T4 — Invalid code → readable error, no crash [UC2, UC3]

Navigating to `/join/XXXXXX` (not a valid waiting-game code) and submitting
renders the join screen with "Game not found. The link may have expired or
already been used." visible; the page does not crash or show a generic
500/edge-error (SM-3; reuses the s006 `code-not-found` branch).

Observed in: AC2.3, AC2.6.

### T5 — Manual entry unaffected — no s005 regression [UC3]

The existing manual code-entry join flow (mode selector → type code) still
completes a join with no regression on s005 acceptance cases (SM-4).

Observed in: AC3.1.

### T6 — C4 done-condition end-to-end [UC1, UC2, UC3]

Player A creates a game, copies the share link; Player B (separate
browser/session) opens the link, one-click joins, and both play a full game to
the result screen — intent-to-result under 5 minutes in a two-browser Playwright
smoke (SM-5; the C4 done-condition proof).

Observed in: AC3.4.

---

## S-cases — security policy

S-cases are lifted verbatim-or-tightened from delta 008 S1–S3. Each carries
its original S-id.

### S1 — No CSP change / no new directive [UC2, UC3]

The deployed `Content-Security-Policy` response header is byte-for-byte the
s005-h2 value (`default-src 'self'; … connect-src 'self'
wss://*.execute-api.<region>.amazonaws.com; …`) — assert NO new directive and
NO relaxation of an existing one. The copy control and deep-link work WITHOUT
any CSP change (clipboard is CSP-ungoverned; deep-link is same-origin).

Observed in: AC3.2.

### S2 — No new infra / no new IAM / no new route in synth [UC2, UC3]

The CDK synth of `OxoGameProd`/`OxoOnlineProd`/`OxoOnlineWafUsEast1` is
UNCHANGED by this slice — assert WS route count stays 5 (no `$default`), no new
HTTP route, no new Lambda/table/principal/IAM grant, no `errorResponses` change.
The slice's diff is SPA app code only.

Observed in: AC3.3.

### S3 — Deep-link carries no auth token — capability-only [UC1, UC3]

The share URL is exactly `origin + "/join/" + code` — assert it contains NO
token/credential query param or fragment (only the code as a path segment).
Confirms the code-in-URL carries the SAME OR-H2-b capability, not a new
credential.

Observed in: AC1.2, AC3.5.

---

## Full acceptance-case list (all UCs)

### UC1 — copy-link control

- **AC1.1** [UC1, T3]: SPA component test — the "Copy link" control is present
  on the waiting screen when the 6-char game code is in state (stable selector;
  exact label or aria-label pinned).
- **AC1.2** [UC1, T3, S3]: SPA component test — clicking "Copy link" places a
  string of the form `<origin>/join/<code>` on the clipboard; no query param or
  fragment is appended.
- **AC1.3** [UC1]: SPA component test — the button label reads "Copied!" within
  ~200ms of clicking; after approximately 2 seconds it reverts to the original
  label.
- **AC1.4** [UC1]: SPA component test — the 6-char code remains visible as plain
  text on the waiting screen after the copy interaction.
- **AC1.5** [UC1, UC3, T3]: Playwright smoke — on the deployed HTTPS origin,
  clicking the copy control places `https://<domain>/join/<6-char-code>` on the
  clipboard (clipboard read or navigation-based assertion); code remains visible.

### UC2 — deep-link route + pre-fill + one-click join

- **AC2.1** [UC2, T2]: SPA component test — mounting the join screen with a
  `:code` URL parameter pre-fills the code input with that value and enables
  the "Join" button without any user interaction.
- **AC2.2** [UC2, T2]: SPA component test — clicking "Join" once on the
  pre-filled join screen triggers the WS `join` action with the pre-filled code
  (same WS spy assertion as s005/s006; no new action key or payload field).
- **AC2.3** [UC2, T4]: SPA component test — when the WS join response is
  `code-not-found`, the join screen displays "Game not found. The link may have
  expired or already been used." (stable selector; exact text pinned).
- **AC2.4** [UC2, UC3, T1]: Playwright smoke — fresh-tab navigation to deployed
  `https://<domain>/join/<valid-code>` returns HTTP 200 with the SPA (`index.html`
  body), NOT a CloudFront or S3 error page; join screen renders with code
  pre-filled and "Join" enabled.
- **AC2.5** [UC2, UC3, T2]: Playwright smoke — clicking "Join" once transitions
  both players (host and guest browser contexts) to the game board via the
  existing WS join path.
- **AC2.6** [UC2, UC3, T4]: Playwright smoke — navigating to `/join/XXXXXX`
  (invalid code) and submitting renders "Game not found. The link may have
  expired or already been used." with no crash and no generic 500/edge error.

### UC3 — validation (tester-owned, post-deploy)

- **AC3.1** [UC3, T5]: Playwright regression — the existing manual code-entry
  join flow (mode selector → type code → click Join) completes a join with no
  regression; the join screen reached without a URL param shows an empty code
  input (no spurious pre-fill).
- **AC3.2** [UC3, S1]: CSP assertion — the deployed `Content-Security-Policy`
  header is byte-for-byte the s005-h2 value; no new directive; no relaxation
  (specifically: no `clipboard-*` directive added; `connect-src` unchanged;
  `script-src` unchanged).
- **AC3.3** [UC3, S2]: Synth pin — CDK synth confirms WS route count = 5 (no
  `$default`), no new HTTP route, no new Lambda/table/principal/IAM grant, no
  `errorResponses` change vs. s007 baseline; s008 synth diff is SPA app bundle
  only.
- **AC3.4** [UC1, UC2, UC3, T6, F4]: C4 done-condition two-browser Playwright
  smoke — Player A creates game, copies share link; Player B navigates to the
  link in a separate browser context, code pre-filled, clicks "Join" once; both
  players see the game board; both play moves to a win or draw; elapsed time from
  Player A clicking "Create" to both seeing the result is under 5 minutes.
  **This case closes chunk C4.**
- **AC3.5** [UC1, UC3, S3]: S3 URL-form pin — the URL copied by UC1 is asserted
  to be exactly `<origin>/join/<code>` with no query param or fragment; the
  `<code>` segment is the 6-char game code and nothing else.

---

## Coverage map (T/S cases → use cases)

| UC | F-cases | T-cases | S-cases |
|----|---------|---------|---------|
| UC1 (copy-link control) | F1, F4 | T3 | S3 |
| UC2 (deep-link route + pre-fill) | F1, F2, F4 | T1, T2, T4 | S1, S2 |
| UC3 (prod validation) | F1, F2, F3, F4 | T1, T2, T3, T4, T5, T6 | S1, S2, S3 |

Counts: **4 F-cases, 6 T-cases, 3 S-cases** = **13 cases** in this file
(individual AC-ids: 5 in UC1, 6 in UC2, 5 in UC3 = **16 AC-ids total**).

---

## Open risks carried to prod validation

- **OR-S008-a — code-in-URL and browser history/referrer:** The `/join/<code>`
  URL puts the 6-char code into a shareable link and browser history. This is the
  SAME capability credential (OR-H2-b) in a different carrier — not a new trust
  boundary. The code is short-lived (24h TTL), single-use to join, and carries
  no auth/PII. The threat model is unchanged from today's screen-visible code.
  Closed by C6 (player identity) if an authenticated join is ever required.

- **OR-H2-b (inherited):** guest code-as-credential pre-join — unchanged, closed
  by C6 identity work.
