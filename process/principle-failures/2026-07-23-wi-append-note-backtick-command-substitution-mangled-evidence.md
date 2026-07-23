# wi-append NOTE text with literal backtick-quoted code snippets silently mangled by shell command substitution

**Date:** 2026-07-23
**Role:** tester
**Project:** AdixOut

## What happened
While recording the `rejected` evidence for UC-ADIX-020, the NOTE argument quoted
two literal XML snippets in backticks for readability (e.g. `` `<Airline
CodeContext="3">AF</Airline>` `` and `` `<Airline Code="AF" CodeContext="3"/>` ``).
Because `wi-append`'s Makefile wrapper interpolates `NOTE` into a double-quoted
shell string (`--note "$(NOTE)"`), the backtick pairs were evaluated as Bash
command substitution before `make`/the launcher ever saw the text. Each
backtick-quoted snippet was executed as a shell command (which failed with a
syntax error, printed to stderr) and substituted with EMPTY output — silently
deleting both code snippets from the committed event note, with no error
surfaced in the stored note itself (only noisy-but-easy-to-miss stderr at
append time). The event still appended correctly and the surrounding prose
still conveyed the finding, but the two illustrative snippets that pinned the
exact root cause verbatim are gone from the permanent record.

## Impact
Low-to-medium: same silent-evidence-corruption shape as the prior `$transform`
finding (2026-07-22) and the earlier comma-truncation defect (memory:
wi-machinery-defects) — a THIRD distinct shell-quoting hazard class hitting the
same `--note`/`NOTE=` argument path. Here the surrounding sentence structure
happened to remain readable without the snippets, so no reader is misled, but a
future note relying on the snippet's content to actually disambiguate (rather
than as illustrative backup) could lose load-bearing evidence with zero warning.

## Recommendation
- Callers constructing `--note`/`NOTE=` values containing literal backtick
  characters (code snippets, inline-code markdown, shell-like syntax) must
  avoid backticks entirely (e.g. quote code with single-quotes or plain prose
  paraphrase) rather than relying on backtick-delimited inline code, until the
  machinery is hardened.
- Same `wi-append` capability improvement recommended for the `$`-expansion
  finding applies here: detect/neutralize shell-metacharacter sequences
  (backticks, unescaped `$(...)`, unescaped `$IDENT`) in an incoming NOTE
  argument, or have the launcher accept NOTE via stdin/a temp file instead of
  a shell-interpolated Makefile variable, closing this whole hazard class at
  once (flagged here per flag-don't-fix — shared machinery, not tester-owned).
