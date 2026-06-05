# Security controls — ox local CLI process

Data class: **none sensitive**. No PII, no secrets, no persisted data. The
untrusted inputs are the coordinate string typed at stdin and (slice 003) the
single play-again answer typed at stdin. Surface is small; these controls are
written as checkable statements and become security-policy test cases at
implementation time.

## Input handling (untrusted stdin)

- [ ] Every line read from stdin is treated as untrusted and validated by the
      Input Parser before use.
- [ ] Accepted input is constrained to the coordinate grammar
      (`^[A-Ca-c][1-3]$` after trimming surrounding whitespace); anything else is
      rejected with a clear message.
- [ ] Input length is bounded before parsing (reject pathologically long lines)
      so no unbounded buffer is built from a single read.
- [ ] Rejected input never forfeits the player's turn and never terminates the
      process abnormally.

### Play-again prompt (slice 003)

- [ ] The play-again answer is read as a normal line and treated as untrusted,
      using the **same** posture as move input: strip whitespace, then use a
      length-bounded slice (first character only) — the full line is never used
      to build any buffer, command, path, or format string.
- [ ] Only `y`/`Y` is treated as replay; every other value (including empty,
      digits, words, long strings) is treated as "no" and exits cleanly.
- [ ] Invalid play-again input re-prompts **exactly once**; it cannot drive an
      unbounded re-prompt loop and never crashes the process.
- [ ] EOF / interrupt (Ctrl-D / Ctrl-C) at the play-again prompt ends the program
      cleanly with no traceback.
- [ ] The play-again answer is never passed to `eval`/`exec`/`subprocess`, never
      used as a path, attribute name, or format string. It introduces **no** new
      attack surface beyond the existing stdin move-input surface.

## No code/command execution from input

- [ ] User input is never passed to `eval`, `exec`, `compile`, `pickle`, or any
      dynamic-import mechanism.
- [ ] The program executes **no** shell/subprocess calls; `os.system`,
      `subprocess`, and equivalent are absent from the runtime path. (No shell
      injection surface exists.)
- [ ] Input is never used to construct a format string, regex, or attribute name
      that drives control flow (no reflection on user data).

## No filesystem / IO side effects

- [ ] The process opens **no** files for write during normal play; it does not
      create, modify, or delete any file. State is in-memory only.
- [ ] User input is never used to build a filesystem path (no path traversal
      surface, because no paths are derived from input at all).
- [ ] The only writes are to stdout/stderr (the terminal).

## No network exposure

- [ ] The process opens no sockets and makes no outbound network connections.
- [ ] No port is bound; nothing is listenable.

## Dependencies & supply chain

- [ ] Runtime uses the Python standard library only — zero third-party packages —
      so the production dependency attack surface is empty.
- [ ] Any test-only dev tooling is isolated to the dev/CI environment and not
      shipped or imported by the runtime entry point.

## Failure behaviour

- [ ] Unexpected exceptions do not leak stack traces as the normal user path;
      EOF / interrupt (Ctrl-D / Ctrl-C) ends the program cleanly without traceback.
```
