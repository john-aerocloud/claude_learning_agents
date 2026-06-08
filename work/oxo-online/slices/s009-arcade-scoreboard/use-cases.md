---
slice: s009
slug: arcade-scoreboard
process-ref: §37 + §12b (multi-party / multi-instance)
co-authored: product + solution-architect
exp-ref: EXP-015 (first scoring opportunity — multi-party modelling applied)
---

# Use cases — s009: arcade scoreboard (name entry + record + shared display)

## §12b Multi-party / multi-instance model

This is the first slice in the project to require multi-party modelling (§12b,
EXP-015 first scoring opportunity). Two players operate on SEPARATE browser
instances against a SHARED backend. The correct decomposition must model:

- **Party A (host):** creates the game, enters their name at idle, carries the
  code/link to Party B out-of-band, plays to completion.
- **Party B (guest):** receives the code/link (via one of TWO distinct in-band
  controls or an out-of-band channel), enters their name at join, plays to
  completion.
- **Any observer browser:** any browser on the idle screen that fetches
  `GET /api/leaderboard` — may be Party A, Party B, a third party, or the same
  browser returning to idle after the game ends.

Use cases are separately buildable and separately testable. Dependency edges
appear only where a genuine build or runtime dependency exists; false edges
waste parallelism and are not added.

---

## §12b Sync-point table

| Sync point | Type | Parties | Mechanism | Modelled in |
|------------|------|---------|-----------|-------------|
| SP-1: Share game code/link | OUT-OF-BAND | Host → Guest | Human carries code/link between instances (e.g., chat, message). TWO controls serve the two receiving paths: "Copy code" (Guest types the 6-char code) and "Copy link" (Guest clicks the URL). | UC4 |
| SP-2: Guest JOIN via code | IN-BAND (manual entry path) | Guest → server | Guest types the code into the join field; WS `join` message includes `playerName`. | UC4 (receiving side) / UC1 (name propagation) |
| SP-3: Guest JOIN via link | IN-BAND (deep-link path) | Guest → server | Guest clicks the `/join/:code` URL; deep-link pre-fills the code; WS `join` includes `playerName`. | UC4 (receiving side) / UC1 (name propagation) |
| SP-4: Game-over tally write | IN-BAND (decoupled stream) | Server (stream) → Leaderboard | DynamoDB Stream fires on `Games` status transition `active→won/drawn`; `oxo-board-fn` writes tally. Party A and Party B's names both scored by the SAME stream record. | UC2 |
| SP-5: Leaderboard cross-instance read | IN-BAND (shared backend + CF cache) | Server → any browser | Any idle-screen mount fetches `GET /api/leaderboard`; Party A's result appears on Party B's board (and vice versa) within ≤10s via CloudFront 5s TTL + sub-1s stream propagation. | UC3 |

**In-band sync (SP-4, SP-5):** the shared backend + DynamoDB Stream + CloudFront
cache TTL form the convergence mechanism. No direct browser-to-browser channel.
The ≤10s SLA on SM-1 (name on shared board in another browser within 10s) is
delivered by SP-4 + SP-5 in composition.

**Out-of-band sync (SP-1):** the human carries the code or link between the two
browser instances. This is the join-invitation flow; it has two distinct receiving
paths (type / click) and each must have its own copy affordance. DEFECT-S008-002
documented that only one affordance existed (link only); the fix (two controls) is
in scope in this slice.

---

## Parallel / serial call

```
PARALLEL SET A — backend infrastructure (no SPA dependency):
  UC2 — Leaderboard table + DynamoDB Stream + oxo-board-fn tally writer (idempotent)
  (no SPA file overlap; builds against CDK + Lambda only)

PARALLEL SET A — SPA components (no backend runtime dependency at build time):
  UC1 — NameField (both parties: host at create + guest at join) + name wire
  UC3 — GET /api/leaderboard + SPA leaderboard display (cross-instance read)
  UC4 — Two copy controls (DEFECT-S008-002) — copy-code + copy-link

  SERIAL SEAM WITHIN SPA: UC1, UC3, UC4 all touch GameRoot (idle view / waiting
  screen). They share the same React component file and must be integrated
  serially in a single SPA artefact. At BUILD TIME they can proceed in parallel
  (separate functions/components); at the point of assembling GameRoot they
  serialise. The engineer owns the integration seam.

SET B — after UC1 + UC2 + UC3 + UC4 all deployed to prod:
  UC5 — Validation (cross-browser SM-1 smoke, idempotency replay, geometry/a11y,
         DEFECT-S008-002 two-copy-affordance closure)
```

