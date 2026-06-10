// UC-S014-1 — SteerMenu: the per-item steer affordance. ONE component, two
// parts: an explicit trigger button (`⋯`, accessible name "Steer <itemId>") and
// an anchored popover (role=menu) listing the FOUR steer-action types.
//
// HEXAGONAL ROLE: pure presentational primitive. It owns its own open/close +
// focus state and reports the operator's choice through the domain-shaped
// callback `onSteer(itemId, actionType)` — it knows nothing about the steer
// panel (UC-S014-2 consumes the callback), the API, or the hosts that mount it.
//
// OVERLAY DISCIPLINE (DEFECT-006 / GEO-S014-1..4): the popover is
// `position: fixed` — it is rendered inside the component subtree but is OUT of
// document flow, so opening it never moves the host chip/row, its siblings, or
// the page scrollHeight. Anchoring clamps the popover inside the viewport
// (GEO-S014-4: no negative left/top, right ≤ innerWidth — never a horizontal
// scroll).
//
// SELF-CONTAINMENT: the hosts already own click (tree-row drill) and keydown
// (StageNode source reveal, WorkItemTree roving tabindex) with preventDefault.
// The trigger and menu therefore STOP PROPAGATION of their own click and
// handled-key events — the host action must neither fire on a steer
// interaction nor suppress the button's native Enter/Space activation.
//
// A11Y (S14-1-A11Y-1..7): trigger has aria-haspopup=menu + aria-expanded +
// aria-controls; menu is role=menu "Steer actions" with four role=menuitem;
// focus moves to the first item on open; ArrowUp/Down cycle (wrap); Esc closes
// and RETURNS focus to the trigger; Tab leaves (no trap); click-outside closes.
// Hit boxes ≥ var(--target-min) (24px). Visible labels are the human phrases —
// never the data-action enum value (STEER-FIG-2).

import { useState, useRef, useEffect, useLayoutEffect, useId } from 'preact/hooks';
import './steer-menu.css';

// The four steer-action types (exact visible labels — AC-2; order is contract).
export const STEER_ACTIONS = [
  { type: 'raise-defect', label: 'Raise defect' },
  { type: 're-prioritise', label: 'Re-prioritise' },
  { type: 're-slice', label: 'Request re-slice / split' },
  { type: 'custom', label: 'Custom steer' },
];

const VIEWPORT_MARGIN = 4; // px gap kept from every viewport edge (GEO-S014-4)

// Keys the trigger handles itself — their keydown must not reach host handlers.
const TRIGGER_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'ArrowDown', 'ArrowUp']);

/**
 * @param {object} props
 * @param {string} props.itemId    - the item's id (e.g. "CHK-5") — rides the accessible name
 * @param {string} [props.itemLabel] - human item description (job sentence) for richer announcement
 * @param {(itemId: string, actionType: string) => void} [props.onSteer]
 *   - fired on action selection; UC-S014-2's panel-open seam (optional until then)
 */
export function SteerMenu({ itemId, itemLabel, onSteer }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = `steer-menu-${useId()}`;

  // Accessible name: the HUMAN item reference (STEER-FIG-1) — id first so the
  // selector contract getByRole('button', { name: /steer <id>/i }) holds; the
  // job sentence (when the host has one) enriches the announcement.
  const accName =
    itemLabel && itemLabel !== itemId
      ? `Steer ${itemId} — ${itemLabel}`
      : `Steer ${itemId}`;

  const focusTrigger = () => {
    if (triggerRef.current) triggerRef.current.focus();
  };

  const close = (restoreFocus) => {
    setOpen(false);
    if (restoreFocus) focusTrigger();
  };

  const menuItems = () =>
    menuRef.current
      ? Array.from(menuRef.current.querySelectorAll('[role="menuitem"]'))
      : [];

  // Anchor + clamp the fixed-position popover BEFORE paint (GEO-S014-4): below
  // the trigger, left-aligned; flipped above / clamped when it would leave the
  // viewport. position:fixed keeps it out of flow (GEO-S014-1..3).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = t.left;
    let top = t.bottom + VIEWPORT_MARGIN;
    if (left + m.width > vw - VIEWPORT_MARGIN) left = vw - m.width - VIEWPORT_MARGIN;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (top + m.height > vh - VIEWPORT_MARGIN && t.top - m.height - VIEWPORT_MARGIN >= 0) {
      top = t.top - m.height - VIEWPORT_MARGIN; // flip above the trigger
    }
    if (top + m.height > vh - VIEWPORT_MARGIN) top = Math.max(VIEWPORT_MARGIN, vh - m.height - VIEWPORT_MARGIN);
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    setPos({ left, top });
  }, [open]);

  // Focus the FIRST menuitem on open (S14-1-A11Y-2).
  useEffect(() => {
    if (!open) return;
    const items = menuItems();
    if (items.length > 0) items[0].focus();
  }, [open]);

  // Click-outside closes (no focus steal). Capture phase so a host's own
  // stopPropagation cannot hide the outside press from us.
  useEffect(() => {
    if (!open) return undefined;
    const onDocPointerDown = (e) => {
      const root = triggerRef.current && triggerRef.current.parentNode;
      if (root && root.contains(e.target)) return; // inside trigger/menu subtree
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointerDown, true);
    return () => document.removeEventListener('mousedown', onDocPointerDown, true);
  }, [open]);

  const onTriggerClick = (e) => {
    e.stopPropagation(); // never also drill/select the host row
    setOpen((v) => !v);
  };

  const onTriggerKeyDown = (e) => {
    if (!TRIGGER_KEYS.has(e.key)) return;
    // Stop the host's keydown handlers (which preventDefault Enter/Space) from
    // suppressing the button's native activation — but do NOT preventDefault
    // Enter/Space ourselves: the native click is the open path (A11Y-1).
    e.stopPropagation();
    if (e.key === 'Escape') {
      close(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true); // focus lands on the first item via the open effect
    }
  };

  const onMenuKeyDown = (e) => {
    const items = menuItems();
    const idx = items.indexOf(document.activeElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (items.length) items[(idx + 1) % items.length].focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (items.length) items[(idx - 1 + items.length) % items.length].focus();
        break;
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        if (items.length) items[0].focus();
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        if (items.length) items[items.length - 1].focus();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true); // Esc returns focus to the trigger (S14-1-A11Y-2)
        break;
      case 'Tab':
        // No trap: let focus move on naturally, just close behind it.
        e.stopPropagation();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const choose = (e, actionType) => {
    e.stopPropagation(); // selection must not drill the host row (F-3)
    if (typeof onSteer === 'function') onSteer(itemId, actionType);
    close(true);
  };

  return (
    <span class="steer" data-steer-item={itemId}>
      <button
        ref={triggerRef}
        type="button"
        class="steer-btn"
        data-testid="steer-btn"
        data-item-id={itemId}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-label={accName}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        {...(open ? { 'aria-controls': menuId } : {})}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          class="steer-menu"
          data-testid="steer-menu"
          role="menu"
          aria-label="Steer actions"
          style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
          onKeyDown={onMenuKeyDown}
          onClick={(e) => e.stopPropagation()}
        >
          {STEER_ACTIONS.map((a) => (
            <button
              key={a.type}
              type="button"
              class="steer-menu__item"
              role="menuitem"
              data-testid={`steer-action-${a.type}`}
              data-action={a.type}
              tabindex="-1"
              onClick={(e) => choose(e, a.type)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
