// @covers ArtifactView
// UC-S005-4 — ArtifactView replaces the raw <pre> artifact slot. It renders the
// artifact text: markdown → semantic HTML (headings/lists/tables/code) and
// fenced ```mermaid blocks / .mmd artifacts → Mermaid SVG (role="img" + name).
// It FAILS SOFT: null/empty → "not yet available" placeholder, never blank/broken;
// a mermaid parse failure falls back to readable text, no throw.
//
// Pins (acceptance.md UC-S005-4 + A11Y-S005-10):
//   - AC-S005-4-1 markdown table → <table> (no raw "|" at top level)
//   - AC-S005-4-2 fenced code → <code>/<pre><code>
//   - AC-S005-3-2 markdown is semantic HTML, NOT a top-level <pre> of raw source
//   - AC-S005-4-3 null markdown input → no throw, placeholder
//   - AC-S005-4-4 null mermaid input → no throw, placeholder
//   - A11Y-S005-10 mermaid <svg> carries role="img" + an aria-label
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ArtifactView } from '../ArtifactView.jsx';

describe('ArtifactView markdown render (UC-S005-4)', () => {
  it('AC-S005-4-1 renders a markdown table as a <table>, not raw pipes', () => {
    const md = [
      '# Heading',
      '',
      '| col a | col b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
    ].join('\n');
    render(<ArtifactView kind="md" text={md} source="x/slice.md" />);
    const view = screen.getByTestId('artifact-view');
    expect(view.querySelector('table')).toBeTruthy();
    expect(view.querySelector('h1')).toBeTruthy();
    // the rendered output is not a top-level <pre> blob of raw source (AC-S005-3-2)
    expect(view.querySelector(':scope > pre')).toBeNull();
  });

  it('AC-S005-4-2 renders a fenced code block as <code>', () => {
    const md = ['```js', 'const x = 1;', '```', ''].join('\n');
    render(<ArtifactView kind="md" text={md} source="x/slice.md" />);
    const view = screen.getByTestId('artifact-view');
    expect(view.querySelector('code')).toBeTruthy();
  });

  it('strips leading YAML frontmatter so it is not rendered as a setext heading', () => {
    const md = ['---', 'slice: s001', 'status: ready', '---', '', '# Real Heading', '', 'body text', ''].join('\n');
    render(<ArtifactView kind="md" text={md} source="x/slice.md" />);
    const view = screen.getByTestId('artifact-view');
    const h1 = view.querySelector('h1');
    expect(h1).toBeTruthy();
    expect(h1.textContent).toBe('Real Heading');
    // the frontmatter keys are not rendered as heading text
    expect(view.textContent).not.toMatch(/slice: s001/);
  });

  it('renders markdown lists as <ul>/<li>', () => {
    render(<ArtifactView kind="md" text={'- one\n- two\n'} source="x/slice.md" />);
    const view = screen.getByTestId('artifact-view');
    expect(view.querySelectorAll('li').length).toBe(2);
  });

  it('carries a non-empty data-source for traceability', () => {
    render(<ArtifactView kind="md" text={'# h'} source="work/.../slices/s001/slice.md" />);
    expect(screen.getByTestId('artifact-view').getAttribute('data-source')).toContain('s001');
  });

  it('AC-S005-4-3 null markdown input → placeholder, no throw / console.error', () => {
    const errSpy = vi.spyOn(console, 'error');
    render(<ArtifactView kind="md" text={null} source={null} />);
    expect(screen.getByTestId('artifact-view')).toHaveTextContent(/not yet available/i);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// HEXAGONAL: mermaid is a concrete external SDK behind a PORT (renderMmd). The
// default adapter calls the real mermaid lib (proven live in the browser on
// :5199 — jsdom cannot lay out an SVG); these unit tests inject a port FAKE so
// the COMPONENT contract (svg host, role=img, fenced-block detection, fail-soft
// fallback) is pinned deterministically without depending on jsdom layout.
describe('ArtifactView mermaid render (UC-S005-4)', () => {
  const fakeOkRenderer = async (code, id) =>
    `<svg role="img" aria-label="diagram ${id}"><g>${code}</g></svg>`;
  const fakeThrowRenderer = async () => {
    throw new Error('parse error');
  };

  it('renders a .mmd artifact as an SVG inside data-testid="mmd-render" with role=img + aria-label (A11Y-S005-10)', async () => {
    const mmd = 'graph TD; A-->B;';
    render(<ArtifactView kind="mmd" text={mmd} source="x/use-case-deps.mmd" renderMmd={fakeOkRenderer} />);
    const host = await screen.findByTestId('mmd-render');
    const svg = await vi.waitFor(() => {
      const s = host.querySelector('svg');
      expect(s).toBeTruthy();
      return s;
    });
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBeTruthy();
  });

  it('detects a fenced ```mermaid block inside markdown and renders it as a diagram', async () => {
    const md = ['# Diagram', '', '```mermaid', 'graph TD; A-->B;', '```', ''].join('\n');
    render(<ArtifactView kind="md" text={md} source="x/slice.md" renderMmd={fakeOkRenderer} />);
    const host = await screen.findByTestId('mmd-render');
    await vi.waitFor(() => expect(host.querySelector('svg')).toBeTruthy());
  });

  it('AC-S005-4-4 null mermaid input → placeholder, no throw', () => {
    const errSpy = vi.spyOn(console, 'error');
    render(<ArtifactView kind="mmd" text={null} source={null} renderMmd={fakeOkRenderer} />);
    expect(screen.getByTestId('artifact-view')).toHaveTextContent(/not yet available/i);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('falls back to readable text (not blank) when mermaid render throws', async () => {
    const mmd = 'this is not valid mermaid @@@';
    render(<ArtifactView kind="mmd" text={mmd} source="x/bad.mmd" renderMmd={fakeThrowRenderer} />);
    const view = screen.getByTestId('artifact-view');
    // the raw text survives as a readable fallback — never blank/broken
    await vi.waitFor(() => expect(view).toHaveTextContent('this is not valid mermaid'));
  });
});
