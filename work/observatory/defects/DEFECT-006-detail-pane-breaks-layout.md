# DEFECT-006 — opening a work-item detail breaks the layout (pane should float over the map)

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** MED-HIGH (the just-shipped drill-down is visually broken on the CORE navigate job)

## Resolution
ui-designer reproduced (in-flow pane grew the column +690px / reflowed the page; screenshots) and designed a non-modal right-anchored floating drawer (no scrim, focus-move to originating node, reduced-motion). engineer implemented (sha 7aaa1e9): DetailPaneContainer lifted out of `.observatory-main-col`; `position:fixed` drawer, z-index above map. Verified live: map box + column height + page scrollHeight IDENTICAL open vs closed (the +690px is gone); drawer floats right, no h-scroll, no rail overlap; Esc returns focus to the node. 400 unit + 36 e2e green; client-only (HMR, no restart). Gap → EXP-016 sharpened (an added/overlay surface must leave the UNDERLYING view's geometry UNCHANGED — pin the underlying bbox, not just the new surface's position).

## Four fields
- **Expected:** Clicking a UC in the work-item tree opens its detail cleanly without disturbing the page — ideally a panel that FLOATS over the value-stream map (overlay/drawer), map stays put.
- **Actual:** Opening the detail pane breaks the layout — content reflows/overlaps.
- **Intent:** Drill into a work-item to read its detail (J2 navigate/drill, the CORE observe-and-navigate job).
- **Importance:** The drill-down (UC-S005-3, just shipped) is visually broken; degrades the core navigate job the moment it's used.

## Reproduction (confirmed — mechanism from layout CSS)
`ObservatoryView` renders `.observatory-layout` (flex row) = [WorkItemTree rail] [`.observatory-main-col`]. The DetailPane lives INSIDE `.observatory-main-col` **in-flow**: `position: sticky`, `width: min(440px, 42vw)`, `margin-left:auto`. The value-stream map is also in that column and is a wide multi-lane grid. So when the pane mounts it takes 440px/42vw of the same column → the map is squeezed/reflows → layout breaks. (User observed it directly; CSS confirms the in-flow-pane-competes-with-map mechanism.)

## Classification (§5a)
Our bug — UI layout/IA. The pane was specced/built as an in-flow sibling of the map instead of a floating overlay.

## Root cause (latent)
The DetailPane IA put the pane in the document flow beside a wide, width-hungry component. A drill-down detail over a fixed-width dashboard should be an OVERLAY (own stacking context), not an in-flow column that reflows the underlying view. The s005 ui-design said "right-anchored non-modal region" without pinning that it must not reflow the map; no geometry test asserted the map's box is unchanged when the pane opens.

## Fix
Redesign the DetailPane as a **floating overlay / drawer** over the value-stream map: `position: fixed`/`absolute` with z-index above the map, anchored (right drawer) with optional scrim, closeable (Esc/close/back), focus-managed. The value-stream map's layout MUST be unchanged whether the pane is open or closed (pin with a geometry test: map bounding box identical open vs closed). ui-designer rules the overlay design; engineer implements. [sha + prod re-check on close]
