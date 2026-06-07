---
slice: s008
slug: share-link
process-ref: §37
co-authored: product + solution-architect
---

# Use cases — s008: share-link UX

Use cases are separately buildable and separately testable. Dependency edges are
listed only where a genuine build or deploy dependency exists.

## Parallelism honest call

UC1 and UC2 are SERIAL, not parallel. Both touch the same SPA component area:
the join/code screens and the React Router route configuration. UC1 adds the
copy-link control to the waiting/code screen; UC2 adds the `/join/:code` route
and pre-fill logic that enables one-click join. These are the same files — the
waiting screen that shows the code is adjacent to or the same component as the
join screen that receives the deep-linked code. A single engineer will touch them
in sequence, and a false-parallel call here would cause merge conflicts.

The practical cut: do UC2 (route + pre-fill) first since it defines the URL
structure the copy-link control references; UC1 (copy-link) then wires
`window.location.origin + "/join/" + code` which is already validated by UC2's
route. Either order works at the file level, but UC2's route defines the
canonical path format that UC1's URL construction must match.

UC3 is tester-owned post-deploy validation; it has no build artifact to produce
and cannot run until UC1 and UC2 are deployed.

```
SERIAL SEAM (same SPA files — single engineer):
  UC2 → UC1 (UC2 defines route path; UC1 copies it into clipboard URL)

AFTER UC1 + UC2 deployed to prod:
  UC3 — validation (tester-owned; requires both SPA changes live)
```

---

## UC1 — Copy-link control on the waiting screen

**ID:** UC1
**Actor:** Host player (browser, waiting screen after game creation)
**Trigger:** Host sees the waiting screen with the 6-char code displayed and
clicks the "Copy link" control.

### Trigger -> observable outcome

On the waiting screen (already shows the 6-char code and "waiting for opponent"
indicator):
1. A "Copy link" button/icon control is present immediately adjacent to the code.
2. Clicking it places `window.location.origin + "/join/" + code` on the clipboard
   via `navigator.clipboard.writeText()`.
3. The button label changes to "Copied!" for approximately 2 seconds, then reverts.
4. The 6-char code remains visible as plain text (unchanged — the code is not
   replaced or hidden by the copy interaction).
5. If `navigator.clipboard` is unavailable (non-secure context / permission
   denied), the control shows a non-blocking failure state and the code stays
   visible for manual copy — the fallback is the code itself.

URL construction is entirely client-side from the code already in state. No
backend call. The constructed URL matches the UC2 route form exactly:
`https://<domain>/join/<code>`.

The `S3` condition from the delta is encoded here: the URL carries the code as a
path segment only, with no token/credential query param or fragment.

### Done condition

- SPA component test: the copy control is present on the waiting screen.
- SPA component test: clicking the copy control places `<origin>/join/<code>` on
  the clipboard (Playwright clipboard read or navigation-based assertion).
- SPA component test: the button label shows "Copied!" immediately after clicking.
- SPA component test: the code remains visible as plain text after the copy
  interaction.
- T3 passes (Playwright clipboard assertion on deployed origin — SM-1).
- S3 passes (URL asserted to contain no token/credential query param or fragment).

### Acceptance cases

- AC1.1: SPA component test — the "Copy link" control is present on the waiting
  screen when the 6-char game code is in state (stable selector; exact label or
  aria-label pinned).
- AC1.2: SPA component test — clicking "Copy link" places a string of the form
  `<origin>/join/<code>` on the clipboard; the code is the 6-char code from SPA
  state; no query param or fragment is appended (S3).
- AC1.3: SPA component test — the button label (or its visible text) reads
  "Copied!" within ~200ms of clicking; after approximately 2 seconds it reverts
  to the original label.
- AC1.4: SPA component test — the 6-char code is still visible as plain text on
  the waiting screen after the copy interaction (the code display is not cleared
  or hidden by the copy event).
- AC1.5: Playwright smoke (T3 / SM-1) — on the deployed HTTPS origin, clicking
  the copy control places `https://<domain>/join/<6-char-code>` on the clipboard
  (Playwright `page.evaluate(() => navigator.clipboard.readText())` or
  navigation-based assertion); the code remains visible as plain text.

### Dependencies

- UC2 defines the canonical route path (`/join/:code`); UC1's URL construction
  must match it. UC1 is built after UC2's route form is confirmed (same PR or
  same sequential commit — no formal build gate, just ordering within the same
  engineer's work).
- No dependency on UC3 (tester-owned validation).

---

## UC2 — Deep-link route + pre-fill + one-click join (and invalid-code error)

**ID:** UC2
**Actor:** Guest player (browser, navigating directly to `/join/<code>` from a
share link — fresh tab, no prior app state) AND tester (invalid-code error path)
**Trigger:** Browser navigates to `https://<domain>/join/<code>` from a share
link (CloudFront 403→200+index.html SPA-fallback boots the SPA; React Router
reads the path).

