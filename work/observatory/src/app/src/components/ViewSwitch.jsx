// UC-S015-1 — ViewSwitch: the routed-view tablist at the top of the main
// column. ROUTED-VIEW model (EXP-016): activating a tab swaps the main-column
// content — the surfaces never co-exist, so there is no overlay-reflow failure
// mode by construction.
// UC-S013-2 EXTENDS the tablist to THREE views ("Pipeline" | "In-flight WIP" |
// "Defects") — reuse, not fork (ui-design.md dispatch directive): the
// component was already a generic tablist; only the TABS table grew.
//
// A11Y (S15-1-A11Y-1/4/5): proper tablist/tab semantics, roving tabindex
// (active tab is the single tab stop), Arrow/Home/End move focus, Enter/Space
// activate (manual activation — focus alone never switches the view),
// aria-selected mirrors the active view, hit boxes ≥ --target-min.
// Pure function of props; owns no state.
import './view-switch.css';

const TABS = [
  { view: 'pipeline', label: 'Pipeline' },
  { view: 'wip', label: 'In-flight WIP' },
  { view: 'defects', label: 'Defects' },
];

/**
 * @param {object} props
 * @param {'pipeline'|'wip'|'defects'} props.active
 * @param {(view: 'pipeline'|'wip'|'defects') => void} props.onSelect
 */
export function ViewSwitch({ active, onSelect }) {
  const tabRefs = {};

  const moveFocus = (toIdx) => {
    const el = tabRefs[TABS[toIdx].view];
    if (el && typeof el.focus === 'function') el.focus();
  };

  const onKeyDown = (e, view) => {
    const idx = TABS.findIndex((t) => t.view === view);
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        moveFocus((idx + 1) % TABS.length);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus((idx - 1 + TABS.length) % TABS.length);
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        e.preventDefault();
        moveFocus(TABS.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (typeof onSelect === 'function') onSelect(view);
        break;
      default:
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      data-testid="view-switch"
      class="view-switch"
    >
      {TABS.map((t) => {
        const isActive = active === t.view;
        return (
          <button
            key={t.view}
            type="button"
            role="tab"
            id={`view-tab-${t.view}`}
            aria-selected={isActive ? 'true' : 'false'}
            aria-controls={`view-panel-${t.view}`}
            tabIndex={isActive ? 0 : -1}
            data-testid={`view-tab-${t.view}`}
            data-view={t.view}
            class="view-switch__tab"
            ref={(el) => {
              tabRefs[t.view] = el;
            }}
            onClick={() => {
              if (typeof onSelect === 'function') onSelect(t.view);
            }}
            onKeyDown={(e) => onKeyDown(e, t.view)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
