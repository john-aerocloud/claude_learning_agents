---
slice: s014-chat-send
iteration: 16
tester-task: UC3 in-prod validation
last-validated-sha: 1c49c28
deployed-sha: 91b13653 (SPA sha; HEAD at run time: d2f7c0a is process-only commit)
smoke-run: 2026-06-08 — 84/84 PASS
impacted-tests-run: 2026-06-08
---

# Test plan — s014-chat-send (EXP-013 second use / post-OI-42)

## EXP-013 scoring signal

**Changed-node count this run: 25**
(vs s009 inflated run: 79 nodes / 49 covered — that run full-file-scanned for
`changed`-named classes, pulling in prior-slice stale marks)

**Clean-list assessment: CONFIRMED CLEAN.** OI-42 fix delivered. 25-node count
reflects ONLY s014's genuinely new/changed nodes. No stale prior-slice marks leaked.
`:::s014changed` class was added in-window; `:::s007changed`, `:::s009changed` etc.
were NOT added in-window, so they did not inflate the count. Delta from s009: 79→25
nodes (68% reduction). Planning time: <1s tool run vs ~12min manual in s009.

---

## IMPACTED SPECS — tick-off (ALL GREEN)

| Node | Covering spec | Status |
|------|--------------|--------|
| adapter-local-relay | local/adapters/local-relay.test.ts, move-handler.test.ts, tests/local/disconnect.local.spec.ts, tests/local/move-relay.local.spec.ts | [x] Green |
| chat-input | src/game/ChatInput.test.tsx, tests/local/chat.local.spec.ts | [x] Green |
| chat-message | src/game/ChatMessage.test.tsx, tests/local/chat.local.spec.ts | [x] Green |
| chat-message-list | src/game/ChatMessageList.test.tsx, tests/local/chat.local.spec.ts | [x] Green |
| chat-panel | src/game/ChatPanel.test.tsx, tests/local/chat.local.spec.ts | [x] Green |
| domain-chat | local/chat-handler.test.ts, lambda/ws/chat-handler.test.ts, lambda/ws/chat/normalise.test.ts | [x] Green |
| games | infra/test/game-stack-s009.test.ts, lambda/ws/adapters/games-ddb.test.ts, lambda/ws/join.test.ts | [x] Green |
| port-game-store | lambda/ws/adapters/games-ddb.test.ts | [x] Green |
| port-relay | lambda/ws/adapters/relay-mgmt.test.ts | [x] Green |
| spa-online-chat | src/game/GameRoot.test.tsx, tests/local/chat.local.spec.ts | [x] Green |
| spaJoinScreen | src/game/JoinScreen.test.tsx | [x] Green |
| ws-chat-handler | local/chat-handler.test.ts | [x] Green |
| wsfn | infra/test/game-stack-s014.test.ts, lambda/ws/chat-handler.test.ts, etc. | [x] Green |

---

## UNCOVERED CHANGED NODES — dispositions (ALL WAIVED or NEW SPEC WRITTEN)

| Node | Disposition | Resolution |
|------|------------|------------|
| ChatInput | WAIVER: component-map capitalised alias for `chat-input` — same component, covered by ChatInput.test.tsx and local smoke | WAIVED |
| ChatMessage | WAIVER: alias for `chat-message` | WAIVED |
| ChatMessageList | WAIVER: alias for `chat-message-list` | WAIVED |
| ChatPanel | WAIVER: alias for `chat-panel` | WAIVED |
| S14UC1 | WAIVER: UC1 done-condition verified by synth + unit tests (T-CHAT-1/5/6 in game-stack-s014.test.ts; identity/relay/GoneException in chat-handler.test.ts) | WAIVED |
| S14UC2 | WAIVER: UC2 done-condition verified by component tests + chat.local.spec.ts | WAIVED |
| S14UC3 | NEW SPEC WRITTEN: slice014-chat-send.spec.ts — 8 tests covering all UC3 ACs | SPEC WRITTEN + GREEN |
| S6UC3 | WAIVER: s006 UC3 annotation-only edge change (relay gains chat fan-out annotation); relay end-to-end covered by two-browser smoke | WAIVED |
| S6UC4 | WAIVER: s006 UC4 annotation only; relay seam covered by regression | WAIVED |
| player | WAIVER: `player` = actor node in data-flow.mmd; covered by two-browser browser tests | WAIVED |
| relay | WAIVER: `relay` = API GW Management API gate node; covered end-to-end by two-browser smoke (if relay fails, B never sees A's message) | WAIVED |
| spaWsClient | WAIVER: socket.ts WS client seam; chat frames flow through same seam as move/disconnect; existing smoke validates seam stays functional | WAIVED |

---

## Acceptance case coverage — FINAL STATUS

| AC | Description | Status | Evidence |
|----|-------------|--------|---------|
| ID-1 | Identity: build-sha == deployed sha | PASS | sha="91b13653" matched |
| AC3.1 / F1 | B sees A's message within ~1s (Opponent) | PASS | latency=199ms |
| AC3.2 / F2 | A sees own echo labelled "You" | PASS | Echo confirmed |
| AC3.3 | Bidirectional relay B→A | PASS | B sent "well played"; A saw "Opponent" |
| AC3.4 / F3 / T-CHAT-3 | XSS injection as literal TEXT; no img node; no dialog | PASS | text="img src=x onerror=alert(1)"; 0 img nodes; dialogFired=false |
| AC3.5 / F4 / T-CHAT-7 | GoneException: A's screen functional after B disconnects | PASS | board cell 0 visible; 0 crash errors |
| AC3.6 / F5 | Chat absent on waiting/idle; present on active game | PASS | 0 chat-input on idle/waiting |
| AC3.8 / WCAG-S014-1..10 | WCAG structural sweep (role, aria, target size, focus) | PASS | role=log; aria-live=polite; Send 71×40px; focus stays in input; sender label TEXT |
| AC3.9 / LAYOUT-S014-1 | Chat panel below board; messages stack vertically | PASS | board bottom=377, panel top=401; row stack confirmed |
| AC3.10 / T-CHAT-9 | CSP unchanged | PASS | CSP header present; wss:// covers chat; no new origin |
| T-CHAT-2 | No cross-game injection | WAIVER | Unit tests + connectionId model reasoning (prod cross-game test is s015 scope) |
| T-CHAT-6 | In-memory / no DynamoDB write | PASS | Synth test: no new table; unit test: zero writes |
| Regression | Existing flows unaffected (s006/s007/s008/s009) | PASS | 84/84 full suite green |

---

## Rate-limiting budget

- WAF exemption added: 88.97.176.116/32 (CIDR)
- DDB exemption added: EXEMPT#88.97.176.116 (1h TTL)
- Suite run: 84 tests, ~10 WS connects, within budget
- WAF exemption removed: confirmed (count=0)
- DDB exemption removed: confirmed
