# Security controls — DynamoDB Leaderboard table

Introduced: Chunk 5 / slice s009 (delta 010). Data class: **durable per-NAME
W/D/L aggregates** keyed by a user-supplied, UNVERIFIED, UNAUTHENTICATED name
(arcade name-as-key model). FIRST and ONLY durable store in the system (all
other tables are TTL-ephemeral). Name collisions accumulate on one row BY DESIGN.

## Threat 1: stored XSS via name (the material new surface)
A free-text name is written here and RENDERED in other players' browsers. See
the full write-up in delta 010 §8. The Leaderboard-table-side controls:

Checkable controls:
- [ ] Names are stored only after server-side normalisation at the API write
      boundary: trimmed, length ≤ 10, charset-bounded (no `< > & " '` / control
      chars per the pinned regex). The store never receives raw HTML/script.
- [ ] The leaderboard view renders every `name` as ESCAPED TEXT (React default
      child escaping); **no `dangerouslySetInnerHTML` (or any innerHTML) on the
      name** — code-policy pin. (Render-side control; recorded here as the
      paired half of the stored-data risk.)

## Threat 2: leaderboard spam / manipulation / abuse (ACKNOWLEDGED)
Anonymous, unauthenticated play. Honest scope:

Checkable controls:
- [ ] Only the `oxo-board-fn` role can WRITE (`UpdateItem`); only `oxo-game-fn`
      can READ (`Scan`). Clients have NO direct write or read path to the table.
- [ ] A leaderboard update is accepted only from a **server-computed game-end
      transition** carried on the DynamoDB Stream (authoritative
      `active→won/drawn`), never from a client-asserted result.
- [ ] Writes are idempotent per `gameId`: each participant row's
      `UpdateItem` carries `ConditionExpression NOT contains(scoredGames,
      :gameId)` and `ADD scoredGames {gameId}` in the SAME atomic write — a
      replayed game-over (at-least-once stream delivery) cannot double-count
      (SM-4). `ConditionalCheckFailed` is treated as already-done (swallow).
- [ ] Abandoned games produce NO write (the stream filter requires
      `OLD.status=active AND NEW.status∈{won,drawn}`; `abandoned` is excluded) —
      SM-5.
- [ ] Self-play farming is partially bounded (a server-authoritative
      `won`/`drawn` needs two distinct WS connections + the move CAS); NOT fully
      defeated under anonymity — documented limitation at this scope.
- [ ] Impersonation (asserting another's name) and offensive names are INHERENT
      to the product-chosen unauthenticated arcade model — explicitly
      acknowledged, moderation OUT OF SCOPE this slice (no job demand).

## Platform / data-protection controls
- [ ] Encryption at rest enabled (SSE, AWS-managed key); access scoped to this
      table ARN only (board-fn `UpdateItem`, game-fn `Scan`) — no wildcard.
- [ ] **Point-in-time recovery (PITR) ENABLED** — this is the only durable data
      store; standings must be recoverable.
- [ ] **NO TTL** — standings persist by design (the first non-TTL table; the
      absence is a decision, synth-assert no TTL attribute).
- [ ] PK = `playerName` (String); no GSI in this slice.
