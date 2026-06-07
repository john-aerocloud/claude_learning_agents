# Delta 008 — share-link deep-route (CLIENT-ONLY / arch-lite)

## Decision: ARCH-LITE path APPLIES (§21) — CONFIRMED, not assumed

Product tagged this slice client-only and ruled OI-5 closed (path-route deep-link
on the existing CloudFront SPA origin; WS stays direct; no single-origin
proxying). The arch-lite path requires that the no-backend tag still holds: no new
data flow, no new principal, no new infrastructure. I confirmed each below — the
ONE load-bearing fact I VERIFIED (rather than assumed) is that the deployed
CloudFront distribution already SPA-falls-back an unknown path like
`/join/ABC123` to `index.html` (200) so React Router can route it client-side.

### VERIFICATION of the CloudFront SPA-fallback (the whole arch-lite claim rests on it)
Source of truth: `src/infra/lib/oxo-online-shell-stack.ts` lines 161–175
(`cloudfront.Distribution` `errorResponses`):

- `httpStatus: 403 → responseHttpStatus: 200, responsePagePath: '/index.html', ttl 0`
- `httpStatus: 404 → responseHttpStatus: 200, responsePagePath: '/index.html', ttl 0`

The S3 web bucket is private with Block Public Access + OAC only, so a GET for a
**non-existent key** such as `/join/ABC123` returns **403** from S3 → CloudFront
rewrites it to **200 + /index.html**. The SPA boots, React Router reads the path,
and `/join/:code` resolves client-side. The 404 mapping is belt-and-suspenders.
This is the EXISTING rule (built s001, asserted by `shell-stack.test.ts` and
`waf-us-east-1-stack.test.ts` as a cross-stack contract). **No `errorResponses`
change is needed for this slice — confirmed at the CDK source, not assumed.**

> Cross-stack dependency to PRESERVE (OI-31, carried): the WAF rate-rule block
> code MUST stay DISJOINT from the CF `CustomErrorResponses` list (403/404), else
> a WAF block would be rewritten to 200+index.html and become invisible
> (DEFECT-WAF-001; pinned by `shell-stack.test.ts`). This slice does NOT touch
> that rule; it only relies on the same 403→SPA fallback. Any FUTURE change to
> the fallback would silently break `/join/*` deep-links — noted so it is not
> changed blind.

**Conclusion: ARCH-LITE confirmed. No infra change. This is NOT a full delta.**

---

## What CHANGES (client / SPA only — `OxoOnlineProd` app code)

1. **React Router route `/join/:code`** — new client-side route. When the SPA
   loads on this path (direct navigation from a share link), it renders the join
   screen with the `:code` URL param pre-filled in the code input and the "Join"
   button enabled, so it is a one-click submit. Reuses the EXISTING join flow.
2. **Pre-fill + one-click join** — the `:code` param seeds the existing join form
   state; submitting runs the SAME WS `$connect?code` + `join` action path as
   manual entry (s005/s005-h2/s006). No new client→server contract.
3. **Copy-link control** on the waiting screen — a button next to the already-
   visible code that copies `window.location.origin + "/join/" + code` to the
   clipboard via `navigator.clipboard.writeText()`, with a ~2s "Copied!"
   confirmation. URL is constructed CLIENT-SIDE from the code already in hand; no
   backend call.
4. **Invalid-code error path** — navigating to `/join/<bad-code>` and submitting
   re-uses the EXISTING WS `code-not-found` error (s006/OI-33), surfaced as
   "Game not found. The link may have expired or already been used." No new server
   logic, no new error code, no crash/500.
5. **Manual code entry unchanged** — the existing `/join` (no param) / mode-selector
   path is untouched; no s005 regression.

## What does NOT change (confirm — no widening)
- **No backend change.** No Lambda, no handler body, no WS route (route count stays
  5, no `$default`), no HTTP route. The join WS action path is byte-for-byte s006.
- **No new infrastructure.** No CloudFront change (the 403/404→index.html fallback
  ALREADY serves `/join/*` — verified above), no S3 change, no API change, no
  DynamoDB change, no WAF change.
- **No IAM change.** No new principal, no new grant, no deploy-role change.
- **No new region.** All edge/compute as-is (eu-west-2 + the us-east-1 WAF stack).
- **WS stays DIRECT** — the share link only deep-links the SPA; the WSS connection
  is opened browser→API-Gateway-WSS as today (CloudFront NOT in the WS path).
  OI-5 (single-origin WS proxying) remains NOT required / deferred.
- **No CSP change** — see below.

## CSP — confirmed UNCHANGED
Current policy (`oxo-online-shell-stack.ts` line 120):
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://*.execute-api.<region>.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`

- **Copy-to-clipboard:** `navigator.clipboard.writeText()` is the async Clipboard
  API. **No CSP directive governs the Clipboard API** (there is no `clipboard-*`
  directive). It needs a secure context (HTTPS — satisfied; CloudFront is
  HTTPS-only) and the document focused — both already hold. **No CSP change.**
