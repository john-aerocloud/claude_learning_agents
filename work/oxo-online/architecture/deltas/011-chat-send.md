# Delta 011 — s014 in-game chat: message send + relay (C7 opens)

Slice: `work/oxo-online/slices/s014-chat-send/slice.md` (GATE-2-S014, iteration 16).
Chunk: C7 (in-game chat — last forecast chunk; s015 closes it). §12b multi-party.

## 0. One-line delta

ONE new WS action route `chat` on the EXISTING WebSocket API → the EXISTING
`oxo-ws-fn`. The handler relays a user free-text message to the opponent
(1 `@connections` POST) + echoes to the sender (1 POST), identity SERVER-DERIVED
by `connectionId` match (reuse the s006 move pattern verbatim: `gameId` is a
NON-TRUSTED lookup key, `connectionId` is the identity). **In-memory only — NO
DynamoDB write of any kind.** The ONE material new thing is user free-text
crossing to another browser (XSS), controlled by React text-render + a
no-raw-HTML code-policy pin (same family as s009 names).

## 1. Mechanism — what is added (and the negatives, confirmed)

- **Route:** `chat` added to the EXISTING WS API. Route count **5 → 6**
  (`$connect`/`$disconnect`/`register`/`join`/`move`/**`chat`**); still **no
  `$default`**. `chat` is post-`$connect` (connection already authorized; the
  `$connect` authorizer does NOT re-run per message — same as `move`).
- **Handler (`oxo-ws-fn`, `chat` route):**
  1. Parse `{action:'chat', gameId, text}`. `gameId` is a NON-TRUSTED lookup key.
  2. `GetItem(Games, gameId)` — **already-granted read** (s006). Miss → reject,
     no relay.
  3. Match `event.requestContext.connectionId` against `hostConnectionId` /
     `guestConnectionId` → `senderRole` (`host`/`guest`). Match NEITHER →
     **reject silently, no relay, no write** (no cross-game injection — S-case,
     the same authorization invariant as the s006 move path).
  4. Normalise `text` (see §2): trim; reject if empty after trim; cap 200 chars;
     server-side bound on control/markup chars (depth control).
  5. Build `{action:'chat-message', sender:senderRole, text:<normalised>}`.
  6. **Relay to the OPPONENT's `connectionId`** — 1 `PostToConnection`.
     `GoneException` (410) → **swallow, no retry, continue** (best-effort; dead
     opponent, §3 of slice.md).
  7. **Echo to the SENDER's `connectionId`** — 1 `PostToConnection`. `GoneException`
     → swallow. (Echo is the only confirmation; no separate response frame.)
- **No `Games` write. No `Leaderboard` write. No new table. No Stream.** The
  message lives only in React component state on both clients; it vanishes on WS
  close / reload. This is explicit design (slice.md "In-memory: no persistence").

### Negatives confirmed (assert-the-negative)

- **No new function** — reuses `oxo-ws-fn`.
- **No new table / no new store / no persistence** — in-memory only.
- **No new API / no new stage / no new region** — same WS API, eu-west-2.
- **No new principal.**
- **NO new IAM grant.** `oxo-ws-fn` already holds `GetItem` on `Games` (s006)
  and `execute-api:ManageConnections` on **this WS API ARN only** (s005). The
  chat relay + echo are two more `PostToConnection` calls on the same grant.
  Confirms OI-CHAT-1: existing `ManageConnections` covers chat relay; no widening.
- **No new deploy-role grant** — `chat` is a CDK-synthesised route on an existing
  API; `oxo-deploy` already has scoped `UpdateFunctionCode` on the `oxo-ws-fn` ARN.

## 2. XSS control (the crux — HIGH; OI-CHAT-2)

Chat `text` is user-controlled, sent over an unauthenticated WS, and rendered in
the OPPONENT's browser. Same stored/reflected-XSS class as the s009 leaderboard
name. Defence-in-depth, two halves:

**(a) Render-side — THE primary control (display-side pin).** The SPA renders
every `chat-message.text` via React child interpolation (`{msg.text}`), which
HTML-escapes by default, so `<img src=x onerror=alert(1)>` renders as the literal
string — no script, no image load. **`dangerouslySetInnerHTML` / `innerHTML` /
any raw-HTML sink on chat text is PROHIBITED** — added to the code-policy pin
list alongside the s009 leaderboard-name pin. This is THE control.

**(b) Write/relay-side — depth + abuse cap (server bound).** At the relay
boundary the handler: trims; rejects empty-after-trim; **caps length at 200
chars** (bounds DOM cost of a flood and the blast radius of any injection);
strips control chars. **Decision (OI-CHAT-2):** React escaping is the real XSS
control; the server bound is defence-in-depth + an abuse cap, NOT the primary
defence. We DO strip/encode `<>&"'` server-side (cheap, matches the s009 name
normalisation, and protects any FUTURE path that might persist or re-serve the
text — there is none today). Confirmed: **200-char cap + strip `<>&"'` + control
chars** at the boundary.

**CSP:** UNCHANGED. No new directive, no new origin, no new sink — chat text is
DOM text, not script/style/connect. Confirmed (the existing CSP that backs the
s009 name render covers chat render identically).

**Code-policy pin (T/S condition):** the chat message component MUST render text
via React interpolation and MUST NOT use `dangerouslySetInnerHTML`/`innerHTML`.
This is a grep-able / lint-able render-side pin, tested as a unit render assertion
(`textContent` of the rendered item === the raw injection string — slice success
measure 3).

## 3. New attack surface vs s006 + s009 (the gating assessment)

- **Trust model:** IDENTICAL to s006 move relay — `connectionId` is the
  platform-set, unspoofable identity; `gameId` is a non-trusted lookup key that
  only selects which `Games` item to authorize against; a forged/foreign `gameId`
  resolves a game the sender's `connectionId` is not bound to → reject, no relay.
  **No cross-game message injection** (the same invariant GATE-3-S006 approved).
- **Data flow:** a NEW data flow (a `chat`-triggered 1-relay + 1-echo over the
  existing `@connections` gate). NOT a new trust boundary; NOT a new public
  surface, principal, table, API, region, or IAM grant.
- **The ONE material new thing:** user FREE-TEXT crossing to another browser —
  the XSS surface. This is the SAME controlled class already shipped in s009
  (leaderboard names), with the SAME control (React escape + no-raw-HTML pin +
  server length/charset bound). It is NOT a novel surface; it is a second
  instance of an already-accepted, already-controlled class.
- **Abuse (profanity/spam):** inherent to the product-chosen unauthenticated
  model; blast radius bounded to the two players of one game; moderation out of
  scope (LOW, acknowledged — slice.md). No action this slice.

## 4. New-mechanism flag

**NO new platform integration mechanism.** `chat` is another route on the
existing WS API → existing `oxo-ws-fn`; `PostToConnection` over `@connections` is
the s006 mechanism, already proven by a real-client walking-skeleton probe at
s005-h2/s006. **No §30 walking-skeleton probe is required for s014** (no
first-use of any service/protocol/behaviour class). The XSS render-as-text
control is the same class proven in s009.

## 5. Local stand-up gap (principles/02)

- **Stands locally:** the chat handler's pure decision logic
  (`(connectionId, gameItem, rawText) → {senderRole | reject, normalisedText,
  relayTargets}`) over the existing `Games` store port + relay transport port
  (the s006 hexagonal ports, OI-17). The SPA chat input + message list render
  locally. **The local WS server (the existing local adapter) MUST relay + echo
  the `chat` frame** so the engineer's two-browser local tests exercise
  send→relay→echo→render end-to-end. NAME THE GAP: the local WS adapter needs a
  `chat`-route case added (relay to the other local connection + echo to sender,
  `GoneException` simulated by a closed local socket) — without it the local
  two-browser chat path cannot stand. This is a local-adapter code task for the
  engineer, not a cloud-only gap.
- **Cloud-only (control that covers it):**
  - `GoneException` (410) real platform behaviour on a dead `@connections` target
    — covered by **prod validation** (slice success measure 4) + the local
    closed-socket simulation as a stand-in (not byte-identical to 410, so prod
    is the proof of record).
  - `ManageConnections` IAM scoping (this API ARN only, no widening) — covered by
    **synth/IAM policy test** (no-new-grant assertion, T-CHAT-5).
  - The route count = 6 / no-`$default` — covered by **synth contract test**.

## 6. Version-identifiable deployment (principles/01)

No new deployable SURFACE. `oxo-ws-fn` is redeployed with the new route; its
build identity is the EXISTING `buildSha` carried in its CloudWatch structured
log lines (unchanged carrier). The `chat-message` relay frame is an ephemeral
in-band message, not a versioned surface; no build-identity field is added to it
(consistent with `move`/`board-update`/`game-over` frames). No change to the
SPA's `OXO_CONFIG.buildSha` or the leaderboard `buildSha` body field.

## 7. Retry/backoff posture (per call)

- **`chat` relay POST (opponent) and echo POST (sender):** **explicit decision
  NOT to retry.** Best-effort delivery (slice.md). `GoneException`/any post error
  → swallow + log, continue. Rationale: chat is ephemeral, in-memory, non-
  authoritative; a missed message is harmless (no state depends on it), and a
  retry storm against a dead connection is the exact failure s007 already ruled
  out. Timeout budget: the default `@connections` SDK timeout (same as the s006
  move relay); no custom backoff. When the post "exhausts" (i.e. errors once): the
  sender still has their echoed message (echo is attempted independently); the
  opponent simply does not receive it. No error frame to the sender.

## 8. Acceptance conditions (T/S — the technical/observable half)

Product assembles `acceptance.md`; these are the architect-supplied conditions.

- **T-CHAT-1 (route surface):** exactly SIX WS route keys synthesised
  (`$connect`/`$disconnect`/`register`/`join`/`move`/`chat`); NO `$default`.
- **T-CHAT-2 (connectionId identity / no cross-game injection):** a `chat` frame
  whose REAL `connectionId` matches NEITHER bound connection of the `Games` item
  named by `gameId` (forged/foreign/non-existent `gameId`, spectator, stale conn)
  → **reject, zero relay POSTs, zero writes**. Sender role is derived server-side
  from the connectionId↔stored-binding match, NEVER from any body field.
- **T-CHAT-3 (XSS render-as-text — the pin):** a `chat-message` whose text is
  `<img src=x onerror=alert(1)>` (or `<script>…`) renders as the LITERAL string
  in the recipient's browser — `textContent` of the rendered list item === the
  raw string; no script exec, no resource load. AND a code-policy pin: the chat
  component contains NO `dangerouslySetInnerHTML`/`innerHTML`/raw-HTML sink on
  chat text (grep/lint assertion).
- **T-CHAT-4 (server bound — depth):** the handler trims, rejects empty-after-
  trim, caps at 200 chars (longer text truncated or rejected — engineer's choice,
  pinned), and strips/encodes `<>&"'` + control chars before relay.
- **T-CHAT-5 (no-new-IAM):** `oxo-ws-fn`'s IAM policy is the s007 grant set
  verbatim — `chat` adds ZERO permissions (`GetItem` on `Games` + `ManageConnections`
  on this WS API ARN already granted). No new action, no `*`, no new table grant.
- **T-CHAT-6 (in-memory / no-persist):** the `chat` path performs ZERO DynamoDB
  writes (no `Games`, no `Leaderboard`, no new table). Verified by asserting no
  write call on the `chat` route + no schema change to any table.
- **T-CHAT-7 (GoneException best-effort):** a relay POST to a gone opponent
  returns 410 → caught, dropped, NO retry; the sender's handler completes
  normally (echo still attempted), no crash, no error frame to sender, sender's
  WS stays open. (s015 proves the full two-browser e2e + 1s p95.)
- **T-CHAT-8 (bounded fan-out):** an accepted `chat` = EXACTLY 2 `@connections`
  POSTs (relay + echo); a rejected `chat` (no connectionId match) = 0 POSTs.
  Never a broadcast.
- **T-CHAT-9 (CSP unchanged):** no new CSP directive/origin introduced by chat.
- **S-regression:** all existing game/move/join/disconnect/leaderboard flows
  produce identical outcomes (slice success measure 5).

## 9. Security conclusion (gated review) — VERBATIM

**Is there new attack surface / data flow / trust boundary? A new DATA FLOW (the
`chat`-triggered 1-relay-to-opponent + 1-echo-to-sender over the existing
`@connections` gate, carrying user free-text) — YES; a new public surface,
principal, table, API, region, persistence, or IAM grant — NO; the one material
new exposure is user free-text crossing to another browser, which is the SAME
stored/reflected-XSS class already shipped and controlled in s009 (leaderboard
names), controlled here by the identical defence-in-depth — React text-render as
THE primary control with an explicit `dangerouslySetInnerHTML`/raw-HTML-sink
code-policy pin, plus a server-side 200-char + `<>&"'` + control-char bound at
the relay boundary as depth and abuse cap, behind the UNCHANGED CSP; the
authorization edge is unchanged from GATE-3-S006 (platform-set `connectionId` is
the identity, `gameId` is a non-trusted lookup key, a forged/foreign `gameId`
resolves a game the sender is not bound to → reject with no relay, so there is NO
cross-game message-injection path), and the relay grant is the s005
`ManageConnections` on this WS API ARN only, unwidened; therefore this is NOT a
brand-new §9a auto-accept of a never-seen surface, but because the only new
exposure is a second instance of an already-accepted, already-pinned XSS class
under the same control and the rest of the slice introduces no new trust
boundary or grant, the architect ACCEPTS the design for build under §9a
auto-accept and does NOT flag it for human eyes — the XSS surface is the
controlled class already approved in s009, not a new attack surface.**

### §9a disposition
**AUTO-ACCEPT (no human flag).** Rationale: the XSS surface is the same
controlled, already-shipped class (s009 names) under the identical render-as-text
pin; the trust model is the unchanged s006 connectionId-identity invariant; no
new principal/table/API/region/IAM/persistence. Flag basis for human eyes would
be a NOVEL or differently-controlled abuse surface — not present here.

### Carried open risks (accepted, named)
- **OR-S014-a — unmoderated free-text abuse (profanity/spam):** inherent to the
  product-chosen unauthenticated model; blast radius bounded to the two players
  of one game; moderation out of scope. Acknowledged (slice.md LOW).
- **OR-S014-b — best-effort, no-retry relay/echo:** a dropped chat message is not
  re-pushed (consistent with s006/s007 relay posture); chat is non-authoritative
  in-memory state, so a miss is harmless. Recovery = re-send.
- Inherited: OR-H2-b (guest code-as-credential pre-join, closed by future
  identity), OR-S006-a, OR-S006-b (as re-worded at s007).
