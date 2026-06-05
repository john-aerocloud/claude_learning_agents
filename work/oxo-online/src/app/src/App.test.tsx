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
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
  });

  it('does not render the slice-001 title placeholder at root', () => {
    renderAt('/');
    expect(
      screen.queryByRole('heading', { name: /oxo-online/i, level: 1 }),
    ).not.toBeInTheDocument();
  });
});