- **Deep-link `/join/<code>`:** same-origin navigation, served by the existing
  SPA bundle (`script-src 'self'`, `default-src 'self'`). No new origin, no new
  fetch/connect target — the WSS endpoint is the SAME already-allow-listed
  `wss://*.execute-api.<region>` host. `connect-src` unchanged.

**CSP CONFIRMED UNCHANGED — no new directive, no relaxation.**

---

## New-mechanism flag (process §30)
**NO new platform integration mechanism.** Every primitive is already in
production: CloudFront SPA-fallback routing (s001), React Router (SPA), the WS
`$connect?code` + `join` path (s005/s006). `navigator.clipboard` is a browser API,
not a system/platform integration mechanism, and is exercised purely client-side
with a local fallback (see local/prod gap). **No walking-skeleton probe required.**
The in-slice proof obligation is the functional smoke (SM-2/SM-5 two-browser
Playwright), an acceptance condition, not a skeleton probe.

## Local vs cloud-only gap (principles/02)
**Stands up LOCALLY (no cloud):**
- The `/join/:code` route, param-driven pre-fill, one-click-enable, and the
  copy-link control all run in the SPA against the local dev server / Vite preview.
- `navigator.clipboard` in tests: Playwright grants clipboard permission and reads
  it back (SM-1); a local fallback path (e.g. a hidden input + `select()`) is the
  insecure-context substitute if ever needed, so the control is testable locally.
- Invalid-code error rendering runs locally against the local WS adapter
  (reuses the s006 `code-not-found` branch).

**Cloud-only (cannot stand locally) — and the covering control:**
| Cloud-only item | Why | Covering control |
|---|---|---|
| CloudFront 403→200+`/index.html` SPA-fallback actually serving `/join/<code>` from the deployed distribution | CloudFront edge behaviour; S3-OAC 403-on-missing-key is cloud runtime | **Synth/source pin already present** (`shell-stack.test.ts`/`waf-us-east-1-stack.test.ts` assert the 403/404→200+index.html `errorResponses`) **+ prod functional smoke** (SM-2/SM-5: a fresh-tab navigation to a real deployed `/join/<code>` boots the SPA) |
| `navigator.clipboard` requiring a SECURE CONTEXT (HTTPS) | Browser gates the async Clipboard API to secure origins | CloudFront is HTTPS-only (viewer redirect-to-HTTPS, TLS1.2+) — **existing control**; SM-1 prod smoke reads the clipboard over the deployed HTTPS origin |

## Version-identifiable deployment (principles/01)
Deployable surface touched: **SPA only (CloudFront/S3)**. Build-identity carrier
is UNCHANGED — `window.OXO_CONFIG.buildSha` + `<meta name="build-sha">`
(s006/OI-25). The `/join` route, pre-fill, and copy control ship through the same
deploy step under the same carrier; **no new carrier, no new resource.**

## Retry/backoff posture per call (process §5a)
- **No new external call** is added by this slice. The deep-link join submit reuses
  the EXISTING WS `join` action and its s005/s006 posture (unchanged).
- **`navigator.clipboard.writeText()`** is a local browser API, not a network
  call. **No retry** — on rejection (denied permission / non-secure context) the
  control shows a non-blocking failure state and the code stays visible as plain
  text for manual copy (the existing fallback). No timeout budget needed (local,
  promise-bounded).

## §30 — cross-stack contract
**No new cross-stack handoff.** The s005 wss-URL + route-key/action contract is
unchanged (no new route key). The only consumed cross-stack fact is the EXISTING
CloudFront `errorResponses` SPA-fallback (within the shell stack; SYNTH-CONTRACT
already pins the WAF-block-code-disjoint-from-error-responses invariant).

## Deploy order & rollback posture
- **Deploy order unchanged.** This is an SPA-only artifact (`OxoOnlineProd`);
  no stack ordering change.
- **Rollback:** prior-artifact SPA redeploy removes the `/join` route + copy
  control; the deep-link path simply 200s into the SPA which then has no `/join`
  handler (falls to the default route) — graceful, no error, no orphaned state.
  No data/IAM/infra to roll back.

---

## Security conclusion (gates §9a)
See `architecture/security/cloudfront-distribution.md` (existing controls — the
SPA-fallback line is the one this slice depends on, unchanged) for the per-resource
checkable controls. No NEW security note file is created because no new
infrastructure is introduced. Conclusion sentence (verbatim in the return):

**Is there new attack surface / data flow / trust boundary? NO — this slice is
client-only: it adds an SPA route (`/join/:code`), a URL-param pre-fill, and a
copy-to-clipboard control, all running in the already-served SPA; it introduces NO
new public surface, NO new principal, NO new IAM grant, NO new infrastructure, NO
new CloudFront/WAF/CSP change (the 403/404→200+index.html SPA-fallback already
serves `/join/<code>`, verified at the CDK source; `navigator.clipboard` is
CSP-ungoverned and same-origin), and NO new data flow (the deep-link join reuses
the existing WS `$connect?code`+`join` path unchanged); the only NEW carrier of a
game code is a shareable URL, which carries the SAME capability already shown on
screen and typed today (OR-H2-b: the code is a pre-join capability credential,
closed by C6) — the same capability in a different carrier, so the threat model is
UNCHANGED; therefore this is a §9a AUTO-ACCEPT (no new attack surface / data flow /
trust boundary).**

