---
slice: s009
slug: arcade-scoreboard
gate: GATE-2-S009 (approved) + GATE-3-S009 (§9a auto-accept)
co-authored: product + solution-architect + ui-designer
defect-closed: DEFECT-S008-002 (two copy controls — copy-code + copy-link)
---

# Acceptance — s009: arcade scoreboard (name entry + record + shared display)

Four case classes:

- **F-cases (customer-observable):** the conditions a real user in two real
  browsers experiences. The headline: enter a name, play a game, see your name
  on a shared board readable in another browser within 10 seconds.
- **T-LB cases (technical / observable):** lifted verbatim-or-tightened from
  delta 010 T-LB-1..12. Encode the Leaderboard table contract, idempotency
  crux, name propagation, read path, and IAM/XSS pins.
- **WCAG cases (accessibility):** lifted from ui-design.md A11Y-1..12 (WCAG
  2.2 AA). Cover the name field, leaderboard table semantics, live regions,
  and the display-XSS pin.
- **DEFECT-S008-002 cases:** two copy affordances ("Copy code" and "Copy link")
  on the waiting screen. Root cause: the share flow was modelled from the
  sharer's side only (EXP-015); the guest has TWO join paths and each needs its
  own control. Closes via s009 delivery.

Every case is tagged to its use case(s). The coverage map at the end shows
distribution across UCs.

---

## F-cases — customer-observable

### F1 — Name appears on shared board in another browser within 10 s (SM-1) [UC1, UC2, UC3, UC5]

Party A enters name "ACE" and plays a game to completion (A wins). In Party B's
separate browser, on the idle-screen leaderboard, "ACE" appears with wins=1
within 10 seconds of game-over. This is the primary customer-visible measure:
the arcade moment — enter initials, finish the game, see your name on the shared
board. It was impossible before this slice.

The ≤10s SLA is delivered by the composition of the DynamoDB Stream propagation
(typically <1s) and the CloudFront 5s TTL on `GET /api/leaderboard`.

Observed in: AC5.1, AC5.2 (two-browser Playwright smoke).

### F2 — Name defaults to "AAA" with no gate to starting (SM-3) [UC1, UC5]

A player who leaves the name field empty (or blank) can create or join a game
without any friction. "AAA" is used as the default name — the leaderboard
records their result under "AAA". No error, no blocking validation, no mandatory
keystroke required to start. The field is ignorable (arcade UX).

Observed in: AC5.4.

### F3 — Name collisions accumulate on one shared row (SM-2) [UC2, UC5]

Two separate players who both enter "AAA" and complete games (one wins, one
draws) see a single "AAA" row on the leaderboard with the combined tally
(1W + 1D). No error is returned for name reuse. The arcade model explicitly
accepts collision — it is not a bug.

Observed in: AC5.3.

### F4 — One tally per game, no double-count on replay (SM-4) [UC2, UC5]

Replaying the same game-over stream record a second time does NOT increment any
tally counter. The Leaderboard item after replay is byte-identical to after first
processing. At-least-once stream delivery is neutralised by the conditional
`scoredGames` set-marker.

Observed in: AC5.5.

### F5 — Abandoned games produce no tally (SM-5) [UC2, UC5]

A game that ends via a `$disconnect` (status→abandoned, s007 path) records no
win, draw, or loss for either player. The leaderboard is unaffected.

Observed in: AC5.6.

### F6 — Game-over flow unaffected by name capture (SM-6) [UC2, UC5]

The `game-over` WebSocket message is still delivered to both players within 1s
p95. The DynamoDB Stream / board-fn write is fully off the hot path — a
board-fn failure does not fail the game.

Observed in: AC5.7.

### F7 — Leaderboard loads within 2 s p95 on title screen (SM-7) [UC3, UC5]

A fresh page load of the title screen fetches and renders the leaderboard panel
within 2 seconds p95.

Observed in: AC5.8.

### F8 — Name persists within tab session (SM-8) [UC1, UC5]

After entering a name and completing a game, a player who returns to the title
screen and initiates another game finds the name field pre-filled with the
previously entered name (from `sessionStorage`). No re-entry required.

Observed in: AC5.9.

### F9 — Two copy affordances serve both guest join paths (DEFECT-S008-002 closure) [UC4, UC5]

The waiting screen provides TWO distinct copy controls:
- "Copy code" — copies the 6-char game code (for a guest who will TYPE it).
- "Copy link" — copies the `/join/:code` URL (for a guest who will CLICK it).

Each copies the correct thing. The prior defect (one control, copying the URL,
labelled in a way that suggested the code) does not recur.

