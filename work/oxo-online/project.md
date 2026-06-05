---
project: oxo-online
status: active
owner: john.nicholas@aerocloudsystems.com
created: 2026-06-05
stopped:
---

# oxo-online

## Job(s) to Be Done (product vision)

### Core job — playing against a real human
When I want a quick, low-friction competitive game with a friend (or any
available opponent), I want to set up or join a noughts and crosses match
and play it to completion in real time, so that I get the genuine satisfaction
of competing against another person rather than a bot.

Functional dimension: find an opponent, make moves in turn, see the result.
Social dimension: I can share a game link or code with someone and we play
together, which makes the game feel meaningful rather than solitary.

### Supporting job — motivation through standing
When I have played one or more games, I want to see how I rank against other
players, so that I feel a reason to come back and improve my record, and so
I can show others my standing.

Emotional dimension: seeing my name on a leaderboard converts an ephemeral game
into an ongoing identity within the product.

### Supporting job — solo challenge without friction
When I want a quick game but no friend is available right now, I want to play
against a computer opponent that provides a genuine challenge, so I can still
get the satisfaction of a competitive game on my own schedule.

Functional dimension: play starts immediately with no coordination required.
Emotional dimension: an unbeatable opponent means every draw feels earned.

### Supporting job — connection through banter
When I am playing a game with a friend or stranger, I want to exchange short
messages during the game, so that the match feels like a shared social
experience rather than two people silently clicking.

Social dimension: chat converts a mechanical game into a conversation — it is
what separates playing *with* someone from playing *at* them.

### Ambient job — reliable, always-on availability
When my friend and I decide to play, I want the game to just work in a browser
with no install, no sign-up friction that blocks play, and consistent uptime,
so that the barrier to starting a game is as close to zero as possible.

---

## Success measures

### Playing against a real human
- A two-player match is completed (one player wins or the board fills) in under
  5 minutes of first intent — measured from game creation to result screen.
- Fewer than 5% of started games are abandoned due to a connection error or
  state-sync failure (each player seeing different board state).
- Both players see each move within 1 second of it being made (p95 latency).

### Motivation through standing
- Leaderboard loads within 2 seconds on the title screen (p95).
- After a completed game, a player's win/draw/loss record is reflected on the
  leaderboard within 10 seconds.
- At least one returning session per player within 7 days of first game
  (proxy for "reason to come back" — measured via session analytics).

### Solo challenge
- Single-player game starts within 2 seconds of selecting "vs computer."
- The AI never loses — every game ends in a draw or computer win; no beatable path exists.
- The move latency for the AI response is imperceptible (< 200ms).

### Connection through banter
- A message sent during a game appears for the opponent within 1 second (p95).
- Chat is scoped to the active game — messages do not persist after the game
  ends and are not visible to players outside the game.

### Availability
- Service uptime >= 99% measured monthly.
- A first-time user can land on the title screen, create or join a game, and
  complete a match with no account creation required.
