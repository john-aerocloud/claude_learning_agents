# Tool finding: impacted-tests reports word-fragments from a quoted node LABEL as standalone "changed nodes"

**Date:** 2026-07-23
**Project:** AdixOut
**Agent:** tester
**Principle:** "Plan from the change map, then validate" — the changed-node list IS
the test-plan tick-off; a false entry in that list is noise a tester must triage
away from real scope every run.

## What happened
Validating UC-ADIX-018, `make impacted-tests SINCE=7ca0613 PROJECT=AdixOut`
reported 9 changed nodes, two of which — `customer` and `governed` — are NOT real
graph nodes. Direct `grep` over both `.mmd` files
(`architecture/dependencies/data-flow.mmd`, `architecture/dependencies/use-case-deps.mmd`)
confirms zero declarations of a `customer[...]` or `governed[...]` (or any bracket
form) node anywhere. The only place those two words appear is INSIDE the quoted
LABEL TEXT of the real `UC018` node:

```
UC018["UC-ADIX-018: Register a customer -- governed EntitlementStore write + Secrets Manager key provisioning"]
```

`impacted-tests.js` appears to tokenise the label string on word boundaries when
diffing/parsing the `class UC018,UC019,UC020 changed;` line or the node
declaration itself, emitting `customer` and `governed` as if they were their own
node ids with no covering spec — a false "UNCOVERED CHANGED NODE" that costs a
tester a look-up cycle every time a UC label happens to contain a common noun that
isn't quoted/escaped specially.

## Impact this run
Low — caught immediately by grep, waived in `validation/UC-ADIX-018.test-plan.md`
rather than worked around with a spec for a node that doesn't exist. But this is
exactly the OI-COVERS-NODEID class of tool-scope noise (5th+ occurrence of an
impacted-tests parsing gap this project has hit — see `wi-machinery-defects`
memory + prior `2026-07-13`/`2026-07-16` entries) and will recur on every future UC
whose label text contains a word that isn't already a declared node id elsewhere in
the same diagram.

## Recommended fix (not done this pass — advisory, EXIT 2 is non-blocking)
`impacted-tests.js`'s node-id extraction should anchor strictly to the
`<ID>[...]`/`<ID>{{...}}`/`<ID>(...)`/bare-`<ID>` declaration and edge (`A --> B`)
syntax, never tokenise the free-text CONTENTS of a quoted label — the label is
documentation, not an identifier namespace. A regression test fixture with a node
label containing a common word (e.g. "customer", "governed", "table") that is
NOT itself a declared node id anywhere in the diagram would catch this mechanically.

## Disposition
Waived in this pass's test-plan (`ADMIN`/`UC019`/`UC020` are legitimate waivers;
`customer`/`governed` are non-issues, not real scope). Named here per the
tester's standing duty to log tool-scope findings rather than silently work
around them.

## Cross-instance recurrence (ROC v103 retro, 2026-07-23)

The SAME impacted-tests coverage-vocabulary class recurred on ROC C3, independently: `@covers` tags use a `domain-/functions-/adapter-/config-` prefix the bare `.mmd` node ids never match, so `consumer`/`decisionRecord` + 4 port/interface nodes (`alertPayload`/`alertStatePort`/`jiraPort`/`soakTriggerPort`) read UNCOVERED despite real specs covering them. Patched project-locally via `%% @alias` lines. Two projects, same tool → past the per-project-workaround threshold. Fix routed as **IMP-021** (impacted-tests resolves id AND label + normalises the prefix vocabulary natively; drop per-project aliases when it lands).
