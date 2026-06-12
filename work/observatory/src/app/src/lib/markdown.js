// UC-S013-3 — lib/markdown.js: the ONE shared markdown→HTML transform.
// Non-behavioural extraction of ArtifactView's mdToHtml/stripFrontmatter
// (ui-design.md build contract #3: a single markdown path in the codebase —
// ArtifactView and DefectDetail both consume THIS module; never a second
// renderer).
//
// HEXAGONAL ROLE: pure domain-side text transform (string → HTML string).
// marked is a pure client-side dep; no DOM, no fetch, no component coupling.
import { marked } from 'marked';

/** Strip a leading YAML frontmatter block (--- ... ---) so it is not rendered
 *  as a setext heading. Only a frontmatter block at the very start is removed. */
export function stripFrontmatter(md) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
  return fm.test(md) ? md.replace(fm, '') : md;
}

/** Render markdown text to a semantic-HTML string (fail-soft to empty). */
export function mdToHtml(text) {
  if (typeof text !== 'string') return '';
  try {
    return marked.parse(stripFrontmatter(text), { gfm: true, breaks: false });
  } catch {
    return '';
  }
}
