// @covers app-shell
// App shell component test (UC-S002-1 / AC1.1-AC1.2 surrogate at the unit level).
// The scaffold renders a recognizable shell: a top-level banner with the
// Observatory heading, and a main landmark that is the composition slot the
// render UCs (UC3 PipelineMap) mount into — without editing this file.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { App } from '../App.jsx';

describe('App shell (scaffold)', () => {
  it('renders the Observatory heading (recognizable shell)', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /observatory/i, level: 1 })).toBeInTheDocument();
  });

  it('renders a main landmark as the composition slot for the render UCs', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders any child passed into the slot (extension point for UC3 PipelineMap)', () => {
    render(
      <App>
        <div data-testid="uc3-slot-probe">map goes here</div>
      </App>,
    );
    expect(screen.getByTestId('uc3-slot-probe')).toBeInTheDocument();
  });

  it('stamps the build identity (commit sha) on the shell for version traceability', () => {
    render(<App />);
    // build-sha is injected by the pipeline (__COMMIT_SHA__); 'test' under Vitest.
    expect(screen.getByTestId('build-sha')).toHaveTextContent(/.+/);
  });

  it('shows a placeholder in the slot when no children are mounted yet', () => {
    render(<App />);
    // before UC3 lands, the main slot is not blank — it carries a placeholder.
    expect(screen.getByText(/pipeline map/i)).toBeInTheDocument();
  });
});
