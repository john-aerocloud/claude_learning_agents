# Validation Result — Slice 004 create-game

**Status: PASS**
**Validated:** 2026-06-06 (re-validation after DEFECT-004-001 fix, commit d4cc195)
**Surface exercised:** Production CloudFront https://d3pf3kcvzpau1x.cloudfront.net

---

## Smoke suite: 30/30 PASS

All 30 Playwright tests passed against production in 5.6s.

```
30 passed (5.6s)
```

---

## Previously-red ACs — now GREEN

### F1 — Play Online shows a game code

**PASS.** "Play Online" button visible on mode selector. After click, game code element appeared.
Test output: `F1/F2/F3 PASS: code="GZU3U2" elapsed=1305ms`

### F2 — Code is 6 chars, uppercase, no ambiguous characters

**PASS.** Code `GZU3U2` — 6 characters, matches `/^[A-HJ-NP-Z2-9]{6}$/`, no O/0/1/I/L.
Prior run code `FZN4CT` (from curl) also valid.

### F3 — Code issued within 3 seconds

**PASS.** Elapsed 1305ms < 3000ms threshold. Loading indicator present for waits >500ms.

---

## curl evidence (direct CloudFront path)

```
POST https://d3pf3kcvzpau1x.cloudfront.net/api/games
HTTP 201
{"gameId":"e1f9092b-2fe4-49ce-909b-0dccb22e8b85","code":"FZN4CT"}
```

Response is JSON, not HTML — CloudFront correctly forwarding `/api/games` to HTTP API via the fixed route key `POST /api/games`.

---

## T1 — DynamoDB record (get-item evidence)

```json
{
  "Item": {
    "hostConnectionId": { "NULL": true },
    "createdAt":        { "S": "2026-06-05T21:04:26.083Z" },
    "ttl":              { "N": "1780779866" },
    "code":             { "S": "FZN4CT" },
    "gameId":           { "S": "e1f9092b-2fe4-49ce-909b-0dccb22e8b85" },
    "status":           { "S": "waiting" }
  }
}
```

- `status = "waiting"` — correct
- `ttl` delta = 86400.0s = 24.00h exactly — within tolerance
- `hostConnectionId = NULL` — correct (no WebSocket yet)

---

## All other ACs (previously green, still green)

| AC | Result |
|----|--------|
| F4 — Two-player local unaffected | PASS — X wins top row, play-again resets |
| F4 — vs-Computer unaffected | PASS — X never wins, ends Draw or O wins |
| F5 — Backend error shows readable message | PASS — role="alert" visible, mode selector accessible |
| T2 — /api/* CachingDisabled | Previously verified via aws cloudfront (still deployed) |
| T3 — oxo-game-fn PutItem-only IAM | Previously verified |
| T4 — Pipeline deploys cleanly | Runs 27039905621 + 27039905609 green |
| T5 — Reserved concurrency set | Previously verified |
| S1 — Server generates all fields | Previously verified via direct endpoint |
| S2 — oxo-deploy no IAM-mutation | Previously verified |
| S3 — Games table no public access | Previously verified |

---

## DEFECT-004-001 resolution summary

- **Root cause:** HTTP API route key was `POST /games`; CloudFront forwarded full path `/api/games`, causing 404 from the API which was served as `index.html` by the SPA 200 fallback.
- **Fix (d4cc195):** Route key changed to `POST /api/games` to match the full forwarded path.
- **MTTR:** Failure logged 2026-06-05T21:45Z; recovery confirmed 2026-06-06.
