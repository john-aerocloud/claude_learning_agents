# Security controls — ox AI Engine (minimax move-supplier)

Data class: **none sensitive**. No PII, no secrets, no persisted data.

## Verdict

The AI Engine introduces **no new security control surface**. It is a pure
function of in-process board state that returns a bounded coordinate string. The
`cli-process.md` controls remain the complete and sufficient control set; the
statements below confirm the AI does not weaken them. Written as checkable
statements — they become security-policy test cases at implementation time.

## No new untrusted input

- [ ] The AI consumes only in-process board state; it reads nothing from stdin,
      files, sockets, environment variables, or any external source.
- [ ] The AI module imports no I/O, network, subprocess, or dynamic-execution
      facility (`subprocess`, `socket`, `os.system`, `eval`, `exec`, `pickle`,
      dynamic import are absent from the AI runtime path).

## Output flows through the existing validated path

- [ ] The AI's returned move is a coordinate string in the same `A1..C3` grammar
      the Parser already validates; it re-enters via the existing
      Parser -> Board.apply path and is not written to the Board by any
      privileged or unvalidated route.
- [ ] The AI's output is bounded (a single short coordinate token); it cannot
      emit an unbounded or attacker-controlled string (its output domain is the
      finite set of legal cells).

## Purity / no side effects

- [ ] The AI does not mutate the board-state object passed to it (recursion uses
      copies / non-mutating apply); calling it leaves caller state unchanged.
- [ ] The AI performs no filesystem writes and opens no network connection
      (the `cli-process.md` "no filesystem IO" and "no network exposure"
      controls continue to hold for the whole process).
- [ ] The AI terminates for every reachable input (bounded game tree, depth
      <= 9); no input can cause unbounded recursion or hang beyond the 1s
      performance bound.