UC2 (stream + board-fn) has no file overlap with UC1/UC3/UC4 (SPA + HTTP handler)
at build time and is fully parallel. The §30 walking-skeleton probe for the first
DynamoDB Stream (T-LB-10) is an early gate within UC2 that the engineer schedules
BEFORE use-case build-out.

---

## UC1 — Name entry: both parties + propagation to Games

**ID:** UC1
**Actors:** Party A (host, browser A); Party B (guest, browser B); `oxo-game-fn`
Lambda (host path); `oxo-ws-fn` Lambda (guest path).
**Trigger (Party A):** Party A is on the idle view and clicks "Play Online" (or
any Online action). The `NameField` ("Your name") is already visible and
pre-filled with the session name (or "AAA" default).
**Trigger (Party B):** Party B arrives at the idle view (fresh load or return
from game), edits the name field if desired, and clicks "Join a game".

### Trigger -> observable outcome

**Party A (host path):**
1. The idle view renders a `<label for="name-input">Your name</label>` + `<input
   data-testid="name-input" maxlength={10}>` ABOVE the mode buttons.
2. The field is pre-filled: `sessionStorage` value if present, else "AAA".
3. Party A optionally edits the name. The field is non-blocking — the "Play
   Online" button is enabled regardless of the field content.
4. On `POST /api/games` the SPA sends `playerName: <trimmed_value_or_AAA>`.
5. `oxo-game-fn` validates/normalises the name (trim; ≤10 chars; charset strip:
   no `<>&"'` or control chars; blank/empty → "AAA") and writes `hostName` onto
   the `Games` `PutItem`. No new IAM grant (same existing `PutItem` on `Games`).
6. `sessionStorage` is updated with the validated name after a successful create.

**Party B (guest path):**
1. Party B is on the idle view. The same `NameField` is visible and pre-filled.
2. Party B clicks "Join a game" (reaches the join flow), optionally edits name.
3. On WS `join` message the SPA includes `playerName: <trimmed_value_or_AAA>`.
4. `oxo-ws-fn` validates/normalises identically and writes `guestName` onto the
   `Games` item in the EXISTING conditional `UpdateItem` (the waiting→active
   transition). No new IAM grant.
5. `sessionStorage` updated post-join.

**Both parties:**
- A name exceeding 10 chars is truncated server-side; disallowed chars are
  stripped. Play is never blocked over a name (SM-3 default "AAA").
- Name persists in `sessionStorage` for the next create/join in the same tab
  (SM-8).

### Done condition

All of the following pass:
- NameField renders in the idle view, above mode buttons, pre-filled (unit test).
- `POST /api/games {playerName:"ACE"}` → `Games.hostName = "ACE"` (local + cloud
  assertion T-LB-2).
- WS `join {playerName:"BEE"}` → `Games.guestName = "BEE"` (local + cloud T-LB-2).
- Blank/omitted → "AAA" on both paths (SM-3 / T-LB-2).
- Names >10 chars truncated; `<>&"'`/control stripped (write-side XSS bound T-LB-2).
- `sessionStorage` round-trip: name pre-fills on next create/join (SM-8 / T-LB-12).
- "Play Online" not gated on non-empty name (BINDING: click-path-over-budget = failure).

### Acceptance cases

- AC1.1: Unit test (Party A path) — `NameField` renders with `data-testid="name-input"`,
  `maxlength={10}`, associated label "Your name"; field is pre-filled with
  `sessionStorage` value when present, "AAA" when absent.
- AC1.2: Unit test — The "Play Online" (and equivalent Online actions) are
  enabled when the name field is empty; no gate on name content (click-path pin).
- AC1.3: Unit test — `POST /api/games {playerName:"ACE"}` → name normaliser
  returns "ACE"; `{playerName:""}` → "AAA"; `{playerName:"  "}` → "AAA";
  `{playerName:"<img>"}` → charset-stripped form (≤10, no `<`/`>`/`&`).
- AC1.4: Unit test — `{playerName:"TOOLONGNAME123"}` → truncated to 10 chars.
- AC1.5: Unit test — WS `join {playerName:"BEE"}` → normaliser returns "BEE";
  same blank/strip behaviour as AC1.3.
- AC1.6: Unit test (Party B path) — after successful join, `sessionStorage`
  stores the validated name; on next idle-view mount the field is pre-filled.
- AC1.7: Integration / local adapter — after `POST /api/games {playerName:"ACE"}`,
  the in-memory `Games` store shows `hostName="ACE"` on the created item.
