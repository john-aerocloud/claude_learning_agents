# Decision log (append-only)

Every gate decision and notable autonomous default. Anchors are referenced from
the DORA ledger `ref` column.

| ts (UTC) | gate | decision | by | rationale | anchor |
|----------|------|----------|----|-----------|--------|
| 2026-06-04T00:00:00Z | kickoff | Project ox created; requirement workflow started | orchestrator | User request: console noughts and crosses with perfect AI, ASCII art, coordinate input | KICKOFF-001 |
| 2026-06-04T00:03:00Z | gate-1 | Product vision approved | human | JTBD + success measures + 3 chunks accepted as stated | GATE-1 |
| 2026-06-04T12:35:00Z | gate-2 | Architecture + security review approved | human | Python 3 stdlib CLI, 5 pure modules, I/O confined to Game Loop accepted | GATE-2 |
| 2026-06-04T12:37:00Z | gate-2b | Slice 001 approved | human | 13 ACs accepted; proceed to iteration-run | GATE-2B |
| 2026-06-04T12:45:00Z | gate-3 | Go/no-go to deploy approved | human | 39 tests pass; all 13 ACs green; proceed to tester validation | GATE-3 |
| 2026-06-04T13:05:00Z | slice-001-done | Slice 001 (playable-board) validated and complete | tester | All 6 success measures + 13 ACs pass; no defects; Chunk 1 done | GATE-3 |
| 2026-06-04T16:12:00Z | gate-2 | Slice 002 (perfect-opponent) approved | human | Minimax AI via existing players= seam; 6 success measures accepted | GATE-2-S002 |
| 2026-06-04T16:34:00Z | gate-3 | Architecture + security approved for slice 002 | human | AI Engine (negamax, pure module); no new controls; proceed to build | GATE-3-S002 |
| 2026-06-04T16:55:00Z | gate-4 | Go/no-go to deploy for slice 002 | orchestrator | 58/58 tests pass; auto-approved on clean build; dispatching tester | GATE-4-S002 |
| 2026-06-05T00:30:00Z | slice-002-done | Slice 002 (perfect-opponent) validated and complete | tester | 9/9 ACs pass; full game-tree no X win; draw confirmed; no defects | GATE-4-S002 |
| 2026-06-05T07:28:00Z | gate-2 | Slice 003 (play-again + session score) approved | human | 8 success measures; score display added to scope | GATE-2-S003 |
| 2026-06-05T07:30:00Z | gate-3 | Architecture + security approved for slice 003 | human | run_session() in game.py; injectable again seam; no new security surface | GATE-3-S003 |
| 2026-06-05T07:45:00Z | gate-4 | Go/no-go AUTO-APPROVED | orchestrator | Local-only + 85/85 tests green + no deviations → v5 §3 auto-approve; tester dispatched | GATE-4-S003 |
| 2026-06-05T08:05:00Z | slice-003-done | Slice 003 (play-again + session score) validated and complete | tester | All 8 SMs + 9 ACs pass; tester 1200s (scope clarification working); Chunk 3 done | GATE-4-S003 |
