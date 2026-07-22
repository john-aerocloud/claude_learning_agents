# wi-append NOTE text with literal `$transform(...)` silently mangled by shell expansion

**Date:** 2026-07-22
**Role:** tester
**Project:** AdixOut

## What happened
While recording `rejected` evidence on UC-ADIX-016 and DEF-ADIX-002 via `make
wi-append ... NOTE="...the \$transform(aws.apigateway.Stage,...) registered..."`,
the `$transform` token inside the double-quoted NOTE value was expanded by the
shell as an (unset) variable reference before `make`/the launcher ever saw it,
silently truncating to `ransform(aws.apigateway.Stage,...)` in the committed
event note. This is NOT a `wi-append` machinery bug — it is a caller-side shell
quoting hazard: any evidence text that legitimately contains a literal `$name`
token (code identifiers like Pulumi/SST's `$transform`, shell-style env
placeholders, etc.) is corrupted, without any error or warning, if passed
through a double-quoted Bash argument.

## Impact
Low-severity here (a human/agent reader can still infer intent from context —
"the ransform(...) registered..." reads awkwardly but is not misleading about
the root-cause hypothesis), but this is a **silent evidence-corruption class**:
a `$`-prefixed token in a NOTE can vanish/mutate with zero indication anything
went wrong, the same failure shape as the prior comma-truncation defect logged
in `wi-machinery-defects` (memory) — different mechanism (shell var-expansion
vs. CSV/arg-splitting), same effect (mangled forensic evidence on a work item).

## Recommendation
- Callers (tester/engineer/etc.) constructing `--note`/`NOTE=` values containing
  literal `$` tokens should single-quote the value or escape every `$` as `\$`
  — note single-quoting still requires escaping embedded `'` characters.
- Consider a `wi-append` capability improvement (cicd/tooling): detect a raw
  unescaped `$IDENT`-shaped substring in an incoming NOTE argument that does not
  correspond to an actual exported shell variable, and warn (not silently drop)
  — flagged here per flag-don't-fix (this is shared machinery, not owned by
  the tester role).
