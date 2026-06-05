import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TitleScreen from './TitleScreen';

function renderTitleScreen() {
  return render(
    <MemoryRouter>
      <TitleScreen />
    </MemoryRouter>,
  );
}

describe('TitleScreen', () => {
  it('renders the "oxo-online" heading', () => {
    renderTitleScreen();
    expect(
      screen.getByRole('heading', { name: /oxo-online/i, level: 1 }),
    ).toBeInTheDocument();
  });

  it('shows a "Play Online" button', () => {
    renderTitleScreen();
    expect(
      screen.getByRole('button', { name: /play online/i }),
    ).toBeInTheDocument();
  });

  it('shows a "Play vs Computer" button', () => {
    renderTitleScreen();
    expect(
      screen.getByRole('button', { name: /play vs computer/i }),
    ).toBeInTheDocument();
  });

  it('renders a Leaderboard placeholder section', () => {
    renderTitleScreen();
    expect(
      screen.getByRole('heading', { name: /leaderboard/i }),
    ).toBeInTheDocument();
  });
});
