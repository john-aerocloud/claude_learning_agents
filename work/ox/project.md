---
project: ox
status: complete
owner: john.nicholas@aerocloudsystems.com
created: 2026-06-04
completed: 2026-06-05
---

# ox

## Job(s) to Be Done (product vision)

**Primary job — play a complete game**
When a person has a few minutes to kill at a terminal and wants a quick mental
challenge, they want to play a game of noughts and crosses against an opponent
that does not make mistakes, so they can test their own tactical thinking and
get a genuine result (win, draw, or loss) rather than a hollow victory.

**Functional dimension:** place moves via typed coordinates; see the board
clearly after each move; receive an unambiguous result at game end; play again
without restarting the program.

**Emotional dimension:** feel that the computer is a worthy opponent — not
trivially beaten — so the game feels worth the time.

**Social dimension:** low — this is a solo terminal utility. No leaderboard or
sharing needed at this stage.

## Success measures

1. A player can complete a full game (start to result) without consulting any
   instructions — zero dead-ends or ambiguous prompts.
2. The computer never loses — every game ends in either a draw (against a
   perfect player) or a computer win. No beatable AI path exists.
3. A player can enter a move using coordinate notation and the board updates
   correctly; invalid input is rejected with a clear message and the player
   retries without losing their turn.
4. The ASCII board is readable in a standard 80-column terminal without
   truncation or misalignment.
5. A game from first prompt to final result completes in under 30 seconds of
   elapsed clock time (excludes human think time).
6. After a game ends the player can choose to play again; the board resets
   correctly.
