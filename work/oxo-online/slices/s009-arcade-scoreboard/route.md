---
slice: s009
slug: arcade-scoreboard
authored-by: engineer
process-ref: §37 (thin route) + §30 (new-mechanism walking skeleton) + §12b (multi-party) + §19 (deploy edges) + §12a.5 (kebab node ids) + EXP-013/016
routes-against: architecture/dependencies/{class-deps,data-flow,use-case-deps}.mmd (s009 marks present)
---

# s009 — arcade scoreboard: thin route (ordered failing-test steps, grouped by UC)

ROUTE ONLY. Each step is a failing test driven red → green → refactor, committed
when the suite goes green. Steps are grouped by use case; within a UC they are
sequentially independent of other UCs except where a §19 deploy edge or the
serial GameRoot seam is stated.

## Wave plan (parallelism + serial seam)

This slice is built by **TWO engineers in parallel** on trunk, behind UC flags
(default OFF; own tests run flag-ON). The file boundary is clean and disjoint:

```
WAVE 1 (parallel, build-time independent — no shared files):

  ENGINEER-BACKEND  →  UC2 only
    Owns: src/infra/lib/game-stack.ts (+ test), src/infra/test/*,
          src/lambda/board/** (NEW dir: domain tally + ddb/local adapters + handler),
          src/lambda/games/handler.ts ONLY for the GET /api/leaderboard read
          handler + Scan grant (UC3 backend half — see note below).
    Order WITHIN UC2:  R2.1 table+stream synth  →  R2.2 IAM pins  →
                       R2.3 domain tally (pure)  →  R2.4 idempotent store port +
                       local/ddb adapters  →  R2.5 board-fn handler + ESM filter
                       synth  →  DEPLOY (thin)  →  §30 SKELETON Probe A+B  →
                       (only then) UC3-backend read route + Scan.

  ENGINEER-SPA      →  UC1 → UC3-spa → UC4  (SERIAL within one engineer)
    Owns: src/app/src/game/GameRoot.tsx (+ test), JoinScreen.tsx (+ test),
          src/app/src/game/NameField.tsx (NEW), Leaderboard.tsx (NEW),
          leaderboard client/port, src/app/src/App.tsx (no change expected),
          src/app/src/index.css, tests/smoke/*, src/app/local/** (name in
          local create/join wire).
    SERIAL SEAM: UC1 NameField, UC3 Leaderboard panel, UC4 two copy controls ALL
    land in GameRoot (idle view + waiting screen). ONE engineer integrates them
    in sequence: NameField (idle, above mode buttons) → Leaderboard panel (idle,
    below board) → split copy-link into copy-code + copy-link (waiting screen).
    Build the three components in parallel as files; integrate into GameRoot in
    THIS order so the single React artefact never has two in-flight edits to the
    same JSX block.

CROSS-ENGINEER SHARED FILE — the name-write into the backend writes:
  - HOST name-write rides games/handler.ts create PutItem (hostName).
  - GUEST name-write rides ws/join.ts join UpdateItem (guestName).
  These are NOT in ENGINEER-SPA's tree; they are owned by ENGINEER-BACKEND as a
  UC1-backend sub-task (the SPA wire that SENDS playerName is ENGINEER-SPA's;
  the handler that STORES it is ENGINEER-BACKEND's). To avoid a games/handler.ts
  collision between UC1-backend (hostName) and UC3-backend (read route),
  ENGINEER-BACKEND serialises those two edits: UC1-backend hostName first, then
  UC3-backend read route. Both are small, additive, same file — one owner, no
  collision. Flag the orchestrator if a third party needs games/handler.ts.

WAVE 2 (after ALL of UC1+UC2+UC3+UC4 deployed to prod):
  TESTER  →  UC5 validation (handed off; tester derives plan via
             `make impacted-tests SINCE=<s009-base-sha>` from the .mmd marks —
             EXP-013 first real use).
```

