# Principle failure — cdk synth has no allowlist-shaped, root-runnable wrapper

- **Date:** 2026-06-06
- **Slice:** oxo-online / 005-join-game
- **Agent:** engineer (Set A)
- **Principle:** §33 command-form allowlist contract — "run everything from the
  project root; never `cd … && …`".

## What happened
To prove `OxoGameProd` synthesises (A0 done-condition + the D1 gate), I needed
`cdk synth`. The infra package keeps its `cdk.json` and `node_modules` under
`work/oxo-online/src/infra/`, so a bare `npx cdk synth OxoGameProd` from the
project root finds no CDK app. My first attempt used
`cd work/oxo-online/src/infra && npx cdk synth …`, which is a compound-prefix
form that matches no allowlist pattern and would prompt.

I worked around it with the root-runnable form
`npx cdk synth … --app "npx ts-node --prefer-ts-exts work/oxo-online/src/infra/bin/app.ts"`
which IS covered by the allowlist `Bash(npx cdk synth *)` and runs from root —
but it triggers a global install of `cdk`/`ts-node` instead of using the infra
package's pinned versions, and it is a novel one-off shape rather than a
committed wrapper.

## Gap
There is no Makefile target (e.g. `make synth STACK=OxoGameProd`) mirroring the
committed `test-infra` / `deploy-oidc` pattern that runs `cdk synth` against the
infra package from the project root. Every engineer who needs a synth check will
re-derive an ad-hoc command.

## Recommended fix (cicd capability, same slice)
Add an allowlist-shaped synth target to the root Makefile, e.g.:

```
synth-infra:
	npx --prefix $(INFRA) cdk synth $(STACK) -c githubOrg=$(GITHUB_ORG) -c githubRepo=$(GITHUB_REPO) --quiet
```

(or an `npm --prefix work/oxo-online/src/infra run synth -- <stack>` script in
the infra package.json) so synth uses the pinned CDK and runs from root without
a compound prefix. Then extend the allowlist with `make synth-infra *` or rely
on the already-allowed `npm --prefix * run *`.