- AC1.8: Integration / local adapter — after WS `join {playerName:"BEE"}`, the
  in-memory `Games` store shows `guestName="BEE"` on the same item (same-item
  additive write, not a new item).
- AC1.9: Cloud assertion (T-LB-2) — after `POST /api/games {playerName:"ACE"}`
  against the deployed stack, `GetItem(Games, gameId)` returns `hostName="ACE"`;
  after WS `join {playerName:"BEE"}`, same item returns `guestName="BEE"`.

### Dependencies

- No dependency on UC2 (stream + board-fn) at build time.
- No dependency on UC3 (leaderboard display) at build time.
- No dependency on UC4 (copy controls) at build time.
- Serial seam: UC1, UC3, UC4 integrate in the same `GameRoot` SPA file; the
  engineer owns the integration order. UC1 name-field changes and UC4
  copy-control changes land in the same idle / waiting view.

---

## UC2 — Leaderboard table + DynamoDB Stream + oxo-board-fn (tally writer, idempotent)

**ID:** UC2
**Actors:** `oxo-board-fn` Lambda (stream consumer); DynamoDB Stream on `Games`;
`Leaderboard` DynamoDB table; Engineer/CICD (CDK stack).
**Trigger:** `Games` item transitions `active→won` or `active→drawn` (a
DynamoDB Stream MODIFY record fires with OLD.status=active AND
NEW.status∈{won,drawn} — stream event-source-mapping filter criteria applied).

### Trigger -> observable outcome

1. **`Leaderboard` table exists:** PK `playerName` (S), attrs `wins`/`draws`/
   `losses` (N), `scoredGames` (SS). SSE on; PITR ENABLED; NO TTL; on-demand;
   eu-west-2 in `OxoGameProd`.
2. **Stream filter:** the event-source mapping filter criteria (`eventName=MODIFY`,
   NEW.status∈{won,drawn}, OLD.status=active) screens out all non-terminal
   transitions (move updates, abandoned, initial create).
3. **Tally write (won game):** winner name gets `wins ADD 1`; loser gets
   `losses ADD 1`. Each write is an independent conditional `UpdateItem`:
   ```
   ConditionExpression: NOT contains(scoredGames, :gameId)
   UpdateExpression: ADD wins :one, scoredGames :gameIdSet
   ```
4. **Tally write (drawn game):** both names get `draws ADD 1` with the same
   conditional structure.
5. **Idempotency (SM-4):** a redelivered stream record runs the same two
   `UpdateItem`s. `contains(scoredGames, :gameId)` is now TRUE →
   `ConditionalCheckFailed` → swallowed (success-already-done); no increment.
   The `Leaderboard` rows are byte-identical to after first processing.
6. **Abandoned games (SM-5):** the stream filter excludes `active→abandoned`
   transitions (OLD.status=active AND NEW.status∉{won,drawn} — filter rejects).
   No write to `Leaderboard`.
7. **Name collision (SM-2):** two games for name "AAA" each add their `gameId`
   to `AAA.scoredGames`; each increments — collisions accumulate, replays do not.
8. **IAM (no widening):** `oxo-board-fn` role = stream-read on Games-stream ARN
   + `UpdateItem` on Leaderboard ARN only; no Games table grant, no wildcard.
9. **§30 skeleton probe (T-LB-10):** Probe A (real game-over → exactly one
   increment) + Probe B (replay → byte-identical rows) run through the DEPLOYED
   stream path BEFORE use-case build-out.
10. **Build-sha carrier:** `oxo-board-fn` emits `buildSha` in its structured
    CloudWatch log line on every invocation.

### Done condition

All of the following pass:
- Synth: `Leaderboard` table in `OxoGameProd` with SSE=on, PITR=enabled, no TTL
  (T-LB-1).
- Synth: event-source mapping filter criteria pinned (eventName+status transition).
- Synth/policy: `oxo-board-fn` IAM role = named grants only (T-LB-9).
- Unit tests: won→W/L, drawn→D/D, abandoned→none (pure tally function).
- Unit tests: idempotency branch — `ConditionalCheckFailed` swallowed, no retry.
- §30 Probe A + B evidence recorded in ledger (T-LB-10).
- T-LB-3 idempotency pin passes (deployed assertion).
- T-LB-4 name-collision accumulation passes.
- T-LB-5 abandoned-no-write passes.

### Acceptance cases