**Flag discipline:** `UC1` (`uc1NameEnabled`), `UC3` (`uc3LeaderboardEnabled`),
`UC4` (`uc4TwoCopyEnabled`) gate the SPA surfaces; UC2 is backend-only (a stream
ESM + table — no user-visible flag, but the board-fn deploys behind a no-op-safe
filter so it is inert until real transitions occur). Flags are slice-scoped:
factor them out (code then config) as each UC's done condition — an orphan flag
at retro is a principle failure.

---

## §19 DEPLOY EDGES (schedule constraints on push/deploy order)

These are HARD edges read from the model; they constrain deploy order, not just
build order:

1. **E1 (UC2 internal):** `Leaderboard` table + `oxo-board-fn` IAM role + stream
   ESM are CDK-synthesised in `OxoGameProd` — the SAME `cdk deploy` invocation
   puts grants in place at/before the board-fn handler code. (Satisfied
   structurally by one stack deploy; no cross-stack mint-before-secret hazard.)
2. **E2 (NEW-MECHANISM, §30):** table + stream + board-fn MUST be deployed and
   the §30 walking-skeleton **Probe A + Probe B green in prod** BEFORE any UC
   that builds on the stream (i.e. before UC5, and before relying on real tally
   data). This de-risks the first DynamoDB Stream wiring + idempotency on the
   real platform.
3. **E3 (name-before-tally):** UC1 name-write (hostName on create, guestName on
   join) MUST be deployed BEFORE a real game-over can carry names into the
   tally. A game-over whose Games item has no hostName/guestName would write a
   nameless/`AAA` row. So UC1-backend deploys at/before UC2's skeleton drives a
   *named* game (the skeleton may use `AAA` defaults, but the real SM-1 smoke in
   UC5 needs UC1 deployed).
4. **E4 (read-after-write):** UC3 (`GET /api/leaderboard` + SPA display) and UC2
   (write path) BOTH deployed before UC5 cross-instance read smoke (SP-5 needs
   the route live AND real data present).
5. **E5 (cross-stack contract, §30 synth):** the `GET /api/leaderboard`
   CloudFront behaviour (CF forwards `/api/leaderboard`) must match a route key
   on the HTTP API (`GET /api/leaderboard` exists, OriginPath stripping
   consistent with the existing `/api/games`). Pinned at SYNTH time in one file
   that synthesises both behaviours — not each side alone.

---

## class-deps.mmd kebab node ids (EXP-013 / §12a.5) — where they land

The tester runs `make impacted-tests SINCE=<base-sha>` over the s009 `.mmd`
marks to derive the UC5 plan. Node ids MUST be kebab and MUST match the
`@covers <node-id>` comment on the driving spec/describe. New class-deps nodes
(all marked `classDef s009changed`, cleared only at delivery):

| Node id (kebab) | Seam | Lands in commit | @covers'd by |
|-----------------|------|-----------------|--------------|
| `domain-name-normalise` | pure name normaliser (trim/≤10/charset-strip/AAA default) | R1.1 | name-normalise unit spec |
| `port-leaderboard-store` | domain-defined LeaderboardStorePort (recordResult, topN) | R2.4 | board store contract spec |
| `domain-tally` | pure `(oldImage,newImage)→[{name,field,gameId}]` outcome fn | R2.3 | tally unit spec |
| `adapter-leaderboard-ddb` | conditional `UpdateItem` ADD + scoredGames CAS; Scan top-N | R2.4 | adapter ddb spec (synth + unit) |
| `adapter-local-leaderboard` | in-memory store reproducing the conditional-ADD/`NOT contains` branch | R2.4 | local adapter replay spec |
| `board-fn-handler` | stream-record adapter: parse OLD/NEW image → domain-tally → store; ConditionalCheckFailed-swallow | R2.5 | board-fn handler spec |
| `spa-name-field` | NameField component (idle, above mode buttons; pre-fill; non-gating) | R1.2 | NameField component spec |
| `spa-name-wire` | GameRoot: playerName state + sessionStorage + into POST + into JoinScreen→WS join | R1.3/R1.4 | name-wire spec |
| `spa-leaderboard` | Leaderboard table component (loading/empty/error/populated; text-only render) | R3.2 | leaderboard component spec |
| `spa-leaderboard-client` | fetch `GET /api/leaderboard` + sort + state machine | R3.1/R3.3 | leaderboard client spec |
| `spa-copy-controls` | waiting-screen copy-code + copy-link (DEFECT-S008-002) | R4.1 | copy-controls spec |