### Code-in-URL threat-model note (the question Product flagged)
A `/join/<code>` URL puts the 6-char game code into a shareable link, browser
history, and possibly referrer/server logs of whoever the link passes through.
**Is this a NEW exposure beyond the code already being shown on screen and typed?**
**No — it is the SAME capability credential (OR-H2-b) in a different carrier.**
The code was ALREADY a pre-join capability anyone holding it could use to join
(that is the whole point of the share-link job, and the reason it is a low-value,
short-lived credential): it is displayed in plaintext on the host's waiting screen
and read out / messaged out-of-band today. The properties that bound the risk are
UNCHANGED by this slice:
- **Short-lived:** the code is bound to a game that expires at the 24h `Games` TTL
  (and a joined/abandoned game cannot be re-joined) — an old link/history entry
  expires with the game.
- **Single-use to join:** once a guest joins, the code no longer admits a second
  joiner (the s005 conditional `UpdateItem` waiting→active gate).
- **No auth/PII:** the code is NOT an auth token and carries no identity; the share
  link explicitly carries NO auth token (slice §NOT-in-scope) — it only pre-fills
  the code, the join auth path is unchanged from s005-h2.
- **Same exposure class:** screen-shoulder-surfing / message-forwarding of a typed
  code is already possible; a URL in history/referrer is the same exposure class,
  not a new trust boundary. C6 (player identity) is the slice that would turn a
  join into an authenticated action; until then the code's threat model is what
  OR-H2-b already records. **No threat-model change; no new control required.**

This conclusion is a clean "no new attack surface / data flow / trust boundary" —
it **auto-accepts under §9a** (standing approval). No new control or risk is
surfaced for human review.

---

## Acceptance — technical/observable conditions (I contribute these; co-authored with product)
T = technical/observable; S = security-policy (becomes a policy test).

- **T1 (deep-link boots the SPA on the deployed origin):** A fresh-tab navigation
  to a real deployed `https://<domain>/join/<code>` returns the SPA (HTTP 200,
  `index.html` body) — i.e. CloudFront's 403/404→200+index.html fallback serves
  the unknown path — and the SPA renders the join screen, NOT a CloudFront/S3
  error page (SM-2; the cloud-only CloudFront-fallback covering control).
- **T2 (pre-fill + one-click enable):** On `/join/<code>`, the code input is
  pre-filled with `<code>` from the URL and the "Join" button is enabled with no
  user interaction; clicking it once submits the join and both players reach the
  board via the SAME WS join path as manual entry (SM-2).
- **T3 (copy-link copies a valid URL):** On the waiting screen the copy control is
  present; clicking it places `https://<domain>/join/<6-char-code>` on the
  clipboard (Playwright clipboard read or navigation-based assertion); the code
  remains visible as plain text (SM-1).
- **T4 (invalid code → readable error, no crash):** Navigating to
  `/join/XXXXXX` (not a valid waiting-game code) and submitting renders the join
  screen with "Game not found. The link may have expired or already been used."
  visible; the page does not crash or show a generic 500/edge-error (SM-3; reuses
  the s006 `code-not-found` branch).
- **T5 (manual entry unaffected — no s005 regression):** The existing manual
  code-entry join flow (mode selector → type code) still completes a join with no
  regression on s005 acceptance cases (SM-4).
- **T6 (C4 done-condition end-to-end):** Player A creates a game, copies the share
  link; Player B (separate browser/session) opens the link, one-click joins, and
  both play a full game to the result screen — intent-to-result under 5 minutes
  in a two-browser Playwright smoke (SM-5; the C4 done-condition proof).

- **S1 (no CSP change / no new directive):** The deployed
  `Content-Security-Policy` response header is byte-for-byte the s005-h2 value
  (`default-src 'self'; … connect-src 'self' wss://*.execute-api.<region>.amazonaws.com; …`)
  — assert NO new directive and NO relaxation of an existing one. The copy
  control and deep-link work WITHOUT any CSP change (clipboard is CSP-ungoverned;
  deep-link is same-origin).
- **S2 (no new infra / no new IAM / no new route in synth):** The CDK synth of
  `OxoGameProd`/`OxoOnlineProd`/`OxoOnlineWafUsEast1` is UNCHANGED by this slice —
  assert WS route count stays 5 (no `$default`), no new HTTP route, no new
  Lambda/table/principal/IAM grant, no `errorResponses` change. The slice's diff
  is SPA app code only.
- **S3 (deep-link carries no auth token — capability-only):** The share URL is
  exactly `origin + "/join/" + code` — assert it contains NO token/credential
  query param or fragment (only the code as a path segment). Confirms the
  code-in-URL carries the SAME OR-H2-b capability, not a new credential.
