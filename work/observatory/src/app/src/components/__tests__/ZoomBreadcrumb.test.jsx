// @covers ZoomBreadcrumb
// UC-S005-6 — the zoom-out breadcrumb in the detail drawer. It renders the full
// root->selected path of the drilled item (e.g. Pipeline > CHK-4 > s005 > UC) as
// a labelled <nav>, each ancestor a keyboard-operable crumb that zooms OUT, the
// current (selected) crumb marked aria-current, separators aria-hidden, plus a
// leading "Back to map" root control. It is a PURE render of the path it is given
// (the container/pane derives the path via ancestryPath).
//
// Pins:
//   - labelled nav ("Zoom path") with a back-to-map root control (AC-S005-6-1/4)
//   - one crumb per ancestor in root->selected order; current crumb aria-current
//   - clicking an ancestor crumb zooms out (onZoomTo(id)); clicking back-to-map closes
//   - separators are aria-hidden (A11Y-S005-5)
//   - fail-soft: empty/absent path still renders the back-to-map control, no crash
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import { ZoomBreadcrumb } from '../ZoomBreadcrumb.jsx';

const PATH = [
  { id: 'REQ-OBSERVATORY', type: 'requirement' },
  { id: 'CHK-4', type: 'chunk' },
  { id: 'UC-S005-6', type: 'use-case' },
];

describe('ZoomBreadcrumb (UC-S005-6)', () => {
  it('renders a labelled nav with a back-to-map root control (A11Y-S005-5)', () => {
    render(<ZoomBreadcrumb path={PATH} onClose={() => {}} onZoomTo={() => {}} />);
    const nav = screen.getByTestId('breadcrumb');
    expect(nav.tagName.toLowerCase()).toBe('nav');
    expect(nav.getAttribute('aria-label')).toBe('Zoom path');
    expect(screen.getByTestId('back-to-map')).toBeTruthy();
  });

  it('renders one crumb per ancestor in root->selected order', () => {
    render(<ZoomBreadcrumb path={PATH} onClose={() => {}} onZoomTo={() => {}} />);
    const crumbs = screen.getAllByTestId('crumb');
    expect(crumbs.map((c) => c.getAttribute('data-crumb-id'))).toEqual([
      'REQ-OBSERVATORY', 'CHK-4', 'UC-S005-6',
    ]);
    // the whole path is legible in the nav text (AC-S005-6-1)
    const nav = screen.getByTestId('breadcrumb');
    expect(nav).toHaveTextContent('REQ-OBSERVATORY');
    expect(nav).toHaveTextContent('CHK-4');
    expect(nav).toHaveTextContent('UC-S005-6');
  });

  it('marks the selected (last) crumb aria-current and not the ancestors', () => {
    render(<ZoomBreadcrumb path={PATH} onClose={() => {}} onZoomTo={() => {}} />);
    const crumbs = screen.getAllByTestId('crumb');
    expect(crumbs[crumbs.length - 1].getAttribute('aria-current')).toBe('page');
    expect(crumbs[0].getAttribute('aria-current')).toBeNull();
  });

  it('separators between crumbs are aria-hidden (A11Y-S005-5)', () => {
    render(<ZoomBreadcrumb path={PATH} onClose={() => {}} onZoomTo={() => {}} />);
    const seps = screen.getByTestId('breadcrumb').querySelectorAll('.detail-pane__crumb-sep');
    expect(seps.length).toBeGreaterThan(0);
    seps.forEach((s) => expect(s.getAttribute('aria-hidden')).toBe('true'));
  });

  it('clicking an ANCESTOR crumb zooms out to that item (onZoomTo)', () => {
    const onZoomTo = vi.fn();
    render(<ZoomBreadcrumb path={PATH} onClose={() => {}} onZoomTo={onZoomTo} />);
    const chk = screen.getAllByTestId('crumb').find((c) => c.getAttribute('data-crumb-id') === 'CHK-4');
    fireEvent.click(within(chk).getByRole('button'));
    expect(onZoomTo).toHaveBeenCalledWith('CHK-4');
  });

  it('the current crumb is not an actionable button (you are already here)', () => {
    const onZoomTo = vi.fn();
    render(<ZoomBreadcrumb path={PATH} onClose={() => {}} onZoomTo={onZoomTo} />);
    const current = screen.getAllByTestId('crumb').at(-1);
    expect(within(current).queryByRole('button')).toBeNull();
  });

  it('clicking "Back to map" closes the drawer (AC-S005-6-4)', () => {
    const onClose = vi.fn();
    render(<ZoomBreadcrumb path={PATH} onClose={onClose} onZoomTo={() => {}} />);
    fireEvent.click(screen.getByTestId('back-to-map'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fails soft: empty path still renders back-to-map, no crash', () => {
    const errSpy = vi.spyOn(console, 'error');
    render(<ZoomBreadcrumb path={[]} onClose={() => {}} onZoomTo={() => {}} />);
    expect(screen.getByTestId('back-to-map')).toBeTruthy();
    expect(screen.queryAllByTestId('crumb')).toHaveLength(0);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
