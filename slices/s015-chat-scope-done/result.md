---
slice: s015-chat-scope-done
iteration: 18
tester: tester (Claude Sonnet 4.6)
date: 2026-06-08
outcome: PASS
sha-under-test: 9794c5e576a946becf8abf85aa9fc65ae607fe23
prod-url: https://d3pf3kcvzpau1x.cloudfront.net
smoke-duration: 14.9s
smoke-count: 91/91
---

# Validation result — s015: C7 done-condition

## Verdict: PASS

All acceptance cases confirmed against the live production deployment.

## C7 DONE-CONDITION MET

All six conditions required to declare C7 (in-game chat) done are satisfied:
1. s014 delivered: chat send/receive, two-browser relay, XSS rejection, WCAG sweep — CONFIRMED by prior slice.
2. AC1.1 S-SCOPE-1 main: cross-game isolation — CONFIRMED in this slice.
3. AC1.2 S-SCOPE-1 forged-gameId: silent reject — CONFIRMED in this slice.
4. AC1.3 T-P95-1: formal p95 <= 1000ms — CONFIRMED in this slice.
5. AC1.4 T-GAMEOVER-1: chat absent post game-over — CONFIRMED in this slice.
6. AC1.5 S-regression: 91/91 prior flows unaffected — CONFIRMED in this slice.

**C1-C7 roadmap COMPLETE.**

---

## Per-AC verdict

| AC | Case | Result | Evidence |
|----|------|--------|----------|
| ID-1 | Identity: served build-sha == deployed sha | PASS | served="9794c5e576a946becf8abf85aa9fc65ae607fe23" |
| AC1.1 | S-SCOPE-1 main: C3 receives zero frames from G1 | PASS | C1 sent 3 msgs in G1; C2 received all 3 (relay live); C3 received ZERO frames |
| AC1.2 | S-SCOPE-1 forged-gameId: silent reject, C3 WS stays open | PASS | C3 sent forged frame (gameId=scratch); C1/C2 counts unchanged; C3 WS readyState=1 |
| AC1.3 | T-P95-1: >=5 sends, p95 <=1000ms | PASS | p95=196ms (5 samples: [192,193,188,193,196]ms; min=188ms; max=196ms; mean=192ms) |
| AC1.4 | T-GAMEOVER-1: chat absent on both screens post game-over | PASS | X wins game played to completion; chat-input, chat-send-btn, chat-panel all absent BOTH host+guest |
| AC1.5 | S-regression: all prior flows unaffected | PASS | 91/91 (full smoke suite) |

---

## Guard specs committed

Three new spec files added to `tests/smoke/`:

1. **`slice015-s-scope-1-isolation.spec.ts`** — AC1.1
   - Three browser contexts (C1=G1-host, C2=G1-guest, C3=G2-host waiting).
   - C1 sends 3 messages; C2 receives all 3 (positive control); C3 has zero chat-message elements.
   - Stable selectors: `[data-testid="chat-messages"]`, `[data-testid="chat-message"]`, `[data-testid="game-code"]`.

2. **`slice015-s-scope-1-forged.spec.ts`** — AC1.2
   - Four browser contexts (C1=G1-host, C2=G1-guest, C3=G2-host, C4=G2-guest).
   - `addInitScript` patches the WebSocket constructor on C3's page BEFORE load → stores the SPA's authenticated WS instance on `window.__oxoWs`.
   - `page.evaluate()` sends `{action:'chat', gameId:<scratch>, text:'probe'}` via C3's live G2 WS connection.
   - Server: `senderRoleFor(scratchGame, C3-G2-connectionId)` → null → `reject('not-a-player')` → zero PostToConnection.
   - Assertions: C1/C2 counts unchanged; C3 WS readyState=1 (still OPEN after silent reject).
   - Mechanism verified: `sent=true, wsReadyState=1, error=null`; C1/C2 counts before=1 after=1.

3. **`slice015-t-p95-gameover.spec.ts`** — AC1.3 + AC1.4
   - T-P95-1: 5 samples; measures latency from `chatInput.fill()` to `toHaveCount(N)`; p95 = `sorted[Math.ceil(0.95*N)-1]`.
   - T-GAMEOVER-1: plays X:0,O:3,X:1,O:4,X:2 → X wins; asserts all three chat elements absent on BOTH host+guest screens.
   - ChatPanel unmount mechanism confirmed: `GameRoot.tsx:522` — `{onlineGame.result === undefined && <ChatPanel .../>}`.

---

## Identity (principles/01)

Served build-sha `9794c5e576a946becf8abf85aa9fc65ae607fe23` matches the deployed sha (last SPA build; s015 has no code change). DISTRIBUTION condition assessed at outset: HEAD is s015-docs commits (`532d746`), deployed sha is s014 build sha (`9794c5e`) — this is expected and not a behavioural failure.

---

## EXP-019 data point

| Metric | impacted+core | Full smoke |
|--------|---------------|------------|
| Test count | 0 impacted + 6 core + 7 new s015 | 91 total |
| Spec files | 9 (6 core + 3 new) | 15 |
| Wall-time | ~6s (s015-only run) | 14.9s |

Impacted-tests returned 0 changed nodes (no .mmd changes for this no-code slice). The validate-impacted fast path would run 6 core specs + the 3 new s015 specs = ~9 spec files. Full smoke = 15 spec files (91 tests). For this no-code-change slice the EXP-019 fast-path improvement is ~40% fewer spec files.

---

## Budget provenance

- CloudFront WAF exemption: `88.97.176.116/32` added before run, removed after run.
- WS authorizer exemption: `EXEMPT#88.97.176.116` DDB item added before run, removed after run.
- Both layers confirmed clean at run end (waf-runner-ip-remove reported count=0 and exemption removed).

---

## DORA rows recorded

- `validation_run` success: ref=`9794c5e576a946becf8abf85aa9fc65ae607fe23:smoke`, 91/91 PASS.
- `task_end` success: ref=`S015-UC1`, C7 DONE-CONDITION MET / C1-C7 roadmap COMPLETE.
