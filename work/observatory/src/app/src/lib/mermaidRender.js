// UC-S005-4 — mermaid ADAPTER (hexagonal): the ONLY module that imports the
// concrete `mermaid` SDK. ArtifactView consumes it through the `renderMmd` port
// (a `(code, id) => Promise<svgString>` function), so the render layer never
// touches the SDK directly and unit tests inject a port fake. The real adapter
// is exercised live in the browser (Playwright :5199) — jsdom cannot lay out an
// SVG, which is exactly why mermaid runs behind a port here.
//
// FAIL-SOFT taxonomy: a parse/render failure is a 4xx-class CALLER-DATA problem
// (the artifact text is bad mermaid), not an availability failure — the adapter
// rejects so ArtifactView shows the readable-text fallback (never blank/broken).

let mermaidPromise = null;
let initialised = false;

/** Lazy-load + init mermaid once (client-only; deferred so it never blocks SSR/tests). */
async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default || m);
  }
  const mermaid = await mermaidPromise;
  if (!initialised) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict', // no script injection from artifact content
      theme: 'neutral',
    });
    initialised = true;
  }
  return mermaid;
}

/**
 * Render mermaid source to an SVG string. The default `renderMmd` port impl.
 * @param {string} code - mermaid diagram source
 * @param {string} id   - unique render id (mermaid requires a DOM-safe id)
 * @returns {Promise<string>} the SVG markup
 */
export async function renderMermaidToSvg(code, id) {
  const mermaid = await getMermaid();
  const { svg } = await mermaid.render(id, code);
  return svg;
}
