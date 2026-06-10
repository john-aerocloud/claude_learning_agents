// @covers uc-s014-1
// @covers SteerMenu
// UC-S014-1 — Steer-action menu: trigger button + anchored popover with the
// FOUR steer-action types. jsdom unit pins (the GEO/no-reflow + real-keyboard
// conditions live in e2e/steer-menu.spec.js):
//   - trigger contract: data-testid=steer-btn, aria-haspopup=menu, aria-expanded,
//     accessible name carries the HUMAN item reference (STEER-FIG-1), never a
//     row:N / bare-index token
//   - exactly four role=menuitem entries with the EXACT human labels (F-2 /
//     AC-2 / STEER-FIG-2); visible text ≠ data-action enum value
//   - open/close: click toggles; Esc closes + returns focus to trigger;
//     click-outside closes (S14-1-A11Y-2)
//   - focus: first menuitem focused on open; ArrowDown/ArrowUp cycle with wrap
//   - selection: fires onSteer(itemId, actionType) once, closes, no reload (F-3)
//   - self-containment: the trigger/menu STOP propagation of click + Enter/Space
//     keydown so host rows (tree drill onClick, StageNode/tree onKeyDown
//     preventDefault) neither hijack nor suppress the menu
//   - ids: aria-controls points at the rendered menu id; two instances for the
//     SAME item id on one page get distinct menu ids (chip + tree row co-exist)
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SteerMenu } from '../SteerMenu.jsx';

const LABELS = ['Raise defect', 'Re-prioritise', 'Request re-slice / split', 'Custom steer'];
const TYPES = ['raise-defect', 're-prioritise', 're-slice', 'custom'];

function openMenu() {
  const btn = screen.getByTestId('steer-btn');
  fireEvent.click(btn);
  return { btn, menu: screen.getByTestId('steer-menu') };
}

describe('SteerMenu (UC-S014-1) — trigger contract', () => {
  it('renders the steer-btn with role button, aria-haspopup=menu, aria-expanded=false', () => {
    render(<SteerMenu itemId="CHK-5" />);
    const btn = screen.getByTestId('steer-btn');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // data-steer-item-id, NOT data-item-id — the latter is the treeitem <li>'s
    // unique selector contract and must not be duplicated on the trigger.
    expect(btn.getAttribute('data-steer-item-id')).toBe('CHK-5');
    expect(btn.hasAttribute('data-item-id')).toBe(false);
    // menu closed = absent
    expect(screen.queryByTestId('steer-menu')).toBeNull();
  });

  it('accessible name is the HUMAN item reference "Steer <id>" (STEER-FIG-1), not a positional token', () => {
    render(<SteerMenu itemId="CHK-5" itemLabel="Compose a structured preview-first prompt" />);
    const btn = screen.getByRole('button', { name: /steer CHK-5/i });
    expect(btn).toBeTruthy();
    const name = btn.getAttribute('aria-label');
    expect(name).not.toMatch(/row:\d+/i);
    expect(name).not.toMatch(/^\d+$/);
  });

  it('glyph is decorative (aria-hidden) — the label rides aria-label only', () => {
    render(<SteerMenu itemId="CHK-5" />);
    const glyph = screen.getByTestId('steer-btn').querySelector('[aria-hidden="true"]');
    expect(glyph).toBeTruthy();
  });
});