Existing data-flow nodes already marked changed for s009 (tester reads these):
`leaderboard`, `boardfn`, `games-stream`, `gamefn` (hostName + Scan read),
`wsfn` (guestName), `cfwaf` (5s TTL behaviour), `games` (stream enabled +
name attrs). class-deps annotation-only changed nodes:
`games-create-handler` (hostName + leaderboard read route), `spaJoinScreen`
(forwards playerName into the join send).

**Commits carrying .mmd updates (same commit as the edge change, §model):**
- R1.1 → class-deps: `domain-name-normalise` node.
- R1.3 → class-deps: `spa-name-field`, `spa-name-wire` + annotate
  `gamesCreateHandler`/`spaJoinScreen`; data-flow already carries gamefn/wsfn
  name-write annotation (verify present, no edge add).
- R2.3/R2.4/R2.5 → class-deps: `domain-tally`, `port-leaderboard-store`,
  `adapter-leaderboard-ddb`, `adapter-local-leaderboard`, `board-fn-handler` +
  the implements/depends edges; data-flow already carries
  games→games-stream→boardfn→leaderboard (verify, no add).
- R3.2/R3.3 → class-deps: `spa-leaderboard`, `spa-leaderboard-client`.
- R4.1 → class-deps: `spa-copy-controls` (redirect/extend from the delivered
  `spaCopyLink` node — copy-link splits into two controls).

---

# UC1 — Name entry (both parties + propagation onto Games) — 7 steps

Flag: `uc1NameEnabled`. ENGINEER-SPA owns R1.2–R1.4; ENGINEER-BACKEND owns
R1.5 (hostName) + R1.6 (guestName) as the UC1-backend sub-task.

- **R1.1 — name normaliser (pure domain).** RED: unit spec `domain-name-normalise`.
  `normaliseName("ACE")→"ACE"`; `("")→"AAA"`; `("  ")→"AAA"`; `("TOOLONGNAME123")
  →"TOOLONGNA"`-class 10-char truncation; `("<img src=x>")→` charset-stripped
  form with NO `< > & " '` or control chars (pin the EXACT regex —
  `/[^A-Za-z0-9 ._-]/g` strip, then trim, then ≤10, then blank→"AAA"). Shared by
  BOTH API boundaries (write-side half of stored-XSS, §8). @covers
  `domain-name-normalise`. (AC1.3, AC1.4, AC1.5, T-LB-2 write-side.)
- **R1.2 — NameField component.** RED: component spec. Renders
  `<label for="name-input">Your name</label>` + `<input data-testid="name-input"
  maxlength={10} autocomplete="off">`; pre-filled from prop (sessionStorage value
  else "AAA"); A11Y-1 `getByRole('textbox',{name:'Your name'})` resolves.
  @covers `spa-name-field`. (AC1.1, A11Y-1/4/6.)
- **R1.3 — NameField in GameRoot idle, NON-GATING.** RED: GameRoot test —
  NameField renders ABOVE the mode buttons in `idle`; "Play Online"/"Join a game"
  are enabled with an EMPTY name field (BINDING click-path pin — gating = failure).
  Name state + sessionStorage round-trip (persists, pre-fills next mount).
  @covers `spa-name-wire`. (AC1.1, AC1.2, AC1.6, SM-8/T-LB-12.)
- **R1.4 — wire playerName into both client sends.** RED: GameRoot test —
  `POST /api/games` body now `{ playerName: <normalised> }` (host); JoinScreen
  `send({action:'join', code, playerName})` (guest, forwarded via existing
  JoinScreen submit seam — trace: GameRoot name state → JoinScreen prop →
  existing `socket.send`). @covers `spa-name-wire`. (AC1.7/AC1.8 local arm.)