Observed in: AC5.10.

### F10 — Manual play modes unaffected [UC1, UC3, UC4, UC5]

Local two-player and vs-AI games complete without regression. The name field and
leaderboard are new in the idle view but do not gate or disrupt local/AI play.

Observed in: (Playwright regression specs, unaffected path).

---

## T-LB cases — technical / observable

T-LB cases are lifted verbatim-or-tightened from delta 010 T-LB-1..12. Each
carries its original T-LB id.

### T-LB-1 — Leaderboard table configuration [UC2]

`Leaderboard` exists in eu-west-2 (`OxoGameProd`), PK `playerName` (S), SSE on,
**PITR ENABLED**, **NO TTL attribute**, on-demand billing. This is the system's
first and only non-TTL (durable) table. PITR is a binding requirement, not an
option. Asserted by synth test.

Observed in: AC2.1.

### T-LB-2 — Name propagation onto Games [UC1]

After `POST /api/games {playerName:"ACE"}`, the `Games` item has `hostName="ACE"`.
After WS `join {playerName:"BEE"}`, the same item has `guestName="BEE"`. Blank or
omitted `playerName` → `"AAA"` (SM-3). Names longer than 10 chars are truncated
server-side; `<>&"'` and control chars are stripped per the pinned charset. Play is
never blocked over a name violation.

Observed in: AC1.3, AC1.4, AC1.5, AC1.7, AC1.8, AC1.9.

### T-LB-3 — Idempotency pin: replay does not double-count (SM-4 crux) [UC2, UC5]

Drive one real game-over → each participant's counter +1 and `scoredGames`
contains the gameId. **Replay the SAME game-over stream record → both Leaderboard
rows BYTE-IDENTICAL to after first processing.** No counter moved.
`ConditionalCheckFailed` observed in `oxo-board-fn` logs. The conditional
`UpdateItem` MUST carry `ConditionExpression NOT contains(scoredGames, :gameId)`.

Observed in: AC2.7 (unit), AC2.11 (cloud), AC5.5 (prod validation).

### T-LB-4 — Name-collision accumulation (SM-2) [UC2, UC5]

Two distinct games for name "AAA" (one won, one drawn) → ONE `AAA` row showing
combined tally (wins=1, draws=1), not two rows. Each game's `gameId` is a
separate entry in `AAA.scoredGames`.

Observed in: AC2.8 (unit), AC2.12 (cloud), AC5.3 (prod validation).

### T-LB-5 — Abandoned games produce no Leaderboard write (SM-5) [UC2, UC5]

A game that goes `active→abandoned` (s007 `$disconnect` path) produces NO
`Leaderboard` write or increment for either name. The stream filter
(`OLD.status=active AND NEW.status∈{won,drawn}`) excludes the abandoned
transition.

Observed in: AC2.6 (unit), AC2.13 (cloud), AC5.6 (prod validation).

### T-LB-6 — Read path and cache [UC3]

`GET /api/leaderboard` returns top-20 ordered wins desc / losses asc / name asc,
with `buildSha` in the body. The `/api/leaderboard` CloudFront behaviour has
min/default/max TTL = 5s (synth-asserted). `POST /api/games` stays CachingDisabled.

Observed in: AC3.6 (synth), AC3.7 (synth/policy), AC3.8 (cloud).

### T-LB-7 — SM-1 cross-browser within 10 s (functional assertion) [UC5]

Party A completes a game as "ACE"; within 10 s Party B's idle-screen leaderboard
fetch shows "ACE" + correct tally. (The automated ≤10s proof is s010; this is
the functional Playwright smoke assertion in this slice.)

Observed in: AC5.1.

### T-LB-8 — Stored-XSS display pin [UC3, UC5]

A name `<img src=x onerror=alert(1)>` (or its charset-stripped form) recorded
and then rendered on the leaderboard does NOT execute script in the viewing
browser. The SPA renders names as escaped text. **NO `dangerouslySetInnerHTML`
on the leaderboard name** (code-policy pin). React's default text escaping
(`{entry.name}` in JSX) is the primary control; the write-side charset bound is
defence-in-depth.

Observed in: AC3.3 (SPA component), AC5.11 (prod validation).

### T-LB-9 — IAM no-widening pin [UC2]

`oxo-board-fn` role = stream-read on Games-stream ARN + `dynamodb:UpdateItem` on
Leaderboard ARN only. NO Games table grant, NO `Scan`/`Query`/`DeleteItem` on
Leaderboard, NO wildcard. `oxo-game-fn` += `dynamodb:Scan` on Leaderboard ARN
only (no other Leaderboard action; existing grants unchanged). **`oxo-ws-fn`
gains NOTHING.** `oxo-deploy` += scoped `UpdateFunctionCode` on board-fn ARN
only; no `iam:*`. Synth/policy-assert.

