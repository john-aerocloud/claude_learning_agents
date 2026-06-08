import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App routing (C1)', () => {
  it('renders the game at the root route', () => {
    renderAt('/');
    // Nine board cells and the turn indicator prove the game is mounted.
    expect(screen.getAllByRole('button', { name: /^cell \d$/ })).toHaveLength(9);
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
  });

  it('does not render the slice-001 title placeholder at root', () => {
    renderAt('/');
    expect(
      screen.queryByRole('heading', { name: /oxo-online/i, level: 1 }),
    ).not.toBeInTheDocument();
  });
});

// s008 UC2 (T1/T2/SM-2) — the deep-link route. A share link
// (https://<domain>/join/<code>) is served by CloudFront's SPA-fallback as
// index.html; React Router resolves /join/:code CLIENT-SIDE and renders the join
// screen with the code pre-filled and Join enabled (one-click join). The base
// path "/" still shows the normal mode-selector game (no regression).
// @covers spaJoinRoute
describe('App routing — /join/:code deep link (s008 UC2)', () => {
  it('renders the join screen with the code from the URL pre-filled', () => {
    renderAt('/join/ABC234');
    expect(screen.getByRole('group', { name: /game mode/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/game code/i)).toHaveValue('ABC234');
  });

  it('enables one-click join on the deep-link route (Join enabled, no interaction)', () => {
    renderAt('/join/ABC234');
    expect(screen.getByRole('button', { name: /^join$/i })).toBeEnabled();
  });

  it('the root route still shows the normal game (no deep-link pre-fill)', () => {
    renderAt('/');
    expect(screen.getAllByRole('button', { name: /^cell \d$/ })).toHaveLength(9);
    expect(screen.queryByLabelText(/game code/i)).not.toBeInTheDocument();
  });
});
