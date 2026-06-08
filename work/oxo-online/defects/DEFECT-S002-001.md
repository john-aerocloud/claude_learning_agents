# DEFECT-S002-001 — board renders as a line, not a 3×3 grid

- **Expected:** the noughts-and-crosses board is a 3×3 square grid.
- **Actual:** the nine cells render in a straight line (no grid layout).
- **Intent:** play/▶ read the board as a tic-tac-toe game.
- **Importance:** HIGH — the core game surface is visually broken; undermines the whole product on sight.

**Confirmed:** code root-cause — `Board.tsx` renders `<div className="board" role="grid">` of 9 cells with a comment "The 3×3 grid", but `index.css` has NO `.board` rule with `display:grid; grid-template-columns: repeat(3, …)`. Cells fall into flow. Latent since s002.
**Why every test missed it:** all specs assert `role=grid`/cell-presence/clicks/win-detection; none assert geometry (3 columns). Functional-green ≠ visually-correct.
**§5a class:** our defect (missing CSS). **Gap → EXP-016** (visual-structural correctness).
**Priority:** fix NOW (core surface, trivial CSS) — pre-empts s009 build (which adds the leaderboard below the board; board must be correct first).
