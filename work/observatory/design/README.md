# Design system (per project)

The `ui-designer` agent owns this folder for UI-bearing projects. It is created
on first UI slice; an empty folder here is fine for non-UI projects.

- `design-system.md` — tokens (colour/type/spacing/radii/elevation/motion).
- `components.md` — component inventory: states, stable selector, lib mapping, a11y.
- `patterns.md` — navigation/IA model, click-path budgets, standard states.

Templates live in the `ui-design-system` skill. Keep these additive and
diff-friendly; extend per slice, never speculate ahead of need.
