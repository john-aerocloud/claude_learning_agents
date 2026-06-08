# DEFECT-S002-001 — board renders as a line, not a 3×3 grid

- **Expected:** the noughts-and-crosses board is a 3×3 square grid.
- **Actual:** the nine cells render in a straight line (no grid layout).
- **Intent:** play/▶ read the board as a tic-tac-toe game.
- **Importance:** HIGH — the core game surface is visually broken; undermines the whole product on sight.

**Confirmed:** code root-cause — `Board.tsx` renders `<div className="board" role="grid">` of 9 cells with a comment "The 3×3 grid", but `index.css` has NO `.board` rule with `display:grid; grid-template-columns: repeat(3, …)`. Cells fall into flow. Latent since s002.
**Why every test missed it:** all specs assert `role=grid`/cell-presence/clicks/win-detection; none assert geometry (3 columns). Functional-green ≠ visually-correct.
**§5a class:** our defect (missing CSS). **Gap → EXP-016** (visual-structural correctness).
**Priority:** fix NOW (core surface, trivial CSS) — pre-empts s009 build (which adds the leaderboard below the board; board must be correct first).

## CLOSED 2026-06-08 (sha cd2edaf)
Fixed: `.board { display:grid; grid-template-columns/rows: repeat(3,5rem) }`. Prod re-check (https://d3pf3kcvzpau1x.cloudfront.net): cells form 3 rows × 3 cols (88px stride) — symptom gone. Pinned by committed real-browser geometry spec `tests/smoke/board-geometry.spec.ts` (@covers board-grid; RED on a line, GREEN on the grid). Gap-closing experiment: EXP-016 (visual-structural correctness) — first scoring opportunity is s009 (UI-bearing). defectS002changed marks in class-deps.mmd cleared at s009 delivery.