- **R1.5 — hostName onto Games (BACKEND).** RED: games/handler unit + local
  adapter — `POST {playerName:"ACE"}` → create `PutItem` Item carries
  `hostName:"ACE"` (normalised server-side via R1.1); omitted/blank→"AAA". No
  new IAM grant (rides existing Games `PutItem`). @covers `gamesCreateHandler`.
  (AC1.7, T-LB-2.)
- **R1.6 — guestName onto Games (BACKEND).** RED: ws/join unit + local adapter —
  WS `join {playerName:"BEE"}` → the EXISTING conditional join `UpdateItem` adds
  `SET guestName = :gn` (normalised via R1.1) on the same waiting→active write
  (same-item additive, not a new item). No new IAM grant. @covers `wsfn`.
  (AC1.8, T-LB-2.)
- **R1.7 — flag-OFF→ON flip + deploy.** Flip `uc1NameEnabled` ON; deploy SPA +
  both Lambdas. Cloud assertion AC1.9: `GetItem(Games,gameId)` shows
  hostName/guestName after a real create+join. Factor flag out. (E3 satisfied:
  name-write live before tally.)

---

# UC2 — Leaderboard table + DynamoDB Stream + oxo-board-fn (idempotent) — 7 steps

ENGINEER-BACKEND. NO SPA file overlap. The §30 skeleton (R2.6) is an EARLY GATE
scheduled AFTER the thin UC2 deploy and BEFORE UC5.

- **R2.1 — Leaderboard table + Games stream synth.** RED: infra synth test —
  `Leaderboard` in `OxoGameProd`: PK `playerName` (S), no SK/GSI, SSE on,
  **PITR ENABLED**, **NO TTL attribute**, PAY_PER_REQUEST, eu-west-2. AND the
  existing `GamesTable` gains `stream: NEW_AND_OLD_IMAGES`
  (`StreamSpecification` — cicd confirmed NON-destructive in-place update; pin
  it is `NEW_AND_OLD_IMAGES`, not just enabled). @covers `leaderboard` + `games`.
  (AC2.1, T-LB-1.)
- **R2.2 — IAM no-widening pins (code↔policy, §30).** RED: synth/policy tests —
  `oxo-board-fn` role = `dynamodb:GetRecords/GetShardIterator/DescribeStream/
  ListStreams` on the **Games stream ARN only** + `dynamodb:UpdateItem` on the
  **Leaderboard ARN only** + own Logs; assert NO Games-table grant, NO
  `Scan`/`Query`/`DeleteItem` on Leaderboard, NO wildcard. `oxo-game-fn` +=
  `Scan` on Leaderboard ARN only (lands with R3.5 read route but PIN the bound
  here). `oxo-ws-fn` gains NOTHING (assert policy unchanged from s007 baseline).
  `oxo-deploy` += scoped `UpdateFunctionCode`/`GetFunction` on board-fn ARN only,
  no `iam:*`. @covers `boardfn` + `gamefn` + `wsfn`. (AC2.3, AC3.7, AC5.12, T-LB-9.)
- **R2.3 — pure tally function.** RED: unit spec `domain-tally`. Given
  `{oldStatus:"active",newStatus:"won",winnerName:"ACE",loserName:"AAA",
  gameId:"G1"}` → exactly two ops `[{name:"ACE",field:"wins",gameId:"G1"},
  {name:"AAA",field:"losses",gameId:"G1"}]`; `newStatus:"drawn"`→ two `draws`
  ops; `newStatus:"abandoned"` (or any non-terminal) → ZERO ops (defence in
  depth behind the stream filter, SM-5). PURE — zero SDK/transport. @covers
  `domain-tally`. (AC2.4, AC2.5, AC2.6.)