- AC2.1: Synth test — `Leaderboard` table exists in `OxoGameProd`, PK
  `playerName` (S), SSE on, PITR ENABLED, NO TTL attribute, on-demand billing.
- AC2.2: Synth test — event-source mapping for `oxo-board-fn` carries filter
  criteria: `eventName=MODIFY`, NEW-image `status` ∈ {won, drawn}, OLD-image
  `status = active`.
- AC2.3: Synth/policy test — `oxo-board-fn` execution role has
  `dynamodb:GetRecords/GetShardIterator/DescribeStream/ListStreams` on the Games
  stream ARN and `dynamodb:UpdateItem` on the Leaderboard ARN only; NO Games
  table grant, NO `Scan`/`Query`/`DeleteItem` on Leaderboard, NO wildcard.
- AC2.4: Unit test — tally function given `{oldStatus:"active", newStatus:"won",
  winnerName:"ACE", loserName:"AAA", gameId:"G1"}` returns exactly two
  `UpdateItem` ops: ACE.wins ADD 1, scoredGames add G1 (condition NOT contains
  G1); AAA.losses ADD 1, scoredGames add G1 (same condition).
- AC2.5: Unit test — tally function given `{newStatus:"drawn"}` returns two
  draws UPDATE ops.
- AC2.6: Unit test — tally function given `{oldStatus:"active",
  newStatus:"abandoned"}` returns zero UPDATE ops (abandoned excluded).
- AC2.7: Unit test — replay: local store adapter processes the same game-over
  record twice; counter values are identical after second call; the
  `ConditionalCheckFailed` branch is exercised (success-already-done, not thrown).
- AC2.8: Unit test — name-collision accumulation: store adapter processes two
  distinct game-over records for name "AAA" (one won, one drawn); the "AAA" row
  shows wins=1, draws=1, scoredGames={G1,G2}.
- AC2.9: §30 skeleton Probe A — DEPLOYED stream: drive one real game to `won`
  via the WS path; assert winner.wins went 0→1, loser.losses went 0→1; each
  `scoredGames` contains the gameId exactly once. Evidence recorded in DORA
  ledger.
- AC2.10: §30 skeleton Probe B — DEPLOYED stream: re-inject the SAME game-over
  stream record a second time; assert BOTH `Leaderboard` rows are byte-identical
  to after Probe A; `ConditionalCheckFailed` observed in `oxo-board-fn` logs.
  Evidence recorded in DORA ledger.
- AC2.11: Cloud assertion (T-LB-3 idempotency pin) — real game-over replay
  produces no counter change; `scoredGames` contains the gameId exactly once.
- AC2.12: Cloud assertion (T-LB-4) — two distinct games for "AAA" produce one
  row showing combined tally (1W + 1D), not two rows.
- AC2.13: Cloud assertion (T-LB-5) — game going `active→abandoned` (s007 path)
  produces no `Leaderboard` write; table scan shows no new entry for either name.

### Dependencies

- UC2 is independent of UC1, UC3, UC4 at build time (CDK + Lambda; no SPA file
  overlap).
- UC2 IAM role for `oxo-board-fn` must be deployed at or before the function
  code deploy (§19 sequencing — same `OxoGameProd` stack invocation satisfies).
- §30 Probe A+B must be evidence-recorded BEFORE the remaining UC build-out
  (T-LB-10 gate within UC2).

---

## UC3 — GET /api/leaderboard + SPA leaderboard display (cross-instance read)

**ID:** UC3
**Actors:** SPA (any browser — Party A, Party B, or observer); `oxo-game-fn`
Lambda (leaderboard handler); `Leaderboard` DynamoDB table; CloudFront.
**Trigger:** SPA mounts the idle view (title-screen) — on page load or return
from a completed game.

### Trigger -> observable outcome

**Cross-instance fan-out (SM-1, SP-5):** Party A's result, written by UC2 (stream
+ board-fn), appears on Party B's idle-screen leaderboard fetch within ≤10s of
game-over. This is the IN-BAND cross-instance sync: the shared backend + 5s
CloudFront TTL + sub-1s stream propagation deliver the convergence.

1. **`GET /api/leaderboard`** — new route on the existing HTTP API. Returns:
   ```json
   { "entries": [{ "name": "ACE", "wins": 3, "draws": 1, "losses": 0 }],
     "buildSha": "..." }
   ```
   Top-20, ordered wins desc / losses asc / name asc. Handler in `oxo-game-fn`
   (no new Lambda). IAM: `oxo-game-fn` += `dynamodb:Scan` on Leaderboard ARN
   only. CloudFront behaviour for `/api/leaderboard` with TTL=5s (min/default/max).
