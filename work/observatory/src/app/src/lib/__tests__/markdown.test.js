// @covers SPA_MARKDOWNLIB
// @covers uc-s013-3
// UC-S013-3 — lib/markdown.js: the ONE shared markdown→HTML transform,
// factored OUT of ArtifactView (non-behavioural extraction) so DefectDetail
// and ArtifactView consume the same renderer — never a second one
// (ui-design.md "One markdown transform" build directive).
import { describe, it, expect } from 'vitest';
import { mdToHtml, stripFrontmatter } from '../markdown.js';

describe('mdToHtml (shared transform — UC-S013-3 extraction)', () => {
  it('renders inline markdown to semantic HTML — **bold** → <strong>, never literal ** (S13-3-FIG-6)', () => {
    const html = mdToHtml('The UI shows **0 for everything**, even while building.');
    expect(html).toContain('<strong>0 for everything</strong>');
    expect(html).not.toContain('**');
    expect(html).toMatch(/<p>/);
  });

  it('renders block markdown (headings + lists, gfm) — the ArtifactView behaviour preserved', () => {
    const html = mdToHtml('# Title\n\n- one\n- two\n');
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });

  it('strips a leading YAML frontmatter block so it is never rendered as a setext heading', () => {
    const html = mdToHtml('---\nslice: s013\n---\n# Real heading\n');
    expect(html).toMatch(/<h1[^>]*>Real heading<\/h1>/);
    expect(html).not.toContain('slice: s013');
  });

  it('fail-soft: null/non-string input → empty string, never a throw', () => {
    expect(mdToHtml(null)).toBe('');
    expect(mdToHtml(undefined)).toBe('');
  });

  it('stripFrontmatter only removes a block at the very start', () => {
    const md = 'text\n---\nnot frontmatter\n---\n';
    expect(stripFrontmatter(md)).toBe(md);
  });
});