### Trigger -> observable outcome

**Happy path (valid code):**
1. The SPA loads on `/join/:code`. React Router renders the join screen.
2. The code input field is pre-filled with `<code>` from the URL parameter.
3. The "Join" button is enabled immediately — no user interaction required to
   enable it.
4. Clicking "Join" once submits the join request via the EXISTING WS
   `$connect?code` + `join` action path (byte-for-byte s005/s006 — no new
   client→server contract).
5. Both players transition to the game board — same observable outcome as manual
   join (SM-2).

**Invalid-code path:**
1. Browser navigates to `/join/XXXXXX` (not a valid waiting-game code).
2. SPA renders the join screen with the code pre-filled.
3. User (or auto-submit) attempts to join; server returns the existing
   `code-not-found` error (s006/OI-33).
4. The join screen displays the readable error: "Game not found. The link may
   have expired or already been used." (SM-3).
5. Page does not crash; no generic 500 or CloudFront/S3 error page is shown.

**CloudFront deep-link routing (cloud-only, covered by synth pin):**
The deployed CloudFront distribution's existing `errorResponses`
(403→200+index.html, 404→200+index.html) already serves `/join/<code>` as the
SPA. No CloudFront change is needed. This is verified at the CDK source and
pinned by `shell-stack.test.ts` (T1 cloud-only covering control).

### Done condition

- SPA component test: on mount with a `:code` URL param, the code input is
  pre-filled and the "Join" button is enabled.
- SPA component test: clicking "Join" once triggers the WS join action (same spy
  assertions as s005/s006 join tests).
- SPA component test: when the WS join returns `code-not-found`, the error
  message is visible.
- T1 passes: fresh-tab navigation to deployed `/join/<code>` returns the SPA
  (HTTP 200, `index.html`) — CloudFront fallback confirmed live.
- T2 passes: code input pre-filled, "Join" button enabled, one-click join
  transitions both players to the board (SM-2).
- T4 passes: invalid code → readable error, no crash (SM-3).

### Acceptance cases

- AC2.1: SPA component test — mounting the join screen with a `:code` URL
  parameter pre-fills the code input with that value and enables the "Join"
  button without any user interaction (pre-fill from URL param; T2/SM-2).
- AC2.2: SPA component test — clicking "Join" once on the pre-filled join screen
  triggers the WS `join` action with the pre-filled code (same WS spy assertion
  as s005/s006 join; no new action key or payload field).
- AC2.3: SPA component test — when the WS join response is `code-not-found`, the
  join screen displays the text "Game not found. The link may have expired or
  already been used." (T4/SM-3; stable selector; exact text pinned).
- AC2.4: Playwright smoke (T1 / SM-2) — a fresh-tab navigation to the deployed
  `https://<domain>/join/<valid-code>` returns HTTP 200 with the SPA
  (`index.html` body), NOT a CloudFront or S3 error page; the join screen renders
  with the code pre-filled and "Join" enabled.
- AC2.5: Playwright smoke (T2 / SM-2) — clicking "Join" once on the pre-filled
  join screen (from the share link) transitions both players (host and guest
  browser contexts) to the game board via the existing WS join path.
- AC2.6: Playwright smoke (T4 / SM-3) — navigating to `/join/XXXXXX` (invalid
  code) and submitting renders "Game not found. The link may have expired or
  already been used." with no crash and no generic 500/edge error.

### Dependencies

- The CloudFront SPA-fallback (403/404→200+index.html) is already live from
  s001 and pinned by `shell-stack.test.ts`. No new infra action required.
