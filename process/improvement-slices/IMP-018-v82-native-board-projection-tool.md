# IMP-018 — v82-native board-projection tool (Linear first, Jira fast-follow)

**Status:** in progress (opened OAG session 2026-07-23). Owner: engineer, driven by orchestrator.

## Problem (evidenced)
The `linear`/`jira` projection agents depend on a per-project `sync-linear.py` that was
RETIRED in the v82 cutover (commit `f9cd5a1`, "dead scripts") but never rebuilt for the
event-sourced item model. Consequences observed this session:
- The old source does not parse v82 per-item files — dry-run against `UC-XA4` returned
  "not a known use-case or live defect" (it still expects the retired `slices/` layout).
- Per-item board pushes for use-cases now FLAKE; the `DEF-XA3` push only succeeded via a
  leftover `.pyc`, and a raw-curl fallback tried to INLINE the API key and was correctly
  blocked as credential leakage.
- Net: board state silently lags the SSOT — the exact board/doc-lag failure §F9 step-4
  exists to prevent. UC-XA4/UC-XA11/SLC-041 board states are currently stale.
- `process/linear-mapping.md`'s state table predates the v82 granular states
  (`dev-validating`, `deploying`, `prod-deploying`, `prod-validating`, `reworking` are
  unmapped).

## Deliverable
A minimal, v82-native, **single-item** board-projection tool that the `linear` (and, as a
fast-follow, `jira`) agent invokes. Shared + process-layer (all projects need it),
parameterised `--project <p> --item <ID>` with `--dry-run` (default) / `--live`.

**Reads (never writes item state):**
- `work/<project>/items/{active,done}/<ID>.md` — frontmatter (`type`, `derived.state`,
  `parents`), human title from the definition body, and the latest `blocked` event note.
- `work/<project>/.linear-config.json` (team/initiative), `.linear-map.json` (id→issue cache),
  `secrets/linear.local.json` (API key loaded at RUNTIME — NEVER inlined, echoed, or logged;
  if the secrets file is absent the tool STOPS and reports, never falls back to an inlined key).

**Behaviour:**
- Map `derived.state` → board status per an UPDATED `process/linear-mapping.md` (refresh the
  flow-item table to cover every v82 use-case state).
- Upsert exactly ONE issue idempotently: if `issues[ID]` exists → PATCH title/description/
  status/labels; else create → write the new id back to `.linear-map.json`. Title
  `"<ID> · <human title>"`. Defects/open-items attach as sub-issues per the mapping; blocked
  items carry a "why" banner from the blocked note. NO whole-board re-read (single-id fast path).
- Cross-platform launcher (same discipline as the work-items launcher — never bare `python3`).

## Acceptance
- **AC-1** offline unit tests (mock the GraphQL client): item parse (frontmatter + derived.state
  + title), state→status map across ALL v82 states (use-case/defect/open-item), title format,
  and map upsert (create writes id back; update patches in place — no dupes). Green.
- **AC-2** live: `--item UC-XA4 --live` upserts its Linear issue to the correct status with no
  duplicate; the API key never appears in any command, file, or log. Verified by projecting the
  currently-lagging UC-XA4, UC-XA11, SLC-041.
- **AC-3** the `linear` agent def is rewired to call the tool; `process/linear-mapping.md` state
  table is refreshed for v82. (Jira parity is a fast-follow IMP, noted not built here.)

## Notes
Process-layer — commits on `instance/OagEventSource`; folds back with the reconciliation the
owner is handling. Supersedes the retired `work/<project>/scripts/sync-linear.py`.