2. **Loading state:** idle view renders `role="status"` `aria-live="polite"` region
   showing "Loading standings…"; spinner after ~500ms.
3. **Populated state:** `<table data-testid="leaderboard">` with `<caption>` or
   `aria-label="Leaderboard"`, `<thead>` with `<th scope="col">` Rank/Name/W/D/L,
   `<tbody>` of `<tr data-testid="leaderboard-row">` with `<th scope="row"
   data-testid="leaderboard-name">` and `<td>`s for wins/draws/losses.
4. **Empty state:** "No scores yet — be the first." (leaderboard table renders
   with empty body, not hidden).
5. **Error state:** `role="alert"` "Couldn't load the leaderboard." (graceful
   fallback; SPA renders empty board on failure; no aggressive retry loop).
6. **Name rendering:** every `leaderboard-name` cell renders as React text
   interpolation (`{entry.name}`) — NEVER `dangerouslySetInnerHTML` or
   `innerHTML` (stored-XSS defence, T-LB-8).
7. **Refresh:** re-mounting the idle view (return from game) triggers a fresh
   fetch.
8. **Build-sha carrier:** `buildSha` in the JSON response body (principles/01).

### Done condition

All of the following pass:
- Unit test: top-N sort (wins desc / losses asc / name asc) on a local fixture.
- SPA component test: loading/empty/error/populated state transitions.
- SPA component test: `leaderboard-name` cells render markup characters
  literally (display-XSS pin).
- Synth: `/api/leaderboard` CloudFront behaviour TTL=5s (T-LB-6).
- Synth/policy: `oxo-game-fn` += `Scan` on Leaderboard ARN only; no other
  Leaderboard action; no widening of existing grants.
- Cloud: `GET /api/leaderboard` returns valid shape with `buildSha` (T-LB-6).
- A11Y conditions A11Y-5, A11Y-7, A11Y-8, A11Y-9, A11Y-11, A11Y-12 pass.

### Acceptance cases

- AC3.1: Unit test — sort function on a 5-entry fixture: rank-1 is the entry
  with most wins; ties broken by losses asc, then name asc.
- AC3.2: SPA component test — on mount the leaderboard panel shows the loading
  live region; on data resolution it renders the populated table with
  `data-testid="leaderboard"` and correct row structure.
- AC3.3: SPA component test — a row whose `name` is `"<img src=x
  onerror=alert(1)>"` renders the string literally (no HTML interpretation); the
  cell `textContent` equals the raw string; no `dangerouslySetInnerHTML` in the
  component (T-LB-8 / A11Y-11 display pin).
- AC3.4: SPA component test — on fetch failure the panel renders the error state
  with `role="alert"` and "Couldn't load the leaderboard." text; no uncaught
  exception.
- AC3.5: SPA component test — empty response (`entries:[]`) renders "No scores
  yet — be the first."
- AC3.6: Synth test — CloudFront behaviour for path `/api/leaderboard` has
  min/default/max TTL = 5s; `POST /api/games` route behaviour remains
  CachingDisabled (T-LB-6).
