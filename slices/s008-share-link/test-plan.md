---
slice: s008-share-link
iteration: 11
tester: claude-sonnet-4-6
last-validated-sha: 5cfe6d6
sha-under-test: 1b138ed (acceptance reconcile); deployed build sha c69140a78b2a0335977e61cd6bcd0a8a1496b466
date: 2026-06-07
status: PASS
---

# Test Plan — s008 share-link (UC3 validation, C4 done-condition)

## Change map derivation

### class-deps.mmd diff (5cfe6d6 → HEAD)
Changed nodes (s008changed classDef):
- `spaJoinRoute` — new node: App.tsx /join/:code route, mounts GameRoot(joining) with initialJoinCode @covers AC2.1, AC2.4, AC2.5, AC3.1
- `spaCopyLink` — new node: GameRoot.tsx waiting-screen copy control, navigator.clipboard.writeText(origin+'/join/'+code) @covers AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC3.5
- Edge: `spaJoinRoute →|initialJoinCode → spaJoinScreen reuses existing submit| spaJoinScreen` @covers T1/T2
- Edge: `spaCopyLink →|share URL mirrors /join/:code route form| spaJoinRoute` @covers T3/S3

Also present from diff (s007/s007a nodes — CLEARED in the classDef before HEAD):
- All s007changed and s007aChanged nodes render as stable green (already cleared)

### data-flow.mmd diff (5cfe6d6 → HEAD)
Changed marks: `class cfwaf changed` — the existing SPA-fallback (403/404→200+index.html)
now ALSO serves /join/<code> for React Router client-side resolution.
@covers T1/SM-2/AC2.4 — deep-link boots the SPA via CloudFront fallback

### use-case-deps.mmd diff (5cfe6d6 → HEAD)
New nodes (s008 changed):
- `S8UC1` — copy-link control @covers T3/AC1.x
- `S8UC2` — deep-link route + pre-fill + one-click join @covers T1/T2/T4/AC2.x
- `S8UC3` — validation @covers T5/T6/S1/S2/S3/AC3.x

---

## Scope: changed nodes → test items

| Changed node/edge | Coverage spec | Status |
|-------------------|---------------|--------|
| spaJoinRoute (new) | smoke/slice008-share-link.spec.ts AC2.4, AC2.5; skeleton join.skeleton.spec.ts T1 | [x] PASS |
| spaCopyLink (new) | smoke/slice008-share-link.spec.ts AC1.5/AC3.5 | [x] PASS |
| spaJoinRoute→spaJoinScreen edge | smoke/slice008-share-link.spec.ts AC2.5 (join completes via existing WS) | [x] PASS |
| spaCopyLink→spaJoinRoute edge (URL form) | smoke/slice008-share-link.spec.ts AC3.5 | [x] PASS |
| cfwaf changed (deep-link fallback) | skeleton join.skeleton.spec.ts T1 | [x] PASS |
| S8UC1 (copy-link) | smoke AC1.5 + component tests AC1.1-AC1.4 (vitest) | [x] PASS |
| S8UC2 (deep-link) | skeleton T1 + smoke AC2.4/AC2.5/AC2.6 | [x] PASS |
| S8UC3 (validation) | all S-cases; AC3.1 regression; AC3.4 C4 done-condition | [x] PASS |

---

## Identity check (principles/01)
- [x] SPA meta[name="build-sha"] = c69140a78b2a0335977e61cd6bcd0a8a1496b466 (matches s008 deploy)

---

## Rate-limiting budget
WAF exemption added: 88.97.176.116/32 (CIDR). Removed after run: confirmed clean.
Budget state at run start: rate window not exhausted (added exemption before WS tests).

---

## Test items (tick-off)

### Identity
- [x] **ID-1**: meta[name="build-sha"] = c69140a78b2a0335977e61cd6bcd0a8a1496b466 PASS

### T3/UC1/SM-1 — Copy-link control (S3, AC1.2/AC1.5/AC3.5)
- [x] **T3a**: Copy control present (`[data-testid="copy-link"]`, aria-label="copy game link") PASS
- [x] **T3b**: Clipboard = `https://d3pf3kcvzpau1x.cloudfront.net/join/ZS6Q95` — no query param, no fragment PASS
- [x] **T3c**: Code `ZS6Q95` visible as `[data-testid="game-code"]` after copy PASS

### T1/T2/UC2/SM-2 — Deep-link route + pre-fill + one-click join (AC2.4/AC2.5)
- [x] **T1**: `/join/3Q8UEA` returns HTTP 200 (SPA boots); join screen renders with code pre-filled PASS (join.skeleton)
- [x] **T2a**: `#join-code` pre-filled with code from URL; `button.join-submit` enabled PASS
- [x] **T2b**: One click Join → host=X, guest=O in 295ms PASS

### T4/SM-3/AC2.3/AC2.6 — Invalid code → readable error, no crash
- [x] **T4**: `/join/XXXXXX` + submit → "Game not found. Check the code and try again." + no crash PASS
  - Note: WS 403 console error from authorizer is EXPECTED (OI-33 signal); spec updated to allow it

### T5/SM-4/AC3.1 — Manual code entry regression
- [x] **T5**: Mode selector → Join a game → empty `#join-code`; no spurious pre-fill PASS

### S1/AC3.2 — CSP byte-for-byte pin
- [x] **S1**: CSP = s005-h2 value byte-for-byte; no clipboard-*; connect-src unchanged; script-src unchanged PASS

### S2/AC3.3 — Synth/no-new-infra pin
- [x] **S2**: WS routes = 5 ($connect, $disconnect, join, move, register); no $default PASS
- [x] **S2**: CloudFront errorResponses = 2 entries (403→200, 404→200, TTL=0) PASS
- [x] **S2**: Lambda functions (oxo-game-fn, oxo-ws-fn, oxo-ws-auth-fn) unchanged PASS
- [x] **S2**: DynamoDB tables (oxo-games, oxo-connections, oxo-connect-attempts) unchanged PASS

### SM-5/T6/AC3.4 — C4 done-condition two-browser end-to-end
- [x] **T6**: Player A creates → copies share link → Player B opens URL → code pre-filled → one click → both on board → X wins (square 0,1,2 top row) → both see result. Elapsed = **2323ms (2.3s)** << 300000ms (5 min). PASS. C4 DONE.

---

## Stale-spec findings (not s008 defects)

Two pre-existing smoke specs (s006 and s007 identity checks) fail because they hardcode the OLD s007 sha (e078ea4b) but the deployed sha is now c69140a (s008 deploy). These are stale DEPLOY_SHA constants in prior-slice specs — a spec-relevancy issue noted per process §37 (review at retro). Classification: DISTRIBUTION condition per spec logic, not a behavioural failure. Not an s008 defect.

---

## Budget: WAF exemption cleanup confirmed
- Added: 88.97.176.116/32 before WS-consuming tests
- Removed: confirmed clean (waf-runner-ip-ok + waf-runner-ip-exemption-ok)
