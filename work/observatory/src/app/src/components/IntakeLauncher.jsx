// UC-S018-1 — IntakeLauncher: the persistent "+ New Work" primary launcher in
// the .observatory-main-col header, BESIDE the ViewSwitch tablist (never
// inside it — its own tab stop, outside the roving-tabindex cycle).
//
// HEXAGONAL ROLE: pure render — a native button with a visible text label
// (never icon-only; the + glyph is aria-hidden). Primary-action styling
// (--c-focus accent) so it reads as the page's author action without
// competing with the tablist's selection band.
import './intake-wizard.css';

/**
 * @param {object} props
 * @param {() => void} props.onOpen
 */
export function IntakeLauncher({ onOpen }) {
  return (
    <button
      type="button"
      class="intake-launcher"
      data-testid="intake-launcher"
      onClick={() => {
        if (typeof onOpen === 'function') onOpen();
      }}
    >
      <span aria-hidden="true">+ </span>New Work
    </button>
  );
}