- **R2.4 — idempotent store port + ddb & local adapters (THE CRUX).** RED:
  (a) ddb adapter unit/synth — per op a conditional `UpdateItem`:
  ```
  Key:                { playerName: <name> }
  UpdateExpression:   ADD wins :one, scoredGames :gameIdSet      (or draws/losses)
  ConditionExpression: NOT contains(scoredGames, :gameId)
  Values:             :one = 1, :gameId = "<gameId>", :gameIdSet = SS{"<gameId>"}
  ```
  **PIN the ConditionExpression string exactly** `NOT contains(scoredGames, :gameId)`
  (T-LB-3 mandates this literal). `topN` does Scan + in-memory sort (wins desc /
  losses asc / name asc) — Scan-only.
  (b) local adapter (`adapter-local-leaderboard`) MUST reproduce the conditional
  branch: process the same gameId twice → second call hits `ConditionalCheckFailed`-
  equivalent → swallowed (success-already-done), counters UNCHANGED, scoredGames
  has the gameId exactly once. This is the OFFLINE SM-4 proof (principles/02 — a
  mock encodes belief about platform semantics; the local adapter is the belief,
  the §30 probe is the real-platform check). @covers `port-leaderboard-store`,
  `adapter-leaderboard-ddb`, `adapter-local-leaderboard`. (AC2.7, AC2.8, T-LB-3/4.)
- **R2.5 — board-fn handler + ESM filter synth.** RED: (a) handler unit —
  parses a stream MODIFY record, reads OLD+NEW image FROM THE RECORD (no Games
  read), calls `domain-tally`, drives the store port; on `ConditionalCheckFailed`
  swallows + logs (category, buildSha) + does NOT fail the batch + does NOT
  retry; on a self-owned 5xx from Leaderboard (throttle after SDK backoff) logs
  `category:internal-service` (defect signal, §failure-handling). (b) synth —
  the event-source mapping FILTER CRITERIA pins `eventName=MODIFY` AND
  NEW.status ∈ {won,drawn} AND OLD.status=active (filter is the waste-cut, NOT
  the correctness guarantee). @covers `board-fn-handler` + `games-stream`.
  (AC2.2, AC2.7.) Logging is TESTED (§failure-handling).
- **R2.6 — §30 WALKING SKELETON (DEPLOY then PROBE A+B) — NEW-MECHANISM GATE.**
  Deploy the table+stream+board-fn (thin, E1/E2). Then run the committed make
  target `make board-stream-skeleton` against the DEPLOYED stack:
  - **Probe A (one real game-over → exactly one increment):** drive ONE real
    game to `won` through the REAL WS path (host create + guest join + moves to
    a win); assert winner `Leaderboard.wins` 0→1, loser `losses` 0→1, each
    `scoredGames` contains the gameId EXACTLY once. (Drive via the deployed WS
    path — the move CAS flips status active→won, the stream fires.)
  - **Probe B (replay → no double-count):** re-inject the SAME game-over stream
    record a second time (re-emit the transition via a controlled re-PUT of the
    won item, or replay the captured record into board-fn); assert BOTH
    `Leaderboard` rows are BYTE-IDENTICAL to after Probe A (no counter moved) AND
    `ConditionalCheckFailed` is observed in `oxo-board-fn` CloudWatch logs.
  Evidence RECORDED in the DORA ledger (validation_run rows, ref
  `<sha>:board-stream-skeleton`). This proves the at-least-once→idempotent
  contract end-to-end on the real platform — exactly where un-modelled stream
  semantics hide. **GATE: must be green before UC5.** @covers `games-stream`,
  `boardfn`, `leaderboard`. (AC2.9, AC2.10, T-LB-10.)
- **R2.7 — refactor + log-runbook fields.** Ensure board-fn structured log lines
  (buildSha, category, gameId, names, action) are documenter-ready; no flag to
  retire (backend-only). Cloud arms AC2.11/12/13 are tester's UC5.

---

# UC3 — GET /api/leaderboard + SPA leaderboard display (cross-instance read) — 5 steps

ENGINEER-SPA owns R3.1–R3.4 (display + client, builds against a LOCAL stub —
no UC2 dependency). ENGINEER-BACKEND owns R3.5 (read route + CF behaviour +
Scan grant) as a UC3-backend sub-task, serialised AFTER R1.5 in games/handler.ts.