- AC3.7: Synth/policy test — `oxo-game-fn` execution role policy now includes
  `dynamodb:Scan` on the Leaderboard table ARN; it does NOT include
  `dynamodb:Query`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem`, or `dynamodb:GetItem`
  on Leaderboard; existing Games/Codes grants unchanged.
- AC3.8: Cloud assertion — `GET /api/leaderboard` returns HTTP 200, JSON body
  with `entries` array and `buildSha` string; entries are ordered wins desc
  (T-LB-6 read-path functional assertion).
- AC3.9: A11Y — `getByRole('table', {name:'Leaderboard'})` resolves; axe
  `table` rules pass (A11Y-7).
- AC3.10: A11Y — `role="status"` live region is present in the leaderboard
  panel and announces load/refresh (A11Y-9).
- AC3.11: A11Y — `getByRole('alert')` resolves in the error state; live region
  is announced (A11Y-9 error arm).
- AC3.12: A11Y — leaderboard text contrast ≥4.5:1 (A11Y-5); rank-1 highlight
  is not colour-only (A11Y-8); leaderboard heading is a correctly-ordered `<h2>`
  (A11Y-12).

### Dependencies

- UC3 builds against a local stub for `GET /api/leaderboard` — no dependency on
  UC2 at build time.
- UC2 must be deployed to see real data in cloud assertions; UC3's own display
  logic does not depend on UC2's correctness.
- Serial seam with UC1 and UC4: UC3's leaderboard panel lands in GameRoot
  (idle view) alongside UC1's NameField and UC4's copy controls; engineer
  integrates in a single SPA artefact.

---

## UC4 — Two copy affordances: "Copy code" + "Copy link" (DEFECT-S008-002)

**ID:** UC4
**Actors:** Party A (host, waiting screen); Party B (guest, two join paths).
**Trigger (sharer — Party A):** Party A is on the waiting screen after creating
a game. They want to invite Party B.
**Trigger (receiver — Party B):** Party B receives the code or link via
out-of-band channel (SP-1). Party B's action depends on which affordance Party
A used: either types the 6-char code into the join field, or clicks the
`/join/:code` deep-link URL.

### §12b Multi-party note

DEFECT-S008-002 root cause: the share flow was modelled from Party A's (sharer)
side only. Party B has TWO receiving paths:
1. **Type path:** Party B opens the app and types the code into the join field.
   Affordance needed: "Copy code" (copies the 6 chars).
2. **Click path:** Party B clicks a link. Affordance needed: "Copy link" (copies
   `origin + /join/ + code`).

Both paths are served by TWO distinct controls on the waiting screen, placed
adjacent to the displayed code.

### Trigger -> observable outcome

**Party A (waiting screen — two controls):**
1. The waiting screen shows the game code and two buttons:
   - `data-testid="copy-code-btn"` labelled "Copy code" — clicking copies the
     6-char code string to the clipboard (e.g., `"ABC123"`).
   - `data-testid="copy-link-btn"` labelled "Copy link" — clicking copies the
     full join URL (`window.location.origin + "/join/" + code`) to the clipboard.
2. Each button shows a 2-second confirmation state ("Copied!" or equivalent)
   after a successful clipboard write.

**Party B (receiving side — two distinct paths):**
1. **Type path (code received):** Party B opens the app at `/`, types the
   6-char code into the join field, and clicks Join. This is the existing manual
   entry path (s007 regression — unaffected).
2. **Click path (link received):** Party B clicks the `/join/:code` URL; the
   deep-link route pre-fills the code (s008 UC2 — delivered). This path is
   unaffected by this UC beyond validating that the link URL copied by "Copy link"
   matches the expected deep-link form.

### Done condition

All of the following pass:
- Waiting screen renders TWO distinct copy controls with correct `data-testid`s.
- "Copy code" copies ONLY the 6-char code string.
- "Copy link" copies the full `/join/:code` URL.
- Both show a 2-second confirmation state after clipboard write.
- Manual-entry join (type path) is unaffected / regression-green.
- A11Y: each button has a programmatic accessible name; keyboard operable.

### Acceptance cases

- AC4.1: SPA component test — waiting screen renders `data-testid="copy-code-btn"`
  (labelled "Copy code") and `data-testid="copy-link-btn"` (labelled "Copy link")
  as two separate controls.
- AC4.2: SPA component test — clicking `copy-code-btn` invokes the clipboard
  write API with the 6-char code string (e.g., `"ABC123"`), NOT the full URL.
- AC4.3: SPA component test — clicking `copy-link-btn` invokes the clipboard
  write API with the full join URL (`origin + "/join/" + code`), NOT the bare code.
- AC4.4: SPA component test — each button transitions to a "Copied!" confirmation
  state for approximately 2s after a successful clipboard write (transient
  feedback present).
- AC4.5: Playwright regression — manual-entry join flow (Party B types code)
  still works end-to-end (code is still displayed; "Copy code" content is correct;
  join completes).
- AC4.6: Playwright smoke (DEFECT-S008-002 closure) — Party A sees both "Copy
  code" and "Copy link" controls on the waiting screen; clicking "Copy code"
  gives the 6-char code; clicking "Copy link" gives the `/join/:code` URL. The
  defect (copy producing URL when code was expected) does NOT recur.
- AC4.7: A11Y — both copy buttons have accessible names ("Copy code" / "Copy
  link") and are keyboard-operable (Tab + Enter / Space activates); no keyboard
  trap.

### Dependencies

- UC4 shares the GameRoot / waiting screen with UC1 (name field above mode
  buttons). Serial SPA seam with UC1 and UC3.
- The `/join/:code` URL shape (copy-link target) is set by the s008 deep-link
  route (UC8-UC2, delivered) — no dependency on anything in s009; the URL
  construction is a string concat.
- No dependency on UC2 (backend) or UC3 (leaderboard panel) at build time.

---

## UC5 — Validation (cross-instance SM-1, idempotency, geometry/a11y, DEFECT-S008-002 closure)

**ID:** UC5
**Actor:** Tester (prod validation spec, post-deploy).
**Trigger:** All of UC1, UC2, UC3, UC4 deployed to prod.

### Trigger -> observable outcome

The tester exercises the deployed system across six areas:

1. **Cross-browser SM-1 smoke (two parties):** Party A (browser A) enters name
   "ACE", creates a game, invites Party B via "Copy code" control. Party B
   (browser B) enters name "BEE", joins using the code, both play to completion
   (A wins). Within 10 seconds of game-over, Party B's idle-screen leaderboard
   shows "ACE" with wins=1 and "BEE" with losses=1 (SM-1: the headline measure).
2. **Cross-browser SM-2 (name collision):** two games for "AAA" played; the
   board shows one "AAA" row with combined tally.
3. **SM-3 default name:** party leaves field blank; "AAA" appears on the board.
4. **Idempotency replay (T-LB-3):** re-inject a game-over stream record;
   counters unchanged; `ConditionalCheckFailed` in logs.
5. **No-regression (SM-6 / T-LB-11):** game-over WS message still ≤1s p95.
6. **DEFECT-S008-002 closure:** waiting screen shows BOTH "Copy code" and
   "Copy link"; each copies the correct thing; manual join still works.
7. **A11Y sweep (12 conditions):** axe + Playwright pass on name field and
   leaderboard in both populated and empty/error states.

### Done condition

All acceptance cases below pass. SM-1 through SM-8 all satisfied.

### Acceptance cases

- AC5.1: Two-browser Playwright smoke — Party A enters name "ACE", Party B
  enters "BEE"; A wins; within 10s of game-over, Party B's idle-screen
  leaderboard `data-testid="leaderboard"` contains a row with
  `leaderboard-name="ACE"` and `leaderboard-wins="1"` (SM-1 functional assertion
  / T-LB-7).
- AC5.2: Cross-browser check — within the same smoke, Party B's board shows
  a row with `leaderboard-name="BEE"` and `leaderboard-losses="1"` (both
  parties' tallies recorded).
- AC5.3: SM-2 name-collision — two games for name "AAA" (one won, one drawn)
  yield a SINGLE "AAA" row with wins=1, draws=1 on the leaderboard; no duplicate
  row (T-LB-4).
- AC5.4: SM-3 default — Party A leaves name field blank; after game completion
  the board shows "AAA" with the correct tally (T-LB-2 deployed arm).
- AC5.5: SM-4 idempotency — re-inject the game-over stream record (or replay
  via DDB stream); `Leaderboard` rows byte-identical to after first processing;
  `ConditionalCheckFailed` observed in `oxo-board-fn` CloudWatch Logs (T-LB-3).
- AC5.6: SM-5 abandoned — after a `$disconnect` abandonment (s007 path) the
  `Leaderboard` table contains no entry for either player (T-LB-5).
- AC5.7: SM-6 no regression — game-over WS message ≤1s p95 (Playwright timing
  assertion over N smoke runs) (T-LB-11).
- AC5.8: SM-7 board load ≤2s — fresh title-screen load renders the leaderboard
  panel within 2s p95 (Playwright timing assertion).
- AC5.9: SM-8 session persist — after game completion, return to idle view; name
  field is pre-filled with the name used in the game (T-LB-12).
- AC5.10: DEFECT-S008-002 closure — waiting screen shows "Copy code" and
  "Copy link"; "Copy code" delivers the 6-char code; "Copy link" delivers the
  `/join/:code` URL; manual-entry join unaffected (AC4.6 re-executed in prod
  smoke).
- AC5.11: T-LB-8 stored-XSS — inject a name containing `<img src=x
  onerror=alert(1)>` via the API; the board renders it as literal text; no script
  execution in the viewing browser; no `dangerouslySetInnerHTML` in the
  component tree (code-policy scan + manual check).
- AC5.12: T-LB-9 IAM no-widening — AWS policy document for `oxo-board-fn` role:
  only stream-read on Games-stream ARN + `UpdateItem` on Leaderboard ARN; no
  Games-table grant, no wildcard; `oxo-ws-fn` policy unchanged from s007 baseline.
- AC5.13: A11Y-1 — `getByRole('textbox', {name:'Your name'})` resolves; axe
  `label` rule passes.
- AC5.14: A11Y-2 — name field and leaderboard are keyboard-reachable; no
  keyboard trap.
- AC5.15: A11Y-3 — name field tab-stop comes before mode buttons in focus order.
- AC5.16: A11Y-4 — name field shows `:focus-visible` ring ≥3:1 contrast.
- AC5.17: A11Y-5 — leaderboard text (names, headers, tallies) ≥4.5:1 contrast;
  axe `color-contrast` passes.
- AC5.18: A11Y-6 — name input target size ≥24×24 CSS px.
- AC5.19: A11Y-7 — `getByRole('table', {name:'Leaderboard'})` resolves; `<th
  scope="col">` headers Rank/Name/W/D/L present; axe table rules pass.
- AC5.20: A11Y-8 — W/D/L meaning conveyed by column headers; rank-1 highlight
  uses weight/border in addition to any colour treatment.
- AC5.21: A11Y-9 — `role="status"` live region present; load + refresh states
  announced; error state uses `role="alert"`.
- AC5.22: A11Y-10 — name-field focus transition and leaderboard fade honour
  `prefers-reduced-motion: reduce`; no content flashes >3/s.
- AC5.23: A11Y-11 — leaderboard name cells render markup characters literally;
  verified by a row with name `"<b>test</b>"` displaying that exact string in
  the cell `textContent`.
- AC5.24: A11Y-12 — leaderboard panel heading is `<h2>` (or correctly ordered);
  axe `heading-order` passes.

### Dependencies

- UC1, UC2, UC3, UC4 all deployed to prod before UC5 validation runs.
- §30 Probe A+B evidence (UC2 AC2.9, AC2.10) in ledger before UC5.

---

## Dependency summary

```
UC1 (name entry — both parties)   — no build dep on UC2/UC3/UC4;
                                    serial SPA seam with UC3 + UC4 (same GameRoot file)