- The existing WS join path (s005/s006) is unchanged. UC2 reuses it.
- No dependency on UC1 at build time; UC2 is sequenced first (serial seam, same
  files — UC2 defines the route form UC1's URL construction mirrors).
- UC3 depends on UC2 being deployed (the deep-link smoke requires the live route).

---

## UC3 — Validation: manual-entry regression, CSP+synth pins, C4 done-condition smoke

**ID:** UC3
**Actor:** Tester (prod validation spec, post-deploy); automated CI
**Trigger:** Post-deploy validation run, after UC1 and UC2 are deployed to prod.

### Trigger -> observable outcome

The tester exercises five areas:

1. **Manual-entry regression (T5 / SM-4):** The existing join flow (mode selector
   → type code manually on the join screen reached without a URL param) still
   completes a join. No regression on s005 acceptance cases. The `/join/:code`
   route addition has not removed or broken the parameterless join screen.

2. **CSP pin (S1):** The deployed `Content-Security-Policy` response header is
   byte-for-byte the s005-h2 value — no new directive, no relaxation. Assert
   the copy control and deep-link work without any CSP change (clipboard is
   CSP-ungoverned; deep-link is same-origin).

3. **Synth/no-new-infra pin (S2):** The CDK synth of
   `OxoGameProd`/`OxoOnlineProd`/`OxoOnlineWafUsEast1` is unchanged — WS route
   count stays 5 (no `$default`), no new HTTP route, no new Lambda/table/
   principal/IAM grant, no `errorResponses` change. The s008 diff is SPA app
   code only.

4. **C4 done-condition end-to-end (T6 / SM-5):** Two-browser Playwright smoke:
   Player A creates a game, copies the share link; Player B (separate
   browser/session) navigates to the link, one-click joins, and both play a
   full game to the result screen. Elapsed time from Player A clicking "Create"
   to both players seeing the result screen is under 5 minutes. This is the C4
   done-condition proof.

5. **S3 URL form pin:** The share URL produced by UC1's copy control is exactly
   `origin + "/join/" + code` — assert it contains NO token/credential query
   param or fragment (capability-only, not a new credential).

### Done condition

All acceptance cases below pass. SM-1 through SM-5 from slice.md are all green.
The C4 done condition is closed: two players in separate browsers complete a
full game via share link in under 5 minutes.

### Acceptance cases

- AC3.1: Playwright regression (T5 / SM-4) — the existing manual code-entry join
  flow (mode selector → type code → click Join) still completes a join with no
  regression; the join screen reached without a URL param shows an empty code
  input (no spurious pre-fill from a prior navigation).
- AC3.2: CSP assertion (S1) — a Playwright/curl assertion on the deployed origin
  reads the `Content-Security-Policy` response header and confirms it is
  byte-for-byte the s005-h2 value with no new directive and no relaxation
  (specifically: no `clipboard-*` directive added; `connect-src` unchanged;
  `script-src` unchanged).
- AC3.3: Synth/no-new-infra pin (S2) — CDK synth confirms WS route count = 5
  (no `$default`), no new HTTP route, no new Lambda/table/principal/IAM grant,
  no `errorResponses` change vs. the s007 baseline; the s008 synth diff is
  limited to SPA app bundle changes only.
- AC3.4: C4 done-condition smoke (T6 / SM-5) — two-browser Playwright smoke:
  Player A creates a game, copies the share link (UC1); Player B navigates to
  the link in a separate browser context, the code is pre-filled, Player B
  clicks "Join" once (UC2); both players see the game board; both play moves to
  a win or draw result screen; elapsed time from Player A clicking "Create" to
  both players seeing the result is under 5 minutes.
- AC3.5: S3 URL-form pin — the URL copied to clipboard by UC1 is asserted to be
  exactly `<origin>/join/<code>` with no query param or fragment; the `<code>`
  segment is the 6-char game code and nothing else.

### Dependencies

- UC1 must be deployed (copy-link control present on waiting screen).
- UC2 must be deployed (deep-link route live; one-click join works from shared
  link in a fresh browser context).
- No build artifact to produce — tester-owned validation spec run post-deploy.

---

## Dependency summary

```
UC2 (route + pre-fill + error)  — no cloud-infra dependency; builds against existing WS path
UC1 (copy-link control)         — serial after UC2 (route path form reference); same SPA files
UC3 (prod validation)           — requires UC1 + UC2 deployed to prod
```

Serial order for the engineer: UC2 first (route/pre-fill defines the URL form),
UC1 second (copy-link uses that URL form). Total SPA changeset is small — likely
one or two component files and the router config. No parallelism is possible or
needed within the SPA work; the serialisation is the honest call.

UC3 runs after both are live in prod. The C4 done-condition (AC3.4) is the
closing gate for chunk C4.

---

## Infra enabler notes (co-decided with solution-architect; arch-lite confirmed)

1. **No CloudFront change.** The existing 403/404→200+index.html `errorResponses`
   already serves `/join/<code>` as the SPA. Pinned by `shell-stack.test.ts`.
   OI-31 dependency noted: any future change to the fallback would silently break
   deep-link routing — do not change the fallback without updating this note.

2. **No new backend route.** WS route count stays 5. The join action path is
   byte-for-byte s005/s006.

3. **No CSP change.** `navigator.clipboard` is CSP-ungoverned. Deep-link is
   same-origin. Confirmed at CDK source.

4. **No new infra.** No Lambda, no table, no IAM grant, no WAF change, no new
   region, no new CloudFront rule.

5. **Clipboard API posture.** `navigator.clipboard.writeText()` is a local
   browser API; no network call; no retry. On rejection the code stays visible
   as plain text — existing fallback. Requires HTTPS (secure context) — already
   guaranteed by CloudFront HTTPS-only redirect.

6. **Rollback.** Prior-artifact SPA redeploy removes the `/join` route + copy
   control. A navigated `/join/<code>` in the rolled-back SPA falls to the
   default route (graceful, no error). No data/IAM/infra to roll back.
