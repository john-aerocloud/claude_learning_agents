---
slice: s015-chat-scope-done
chunk: C7
job: SECONDARY — connection through banter
status: in-planning
selection-ref: SEL-S015
---

# s015 — chat scope enforcement + C7 done-condition proof

## Job served

When I am playing a game with a friend, I want to exchange short messages during
the game, so that the match feels like a shared social experience rather than two
people silently clicking. (C7 job — connection through banter.) [SECONDARY]

## Why this slice exists (honest accounting against s014)

s014 delivered the chat mechanism and proved it in production. It also recorded
three explicit deferred gaps with committed scope-boundary notes:

1. **T-CHAT-2 cross-game injection — WAIVED to s015.** s014 unit-tested the
   connectionId-identity model (AC1.3/1.4 in chat-handler.test.ts) but explicitly
   deferred the prod-observable guard: a Playwright test in which a third
   connection in a *different* game cannot receive messages from a different game's
   chat channel. This is a security/correctness property. Unit tests prove the
   logic; the prod guard closes the gap.

2. **Formal 1s p95 latency — deferred to s015.** s014 recorded one informal
   199ms data point and labelled the formal p95 Playwright assertion "s015." The
   C7 done-condition says "appear within 1 second (p95)" — this is the literal
   done-condition text. Without a committed Playwright assertion it is not pinned.

3. **Chat input state after game-over — not yet pinned.** s014 AC3.6 proved chat
   absent on idle/waiting screens. The game-over state (result screen shown, board
   locked per s006) was not explicitly tested. The C7 forecast includes "chat input
   disabled after game-over." This is a small UI state check; if the input is not
   already disabled, a one-line conditional is needed.

## Scope (thin)

This slice is primarily tester-validation of existing behaviour, with a possible
tiny code change only if the game-over chat-input state is not already enforced.

1. **Prod cross-game isolation test (T-CHAT-2):** A committed Playwright spec
   opens three browser contexts: Player A and Player B in Game 1, and Player C in
   Game 2 (or as a spectator with a fake/unrelated connection). Player A sends a
   chat message in Game 1. Assert Player C's context receives zero chat-message
   frames. This is a prod-observable guard against scope leak — not addressed
   by any existing committed spec.

2. **Formal p95 latency assertion:** A committed Playwright spec measures A-types
   to B-sees latency over N samples (min 5 sends) and asserts p95 <= 1000ms. Uses
   the same two-browser Chromium approach as s014 AC3.1 but as a standing
   regression spec, not a one-off informal measurement.

3. **Game-over chat-input state:** Playwright assertion that the chat input is
   absent or disabled on the game-over/result screen. If the input is not already
   disabled in that state, add the conditional (`status === 'game-over'`) to
   the `ChatPanel` or `GameRoot` component. The board is already locked post-game
   (s006); this aligns the chat control with that behaviour.

## Killick test

A player can be confident that:
(a) their chat messages cannot leak to other games (prod-observable, not just
    unit-assured), and
(b) the chat feature meets its stated 1s p95 SLA by a committed standing spec.

These two things could not be confirmed before this slice (T-CHAT-2 was a unit-only
waver; the latency was an informal single point). That is real value: a security
property pinned in prod and a done-condition asserted by a standing test.

## Is this UI-bearing?

Potentially yes for the game-over chat-input state. If the chat input is already
absent on the result screen, the spec is a pure validation (no code change). If it
is not, a small conditional change to `ChatPanel` or `GameRoot` is required.
The engineer/tester should check the current behaviour first; the code change is
only made if the gap exists. In either case the Playwright assertion is committed.

## What is NOT in scope

- Persistence, history, typing indicators, read receipts, emoji pickers —
  none of these are part of C7's job or done-condition.
- Profanity moderation — not in C7.
- Reconnect/rejoin chat history — not in scope; messages are in-memory and s007
  already handles disconnect (game abandoned; both sides return to mode selector).
- Any changes to the relay logic, DynamoDB schema, or WS protocol.
- Cross-device or cross-browser compatibility beyond Chromium Playwright.
- Increasing the 200-char message limit.
- C8 or beyond — the roadmap is complete at C7.

## Success measures

| ID | Measure | How observed |
|----|---------|-------------|
| SM-1 (T-CHAT-2 prod guard) | Player C in Game 2 receives zero chat-message frames when Player A sends in Game 1 | Committed Playwright spec; assertion on C's received-messages array (expect.toHaveLength(0)) |
| SM-2 (p95 latency) | Over >= 5 A-sends, p95 of A-types-to-B-sees latency is <= 1000ms | Committed Playwright spec; timestamps captured in test; p95 calculated and asserted |
| SM-3 (game-over state) | Chat input absent or has `disabled` attribute on result/game-over screen | Committed Playwright assertion; element count = 0 or disabled=true |
| SM-4 (no regression) | Full 84+ test suite green | CI run; all existing suites pass |
| SM-C7-DONE (C7 done-condition proof) | All of: two players exchanged messages mid-game (s014), messages appeared within 1s p95 (SM-2), chat scoped to active game (AC3.6, s014), no cross-game leak in prod (SM-1), no persistence (T-CHAT-6, s014), input off at game-over (SM-3) | SM-1 + SM-2 + SM-3 pass; s014 result on file |

## C7 done-condition mapping

C7 done-condition: "both players can send and receive short text messages; messages
appear within 1 second (p95); chat is scoped to the game session and messages do
not persist after the game ends."

| Done-condition clause | Where proved |
|-----------------------|-------------|
| Both players can send and receive | s014 AC3.1/3.2/3.3 (PASS, prod) |
| Within 1 second (p95) | SM-2 this slice (formal p95 assertion) |
| Scoped to game session — no cross-game | SM-1 this slice (prod guard) |
| Messages do not persist after game ends | T-CHAT-6 (s014, PASS, synth+unit); SM-3 (input gone at game-over, this slice) |

All clauses pinned when this slice passes.