UC2 (Leaderboard + stream + board-fn) — no build dep on UC1/UC3/UC4;
                                        IAM + table deploy before handler code (§19)
UC3 (GET /api/leaderboard + SPA display) — no build dep on UC2 (stubs locally);
                                            serial SPA seam with UC1 + UC4
UC4 (two copy controls — DEFECT-S008-002) — no build dep on UC2/UC3;
                                             serial SPA seam with UC1 + UC3
UC5 (validation)                  — requires UC1 + UC2 + UC3 + UC4 deployed to prod
```

Parallel sets:
- **Set A (build in parallel):** UC1, UC2, UC3, UC4 — no cross-artefact build
  dependency. UC2 (CDK + Lambda) shares no files with UC1/UC3/UC4 (SPA).
  Within the SPA, UC1/UC3/UC4 components can be built in parallel; their
  integration into GameRoot is a serial seam the engineer owns.
- **Set B (after all four deployed to prod):** UC5

§19 sequencing within UC2: `oxo-board-fn` IAM role + Leaderboard table + stream
event-source mapping are CDK-synthesised in `OxoGameProd`; the same `cdk deploy`
invocation puts grants in place at or before handler code — the constraint is
satisfied structurally.

§12b out-of-band sync point (SP-1) is human-mediated and cannot be automated
in the build pipeline. The two copy controls (UC4) make both receiving paths
explicit and testable independently.

---

## Infra enabler notes (co-decided with solution-architect)

1. **New table:** `Leaderboard` in `OxoGameProd`, PK `playerName`, no sort key,
   no GSI this slice. Scan for top-20 is acceptable at hobby scale.
2. **New function:** `oxo-board-fn` (Node 20) — stream consumer only; no HTTP
   surface; build-sha in log only.
3. **New route:** `GET /api/leaderboard` on the existing HTTP API v2. Handled by
   `oxo-game-fn` (avoids a new function/role/cold-start surface for one read).
4. **New CloudFront behaviour:** `/api/leaderboard` with TTL=5s. `POST /api/games`
   stays CachingDisabled.
5. **Additive contract changes:** `POST /api/games` body gains optional
   `playerName`; WS `join` frame gains optional `playerName`. Old clients get
   "AAA" default — no breaking change.
6. **`Games` schema add:** `hostName` / `guestName` (schemaless add, no rebuild,
   no GSI change). `hostPlayerId`/`guestPlayerId` UUID attrs NOT added.
7. **PITR:** Leaderboard is the system's FIRST AND ONLY durable (non-TTL) table.
   PITR ENABLED is a mandatory decision, not an option.
8. **No `dangerouslySetInnerHTML`:** code-policy pin on leaderboard name render;
   tester verifies with code scan + manual check.
