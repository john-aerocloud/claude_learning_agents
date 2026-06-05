# Route — Slice 003: Play-again loop + session score

Thin TDD route taken (red -> green per step). One production change only:
`run_session()` added to `ox/game.py`; `main()` now calls it. No new module;
Board / Parser / Renderer / AI / `play_game()` body / `__main__.py` untouched
(per architecture delta 003).

All session tests inject the seams `players=`, `out=` (StringIO), `again=`
(scripted answers), and most stub `play_game` via `monkeypatch.setattr` on the
module-level name so the loop's control flow is tested in isolation from the
game body. No subprocess anywhere.

## Ordered steps (each: failing test -> minimum code -> green)

1. **AC-08 / AC-02 — loop invokes play_game per game; "y" replays, "n" exits.**
   Tests: `test_ac08_multi_game_session_runs_to_completion`,
   `test_ac02_y_replays_then_n_exits`, `test_ac02_uppercase_Y_accepted`.
   Code: `run_session()` skeleton — loop calling `play_game`, read `again`,
   continue on y/Y else return. (RED: ImportError -> GREEN.)

2. **AC-06 — score increments and per-game display; per-session counters.**
   Tests: `test_ac06_score_sequence_o_draw_o`, `test_ac06_x_win_increments_x_only`,
   `test_ac06_counters_per_session`.
   Code: `score = {"O":0,"draws":0,"X":0}` mapped from `play_game` return
   (DRAW -> draws, ("win",m) -> score[m]); emit
   `Score — O wins: N  Draws: N  X wins: N`; return dict.

3. **AC-01 — prompt emitted on the output sink, after the result.**
   Test: `test_ac01_prompt_after_result`.
   Code: `_emit(out, _AGAIN_PROMPT)` before calling `again(...)`; ordering
   asserted against a result marker.

4. **AC-03 — "n"/"N" exit cleanly, no further game, closing message.**
   Tests: `test_ac03_n_exits_no_replay`, `test_ac03_uppercase_N_exits`,
   `test_ac03_closing_message_emitted`.
   Code: closing message `"Thanks for playing!"` then return.

5. **AC-04 — invalid input re-prompts exactly once; EOF/Ctrl-C clean.**
   Tests: parametrized `test_ac04_invalid_then_y_replays`,
   `test_ac04_invalid_then_non_y_exits` (each of "", "z", "7", "maybe", 500-char),
   `test_ac04_prompt_displayed_exactly_twice_on_one_invalid`,
   `test_ac04_eof_at_prompt_exits_cleanly`,
   `test_ac04_keyboardinterrupt_at_prompt_exits_cleanly`.
   Code: `_ask_play_again()` with `for attempt in range(2)` (one re-prompt only),
   wrapped in `try/except (EOFError, KeyboardInterrupt)` -> clean return.

6. **AC-05 — board resets between games.**
   Test: `test_ac05_board_resets_between_games` (real `play_game`, two scripted
   games; empty `render(new_board())` appears >= 2x). Reset is automatic: each
   `play_game()` builds its own board. No code change beyond the loop.

7. **Mid-game abort.** Test: `test_midgame_abort_returns_no_prompt` —
   `play_game` returns None -> return without scoring/prompting.

8. **AC-09 — security: length-bounded first-char use; no new exec surface.**
   Tests: `test_ac09_long_answer_handled_without_crash` (10k-char answer),
   `test_ac09_no_eval_exec_subprocess_in_module` (AST scan: no eval/exec/compile
   call, no os.system, no subprocess import/call).
   Code: `answer.strip()[:1]` first-char-only; answer never used as command /
   path / attribute / format string.

9. **AC-07 — regression.** Full suite: 58 prior + 27 new = 85 passing. Existing
   `test_security.py` substring scan kept intact (runtime source carries no
   "subprocess"/"eval("/etc. literals — docstring reworded accordingly).

## Result
- Tests added: `tests/test_session.py` (27 tests). All 9 ACs green.
- Smoke: `printf "...y...n..." | python3 -m ox` -> two games, score after each,
  exit 0, "Thanks for playing!".
- WIP independent: single additive function + one-line `main()` change; lands on
  trunk in one step. No hidden coupling.