Observed in: AC2.3 (synth), AC3.7 (synth/policy), AC5.12 (prod validation).

### T-LB-10 — §30 walking-skeleton probe (first DynamoDB Stream) [UC2]

Probe A (real game-over → exactly one increment in each participant's row) and
Probe B (real replay → no double-count; `ConditionalCheckFailed` in logs) both
run through the **DEPLOYED** stream path BEFORE use-case build-out. Evidence
recorded in the DORA ledger.

Observed in: AC2.9 (Probe A), AC2.10 (Probe B).

### T-LB-11 — SM-6 no hot-path regression [UC2, UC5]

`game-over` WS message still ≤1s p95 after s009 lands. The stream/board-fn path
adds nothing to the hot path; board-fn is off-path.

Observed in: AC5.7.

### T-LB-12 — SM-8 session persist [UC1, UC5]

Name pre-fills from `sessionStorage` on the next create/join in the same tab.
SPA-local; no backend assertion required.

Observed in: AC1.6 (unit), AC5.9 (prod validation).

---

## WCAG cases — accessibility (WCAG 2.2 AA)

WCAG cases are lifted from ui-design.md A11Y-1..12. Testable by axe + Playwright.

### A11Y-1 — Name label (1.3.1 / 4.1.2) [UC1, UC5]

The name input has programmatic accessible name "Your name" via an associated
`<label for="name-input">`. `getByRole('textbox', {name:'Your name'})` resolves.
axe `label` rule passes.

Observed in: AC5.13.

### A11Y-2 — Keyboard operable (2.1.1) [UC1, UC4, UC5]

The name field and every leaderboard interactive element are reachable and
operable by keyboard. No keyboard trap introduced by s009 changes.

Observed in: AC5.14.

### A11Y-3 — Focus order (2.4.3) [UC1, UC5]

Logical focus order in the idle view: the name field is in the tab order before
the mode buttons (it sits above them). The leaderboard, being read-only,
introduces no focus stops out of order.

Observed in: AC5.15.

### A11Y-4 — Visible focus (2.4.7) [UC1, UC5]

The name field shows a visible `:focus-visible` indicator with contrast ≥3:1
against its background (`--focus-ring`, 2px solid + 2px offset).

Observed in: AC5.16.

### A11Y-5 — Contrast (1.4.3) [UC3, UC5]

Leaderboard text (names, headers, tallies) and the name field text meet ≥4.5:1
(≥3:1 for the rank-1 UI highlight) against their backgrounds in both light and
dark schemes. axe `color-contrast` passes.

Observed in: AC5.17.

### A11Y-6 — Target size (2.5.8) [UC1, UC5]

The name input target is ≥24×24 CSS px.

Observed in: AC5.18.

### A11Y-7 — Table semantics (1.3.1) [UC3, UC5]

The leaderboard is a real `<table>` (or `role=table`) with column headers
(`<th scope="col">` Rank/Name/W/D/L) so a screen reader announces each cell
with its column. axe table rules pass.

Observed in: AC3.9, AC5.19.

### A11Y-8 — No colour-only meaning (1.4.1) [UC3, UC5]

W/D/L meaning is conveyed by visible column headers, not colour. The rank-1
highlight is not colour-only (also weight/border).

Observed in: AC5.20.

### A11Y-9 — Live region for async (4.1.3) [UC3, UC5]

Leaderboard load/refresh and error states are exposed via a `role=status` /
`role=alert` live region so they are announced, not silent.

Observed in: AC3.10, AC3.11, AC5.21.

### A11Y-10 — Reduced motion (2.3.3) [UC1, UC3, UC5]

The name-field focus transition and any leaderboard fade honour
`prefers-reduced-motion: reduce` (no motion when set); no content flashes more
than 3×/s.

Observed in: AC5.22.

### A11Y-11 — Name rendered as text (display-side XSS / 1.3.1) [UC3, UC5]

Player names on the board render as plain text (React text interpolation),
never as parsed HTML. Verified by a row whose name contains markup characters
rendering them literally. This is the display guarantee; the data-side charset
bound is the architect's write-side control.

Observed in: AC3.3, AC5.23.

### A11Y-12 — Heading order (1.3.1) [UC3, UC5]

The leaderboard panel heading is a correctly-ordered `<h2>` (the page h1 is the
existing title). axe `heading-order` passes.

Observed in: AC5.24.

---

## DEFECT-S008-002 acceptance cases

Root cause: the multi-party share flow was modelled from the sharer's side only.
The guest has two join paths; the prior single affordance served the link path
while reading as the code path. Fix: two distinct controls on the waiting screen.

### D1 — Two controls present on waiting screen [UC4, UC5]

The waiting screen shows `data-testid="copy-code-btn"` ("Copy code") and
`data-testid="copy-link-btn"` ("Copy link") as separate, labelled controls.

Observed in: AC4.1, AC4.6.

### D2 — "Copy code" copies the code (not the URL) [UC4, UC5]

Clicking "Copy code" writes the 6-char code string to the clipboard. It does
NOT write the full join URL. This is the fix for the defect's root cause.

Observed in: AC4.2, AC4.6.

### D3 — "Copy link" copies the URL [UC4, UC5]

Clicking "Copy link" writes `origin + "/join/" + code` to the clipboard. It
does NOT write the bare code.

Observed in: AC4.3, AC4.6.

### D4 — Confirmation feedback on both controls [UC4]

Both buttons show a ~2s "Copied!" confirmation state after a successful
clipboard write.

Observed in: AC4.4.

### D5 — Manual-entry join unaffected [UC4, UC5]

The guest who types the 6-char code into the join field (manual-entry path,
existing s008 regression) still completes the join successfully.

Observed in: AC4.5.

---

## Coverage map (cases → use cases)

| UC | F-cases | T-LB cases | WCAG cases | Defect cases |
|----|---------|------------|------------|--------------|
| UC1 (name entry — both parties) | F2, F8, F10 | T-LB-2, T-LB-12 | A11Y-1, A11Y-2, A11Y-3, A11Y-4, A11Y-6 | — |
| UC2 (Leaderboard + stream + board-fn) | F1, F3, F4, F5, F6 | T-LB-1, T-LB-3, T-LB-4, T-LB-5, T-LB-9, T-LB-10, T-LB-11 | — | — |
| UC3 (GET /api/leaderboard + SPA display) | F7, F10 | T-LB-6, T-LB-8 | A11Y-5, A11Y-7, A11Y-8, A11Y-9, A11Y-10, A11Y-11, A11Y-12 | — |
| UC4 (two copy controls — DEFECT-S008-002) | F9, F10 | — | A11Y-2 | D1, D2, D3, D4, D5 |
| UC5 (validation) | F1, F2, F3, F4, F5, F6, F7, F8, F9 | T-LB-3, T-LB-4, T-LB-5, T-LB-7, T-LB-8, T-LB-9, T-LB-11, T-LB-12 | A11Y-1..12 (all) | D1, D2, D3, D5 |

**Case counts:**
- **F-cases: 10** (F1–F10, including DEFECT-S008-002 closure as F9)
- **T-LB cases: 12** (T-LB-1..12, lifted from delta 010)
- **WCAG cases: 12** (A11Y-1..12, lifted from ui-design.md)
- **DEFECT-S008-002 cases: 5** (D1–D5)
- **Total named acceptance conditions: 39**

Individual AC-ids in use-cases.md (the engineer and tester turn these into test
specs): 9 in UC1, 13 in UC2, 12 in UC3, 7 in UC4, 24 in UC5 = **65 AC-ids total**.

---

## DEFECT-S008-002 status

**DEFECT-S008-002 is an s009 acceptance case.** Closed via s009 delivery. The
defect will be marked closed in `defects/DEFECT-S008-002.md` when AC4.6 + AC5.10
pass in prod validation (UC5).

---

## Open risks carried forward

- **OR-S009-a — Leaderboard farming under anonymity:** self-play can inflate a
  name's tally (requires two distinct WS connections; the move CAS is
  server-authoritative, so clients cannot assert a result). Partially bounded
  structurally; fully defeating requires authentication (not in scope for this
  slice or any committed slice). Documented and accepted per the product
  decision (arcade model, no account system).
- **OR-S009-b — Offensive names:** a player can enter a slur within the charset
  bound; it displays to others. Profanity filtering / moderation is explicitly
  out of scope (no job demand). The risk is named, not silent.
- **OR-S009-c — `scoredGames` set growth:** a name with very many games will
  accumulate a large string set on its row. At hobby scale this is acceptable.
  Reversal path: move the marker to a separate per-game item with a short-ish TTL
  — explicitly deferred.
- **OR-S009-d — CloudFront 5s TTL is cloud-only:** the TTL behaviour is not
  verifiable locally. Covered by synth assertion (TTL=5s in CDK) + s010 latency
  smoke. The SPA fetch + JSON contract stand locally against stubs.