- **R3.1 — sort + client state machine (pure + client).** RED: unit — `topN`
  sort on a 5-entry fixture: rank-1 = most wins; ties losses asc then name asc.
  RED: client spec — fetch `GET /api/leaderboard` against a local stub returns
  `{entries,buildSha}`; loading→ready, fetch-fail→error (NO aggressive retry
  loop; retry on next mount only). @covers `spa-leaderboard-client`. (AC3.1,
  AC3.4 client arm.)
- **R3.2 — Leaderboard component (all four states + XSS text pin).** RED:
  component spec — `<table data-testid="leaderboard" aria-label="Leaderboard">`
  with `<thead>` `<th scope="col">` Rank/Name/W/D/L and `<tbody>` of
  `<tr data-testid="leaderboard-row">` (`leaderboard-name`/`-wins`/`-draws`/
  `-losses`); loading `role="status"`/`aria-live="polite"`; empty "No scores
  yet — be the first."; error `role="alert"` "Couldn't load the leaderboard.".
  **STORED-XSS DISPLAY PIN:** a row name `"<img src=x onerror=alert(1)>"` renders
  LITERALLY (`cell.textContent` equals the raw string); assert NO
  `dangerouslySetInnerHTML` in the component (code-policy scan in the spec).
  @covers `spa-leaderboard`. (AC3.2/3/4/5, T-LB-8, A11Y-7/9/11/12.)
- **R3.3 — EXP-016 geometry/a11y assertion (visual correctness).** RED: a
  jsdom/Playwright assertion that the populated leaderboard renders as ROWS×COLS
  (a real `<table>` grid: N data rows each with 5 cells), NOT a single line/flat
  list. Mirror the EXP-016 board-geometry duty: assert row count == entries and
  each row exposes the 5 column testids; (Playwright bounding-box arm folds into
  UC5 smoke). @covers `spa-leaderboard`. (EXP-016, A11Y-7.)
- **R3.4 — integrate Leaderboard panel into GameRoot idle (SERIAL SEAM).** RED:
  GameRoot test (flag `uc3LeaderboardEnabled` ON) — the panel renders in the
  `idle` view BELOW the board, fetches on mount, refetches on return-to-idle.
  Heading is `<h2>` (A11Y-12). SMOKE-SELECTOR done condition: re-run
  `tests/smoke/` to confirm existing idle-screen selectors still isolate the
  CORRECT elements after adding the panel (surface-change discipline). @covers
  `spa-name-wire`/`spa-leaderboard`. (AC3.2, A11Y-12.)
- **R3.5 — read route + CloudFront 5s behaviour + Scan grant (BACKEND, §30
  cross-stack synth).** RED: (a) games/handler — `GET /api/leaderboard` returns
  `{entries:[{name,wins,draws,losses}], buildSha}` top-20 via `Leaderboard` Scan
  + in-memory sort; buildSha in body (principles/01). (b) `oxo-game-fn` +=
  `dynamodb:Scan` on Leaderboard ARN only (bound already pinned R2.2 — assert
  the grant now lands). (c) SYNTH cross-stack contract test in ONE file: the
  CloudFront `/api/leaderboard` behaviour has min/default/max TTL = 5s AND CF
  forwards a path that LITERALLY matches the HTTP-API route key (`GET
  /api/leaderboard` exists; OriginPath stripping consistent with `/api/games`);
  `POST /api/games` stays CachingDisabled. (E5.) @covers `gamefn` + `cfwaf`.
  (AC3.6, AC3.7, AC3.8, T-LB-6.) Deploy; flag-out `uc3LeaderboardEnabled`.

---

# UC4 — Two copy controls: Copy code + Copy link (DEFECT-S008-002) — 2 steps

ENGINEER-SPA, SERIAL after UC1/UC3 in GameRoot waiting screen. This CLOSES
DEFECT-S008-002 (only copy-link existed; the type-the-code path had no
affordance — multi-party §12b root cause: sharer modelled, guest's two receiving
paths not).