describe('SteerMenu (UC-S014-1) — open menu (F-2 / AC-2 / A11Y-5)', () => {
  it('click opens role=menu named "Steer actions"; aria-expanded flips true; aria-controls links it', () => {
    render(<SteerMenu itemId="CHK-5" />);
    const { btn, menu } = openMenu();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBe('Steer actions');
    expect(btn.getAttribute('aria-controls')).toBe(menu.id);
    expect(menu.id).toBeTruthy();
  });

  it('shows EXACTLY four menuitems with the exact human labels, in order', () => {
    render(<SteerMenu itemId="CHK-5" />);
    openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((el) => el.textContent.trim())).toEqual(LABELS);
  });

  it('each menuitem carries data-action + data-testid steer-action-<type>; visible text ≠ enum (STEER-FIG-2)', () => {
    render(<SteerMenu itemId="CHK-5" />);
    openMenu();
    TYPES.forEach((type, i) => {
      const el = screen.getByTestId(`steer-action-${type}`);
      expect(el.getAttribute('data-action')).toBe(type);
      expect(el.textContent.trim()).toBe(LABELS[i]);
      expect(el.textContent.trim()).not.toBe(type); // human phrase, never the raw enum
    });
  });

  it('second click on the trigger closes the menu (toggle)', () => {
    render(<SteerMenu itemId="CHK-5" />);
    const { btn } = openMenu();
    fireEvent.click(btn);
    expect(screen.queryByTestId('steer-menu')).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('two instances for the SAME item id render distinct menu ids (chip + tree row co-exist)', () => {
    render(
      <div>
        <SteerMenu itemId="CHK-5" />
        <SteerMenu itemId="CHK-5" />
      </div>,
    );
    const [a, b] = screen.getAllByTestId('steer-btn');
    fireEvent.click(a);
    fireEvent.click(b);
    const menus = screen.getAllByTestId('steer-menu');
    expect(menus).toHaveLength(2);
    expect(menus[0].id).not.toBe(menus[1].id);
  });
});

describe('SteerMenu (UC-S014-1) — focus + keyboard (S14-1-A11Y-2)', () => {
  it('moves focus to the FIRST menuitem on open', () => {
    render(<SteerMenu itemId="CHK-5" />);
    openMenu();
    expect(document.activeElement).toBe(screen.getByTestId('steer-action-raise-defect'));
  });

  it('ArrowDown / ArrowUp cycle through the items with wrap', () => {
    render(<SteerMenu itemId="CHK-5" />);
    const { menu } = openMenu();
    const items = screen.getAllByRole('menuitem');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' }); // wrap up → last
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // wrap down → first
    expect(document.activeElement).toBe(items[0]);
  });

  it('Esc closes the menu and RETURNS focus to the trigger', () => {
    render(<SteerMenu itemId="CHK-5" />);
    const { btn, menu } = openMenu();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByTestId('steer-menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('click outside closes the menu (no focus steal back to trigger)', () => {
    render(
      <div>
        <button type="button" data-testid="outside">outside</button>
        <SteerMenu itemId="CHK-5" />
      </div>,
    );
    openMenu();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('steer-menu')).toBeNull();
  });
});

describe('SteerMenu (UC-S014-1) — selection (F-3 / AC-3)', () => {
  it('selecting an action fires onSteer(itemId, actionType) ONCE and closes the menu', () => {
    const onSteer = vi.fn();
    render(<SteerMenu itemId="CHK-5" onSteer={onSteer} />);
    openMenu();
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onSteer).toHaveBeenCalledWith('CHK-5', 're-slice');
    expect(screen.queryByTestId('steer-menu')).toBeNull();
  });

  it.each(TYPES)('passes the %s action type through', (type) => {
    const onSteer = vi.fn();
    render(<SteerMenu itemId="UC-D4-1" onSteer={onSteer} />);
    openMenu();
    fireEvent.click(screen.getByTestId(`steer-action-${type}`));
    expect(onSteer).toHaveBeenCalledWith('UC-D4-1', type);
  });

  it('works without an onSteer callback (UC-S014-2 not built yet) — no throw, still closes', () => {
    render(<SteerMenu itemId="CHK-5" />);
    openMenu();
    fireEvent.click(screen.getByTestId('steer-action-custom'));
    expect(screen.queryByTestId('steer-menu')).toBeNull();
  });
});

describe('SteerMenu (UC-S014-1) — self-containment inside host rows', () => {
  // The tree row drills on click; StageNode/WorkItemTree preventDefault on
  // Enter/Space keydown. The SteerMenu must neither trigger the host action nor
  // let the host suppress its own activation: it stops propagation itself.
  it('trigger click does NOT propagate to a host click handler (tree drill unchanged)', () => {
    const hostClick = vi.fn();
    render(
      <div onClick={hostClick}>
        <SteerMenu itemId="CHK-5" />
      </div>,
    );
    fireEvent.click(screen.getByTestId('steer-btn'));
    expect(hostClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('steer-menu')).toBeTruthy();
  });

  it('Enter/Space keydown on the trigger does NOT propagate to a host keydown handler', () => {
    const hostKey = vi.fn();
    render(
      <div onKeyDown={hostKey}>
        <SteerMenu itemId="CHK-5" />
      </div>,
    );
    const btn = screen.getByTestId('steer-btn');
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ' });
    expect(hostKey).not.toHaveBeenCalled();
  });

  it('menuitem click does NOT propagate to a host click handler', () => {
    const hostClick = vi.fn();
    const onSteer = vi.fn();
    render(
      <div onClick={hostClick}>
        <SteerMenu itemId="CHK-5" onSteer={onSteer} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('steer-btn'));
    fireEvent.click(screen.getByTestId('steer-action-raise-defect'));
    expect(hostClick).not.toHaveBeenCalled();
    expect(onSteer).toHaveBeenCalledWith('CHK-5', 'raise-defect');
  });
});
