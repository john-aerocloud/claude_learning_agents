# Principle failure: pushed §40 flag-flip before re-running lint after a build-driven edit

- **Date:** 2026-06-08
- **Slice:** oxo-online / s009-arcade-scoreboard (iteration 14)
- **Agent:** engineer
- **Principle:** "Suites green: make test-app, lint, build before push." Run the
  FULL gate after the LAST edit — not after an intermediate one.

## What happened
During the §40 factor-out I ran `make test-app` + `make lint-app` + `make
build-app` and they passed. The `build-app` (tsc) step then surfaced a typing
error in `policy.test.tsx`, which I fixed by adding `_input`/`_init` underscore
params to a `vi.fn` mock. I rebuilt (tsc passed) and pushed — but did NOT
re-run `lint` after that fix. The committed lint config flags unused params
even with a leading underscore (`@typescript-eslint/no-unused-vars`, no
`argsIgnorePattern`), so the CI `Lint` step failed (run 27124521950) and the
deploy never ran.

## Root cause
The gate was run BEFORE the last source edit. The build-fix edit was treated as
"just a type fix, build already re-passed" and the lint half of the gate was not
re-executed. The lint rule (no underscore exemption) differs from the mental
model that `_`-prefixed params are always ignored.

## Cost
One red CI run (~30s to lint failure), no deploy, a forced fix-and-re-push.
No prod impact (deploy job gated behind build job; build job failed at lint).

## Fix applied
Replaced the named-param mock with a generic-typed `vi.fn<(input, init) =>
Promise<Response>>(async () => ...)` so no unused params exist. Re-ran lint +
build + the policy suite green, then committed and re-pushed.

## Prevention
Re-run the COMPLETE gate (`make test-app && make lint-app && make build-app`)
as the single final step immediately before any push — never rely on an earlier
partial pass when a later edit (even a "type-only" one) has touched a source
file. Treat lint and tsc as independent gates: passing one does not imply the
other after an edit.
