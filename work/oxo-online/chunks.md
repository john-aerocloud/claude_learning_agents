# Chunks — high-level value sequence

Coarse slices, ordered by value-per-lead-time. Each Chunk decomposes into slices
at iteration time. Maintained by Product + Solution Architect.

For the full delivery plan (slice-to-chunk mapping, delivered actuals, and remaining forecasts) see [chunk-plan.md](chunk-plan.md).

| # | Chunk | JTBD served | depends on | status |
|---|-------|-------------|------------|--------|
| 1 | **Deployable shell** — React frontend + minimal server deployed to AWS behind a real URL; nothing functional yet, but a real production deployment pipeline exists | Availability (always-on, no-install) | — | pending |
| 2 | **Local two-player game** — single-browser noughts and crosses: board renders, moves alternate, win/draw detection, result shown | Playing against a real human (functional core) | 1 | pending |
| 3 | **Single-player vs AI** — play immediately against an unbeatable minimax opponent (no opponent coordination needed); AI move < 200ms; result screen on win/draw | Solo challenge (no friend required) | 2 | pending |
| 4 | **Online two-player match** — create a game (get a shareable code), second player joins by code, moves sync in real time between two browsers | Playing against a real human (full job) | 2 | pending |
| 5 | **Leaderboard** — title screen shows win/draw/loss rankings; completed games update the board within 10 s | Motivation through standing | 4 | pending |
| 6 | **Player identity (lightweight)** — players enter a display name before or at game creation; name persists for the session and appears on the leaderboard | Motivation through standing (social dimension) | 5 | pending |
| 7 | **In-game chat** — players can send short messages to each other during an active game; messages appear within 1 s; scoped to the game session only (no persistence after game ends) | Connection through banter (social dimension) | 4 | pending |

---

## Rationale for ordering

**Chunk 1 before game logic.** The deployment pipeline is the riskiest unknown
(AWS infra, CI/CD, DNS). Getting a real URL live first means every subsequent
slice ships to a real environment. It is not "infrastructure ahead of value" —
it is the fastest path to learning whether the hosting works.

**Chunk 2 before online.** A working local game validates all game rules and
UI with zero networking complexity. It is genuinely usable (two people on the
same machine) and gives a thin shippable surface before the hard real-time
sync problem is attempted.

**Chunk 3 (AI) before online play.** The minimax engine is well-understood (proven
in the ox project); it adds solo replayability with no networking complexity.
A user can play immediately without waiting for an opponent. This delivers
standalone value earlier and stress-tests the deployed shell before the harder
real-time sync problem is tackled.

**Chunk 4 is the core online value unlock.** Two players in different browsers is
the primary JTBD. Everything before it is preparation; everything after it is
enhancement.

**Chunk 4 (leaderboard) after online play.** There is nothing to rank until
games are being played. Delivering it here means the first real players see it
immediately, generating the motivational feedback loop.

**Chunk 5 (identity) last in this sequence.** Anonymous play works; a display
name is an enhancement that unlocks the social dimension of the leaderboard.
Deferring it avoids sign-up friction blocking the first real games.

---

## Explicitly out of scope at this stage

- Account creation / authentication / passwords
- Difficulty levels or beatable AI modes (AI is always unbeatable)
- Spectator mode
- Match history / replay
- Mobile-native app (web responsive only)
- Persistent chat history or cross-game messaging
- Paid tiers or monetisation
