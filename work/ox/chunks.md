# Chunks — high-level value sequence

Coarse slices, ordered by value-per-lead-time. Each Chunk decomposes into slices
at iteration time. Maintained by Product + Solution Architect.

| # | Chunk | JTBD served | depends on | status |
|---|-------|-------------|------------|--------|
| 1 | Playable board | Player can enter moves on a rendered ASCII board, see whose turn it is, and reach a win/draw/loss result against a human second player (no AI yet). The full game loop is real and testable. | — | done |
| 2 | Perfect computer opponent | Player faces an unbeatable AI so every game is a genuine challenge with a meaningful result. | 1 | done |
| 3 | Play-again loop | Player can replay immediately after a result without restarting the program, lowering friction for repeated play. | 2 | done |

## Excluded from this product (deliberate)

- Networked / multiplayer over a connection
- Graphical (GUI) interface
- Score persistence or leaderboards
- Difficulty levels / beatable AI modes
- Undo / take-back moves
