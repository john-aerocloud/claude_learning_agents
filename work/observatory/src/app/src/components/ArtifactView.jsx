// UC-S005-4 — ArtifactView: renders an item's slice artifact in the detail pane.
// Replaces the UC-S005-3 raw <pre>: markdown → semantic HTML, fenced ```mermaid
// blocks / .mmd artifacts → Mermaid SVG. FAILS SOFT — null/empty → placeholder;
// a mermaid render failure falls back to the readable raw text (never blank).
//
// HEXAGONAL ROLE: render layer. The concrete mermaid SDK is behind the `renderMmd`
// PORT (default = the real adapter lib/mermaidRender). marked is a pure
// text→HTML transform used inline. The component owns one impure effect: the
// async mermaid render into a host node (a DOM concern proper to the render layer).
//
// CONTRACT (acceptance.md UC-S005-4 + A11Y-S005-10):
//   - data-testid="artifact-view" + non-empty data-source.
//   - markdown is SEMANTIC HTML (h1/ul/table/code), NOT a top-level <pre> of source.
//   - a diagram renders into data-testid="mmd-render"; its <svg> gets role="img"
//     + an aria-label naming the diagram.
//   - null/empty text → "not yet available" placeholder, no throw (AC-S005-4-3/4).
//   - mermaid render failure → readable-text fallback, no throw.

import { useEffect, useRef, useState } from 'preact/hooks';
import './artifact-view.css';
import { renderMermaidToSvg } from '../lib/mermaidRender.js';
// UC-S013-3: mdToHtml factored out to the SHARED lib/markdown.js (one markdown
// transform in the codebase — DefectDetail consumes the same module).
import { mdToHtml } from '../lib/markdown.js';

let mmdSeq = 0;

/** Extract the first fenced ```mermaid block from markdown; return {code, rest}. */
function extractMermaid(md) {
  const fence = /```mermaid\s*\n([\s\S]*?)```/m;
  const m = fence.exec(md);
  if (!m) return { code: null, rest: md };
  const rest = md.slice(0, m.index) + md.slice(m.index + m[0].length);
  return { code: m[1].trim(), rest };
}

/**
 * The Mermaid diagram sub-view: renders `code` to an SVG inside an
 * `data-testid="mmd-render"` host. On render failure it falls back to the raw
 * code as readable text — never blank/broken.
 */
function MermaidDiagram({ code, label, renderMmd }) {
  const hostRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    const id = `mmd-${++mmdSeq}`;
    Promise.resolve()
      .then(() => renderMmd(code, id))
      .then((svg) => {
        if (!active || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        // A11Y-S005-10: the rendered <svg> is an image with an accessible name.
        const el = hostRef.current.querySelector('svg');
        if (el) {
          el.setAttribute('role', 'img');
          if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [code, label, renderMmd]);

  return (
    <div class="artifact-view__mmd">
      <div ref={hostRef} class="artifact-view__mmd-host" data-testid="mmd-render" />
      {failed ? (
        <pre class="artifact-view__mmd-fallback" data-testid="mmd-fallback">{code}</pre>
      ) : null}
    </div>
  );
}

/**
 * @param {object} props
 * @param {'md'|'mmd'|null} props.kind
 * @param {string|null} props.text   - raw artifact text
 * @param {string|null} props.source - artifact path (data-source)
 * @param {(code:string,id:string)=>Promise<string>} [props.renderMmd] - mermaid port
 */
export function ArtifactView({ kind, text, source, renderMmd = renderMermaidToSvg }) {
  const hasText = typeof text === 'string' && text.length > 0;

  let body;
  if (!hasText) {
    body = <p class="artifact-view__placeholder">Artifact not yet available for this item.</p>;
  } else if (kind === 'mmd') {
    body = <MermaidDiagram code={text} label="Artifact diagram" renderMmd={renderMmd} />;
  } else {
    // markdown — may embed a fenced ```mermaid block we render as a diagram below.
    const { code, rest } = extractMermaid(text);
    body = (
      <>
        <div
          class="artifact-view__md markdown-body"
          // marked output is trusted slice content from our own repo; mermaid
          // securityLevel=strict additionally sanitises diagram source.
          dangerouslySetInnerHTML={{ __html: mdToHtml(rest) }}
        />
        {code ? <MermaidDiagram code={code} label="Embedded diagram" renderMmd={renderMmd} /> : null}
      </>
    );
  }

  return (
    <div
      class="detail-pane__artifact artifact-view"
      data-testid="artifact-view"
      data-source={source || undefined}
    >
      {body}
    </div>
  );
}