- **R4.1 — split copy-link into two distinct controls.** RED: component/GameRoot
  spec (flag `uc4TwoCopyEnabled` ON) — waiting screen renders BOTH:
  - `data-testid="copy-code-btn"` labelled "Copy code" → clipboard write of the
    6-char code string EXACTLY (e.g. `"ABC123"`), NOT the URL.
  - `data-testid="copy-link-btn"` labelled "Copy link" → clipboard write of
    `window.location.origin + "/join/" + code` EXACTLY, NOT the bare code.
  Each shows a 2s "Copied!" confirmation after a successful write. Both
  keyboard-operable with accessible names (A11Y). The defect (copy giving URL
  when the 6-char code was wanted) does NOT recur. NOTE: the existing single
  `data-testid="copy-link"` control is REPLACED — this is a surface change to a
  smoke-tested screen, so the done condition INCLUDES updating `tests/smoke/`
  waiting-screen selectors to isolate the two NEW controls by stable testid (not
  a count). @covers `spa-copy-controls` (redirect from delivered `spaCopyLink`).
  (AC4.1/2/3/4/7, DEFECT-S008-002.)
- **R4.2 — manual-entry regression + deploy.** RED: Playwright regression
  (against local stand-up) — the manual type-the-code join still works
  end-to-end (code displayed; Copy code content correct; join completes). Deploy
  SPA. Flag-out `uc4TwoCopyEnabled`. (AC4.5, AC4.6.)

---

# UC5 — Validation (TESTER, WAVE 2) — handed off

NOT built by the engineer. After UC1+UC2+UC3+UC4 deployed to prod (E2/E3/E4
satisfied; §30 Probe A+B green in ledger from R2.6), the TESTER derives the UC5
plan via `make impacted-tests SINCE=<s009-base-sha>` over the s009 `.mmd` marks
(EXP-013 first real use — kebab node ids above match the `@covers` tags). UC5
covers: two-browser SM-1 smoke, SM-2 collision, SM-3 default, SM-4 idempotency
replay, SM-5 abandoned-no-tally, SM-6 no-regression, DEFECT-S008-002 closure,
stored-XSS, IAM no-widening, the 12 WCAG conditions, EXP-016 leaderboard
geometry bounding-box. (AC5.1–AC5.24.) Engineer hands any failing in-prod
behaviour back as a defect task.

---

## Tooling self-service (§33) — new make targets THIS slice

- `make board-stream-skeleton PROD_URL=… API_BASE=… WS_URL=…` — the §30
  walking-skeleton (Probe A + Probe B) against the DEPLOYED stream path; records
  DORA validation_run rows (success/fail) mirroring the existing
  `move-skeleton`/`ws-skeleton` shape. Committed, parameterised, ENGINEER-owned.
- `make leaderboard-probe API_BASE=…` (optional thin) — single `GET
  /api/leaderboard` shape+buildSha check (UC3 prod surface probe). Folds into
  the skeleton or stands alone.
- Existing `make test-local` / `run-local` extended so the local stand-up serves
  the leaderboard stub + the local Leaderboard adapter (UC3/UC2 offline).

**Allowlist flag (→ cicd):** if `board-stream-skeleton` needs an AWS CLI command
class not already allow-listed (e.g. `aws dynamodb get-item`/`scan` for the byte-
identical assertion, `aws logs filter-log-events` for the ConditionalCheckFailed
log check), name it to cicd for the same-slice allowlist extension — do NOT use a
novel one-off command shape (IMP-001).

## Idempotency ConditionExpression to PIN (T-LB-3, the crux)

```
ConditionExpression: NOT contains(scoredGames, :gameId)
UpdateExpression:    ADD wins :one, scoredGames :gameIdSet
ExpressionAttributeValues: { ":one": 1, ":gameId": "<gameId>", ":gameIdSet": <SS {"<gameId>"}> }
```
(`wins` → `draws`/`losses` per outcome+role.) The marker is co-located with the
counter on the SAME name row so increment-and-mark is ONE atomic single-item
conditional write (the system's existing CAS primitive). Replay fails the
condition → no write → byte-identical row.
