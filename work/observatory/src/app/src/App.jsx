// Observatory app shell (UC-S002-1 scaffold). This is the COMPOSITION POINT the
// render UCs attach to. It owns ONLY the page chrome (banner + main landmark +
// build-identity stamp); it intentionally renders no pipeline-map logic.
//
// EXTENSION SEAM (so UC2/UC3 plug in WITHOUT editing each other's files): App
// renders `children` inside the <main> landmark. main.jsx (the entry, owned by
// this UC) is where UC3 will mount <PipelineMap .../> as the App child — UC3
// owns PipelineMap.jsx and the line in main.jsx that passes it in; UC2 owns the
// state module main.jsx imports. Neither edits App.jsx. When no child is
// mounted yet, the slot shows a placeholder so the shell is never blank.

// __COMMIT_SHA__ is a build-time define injected by Vite (pipeline sets
// VITE_COMMIT_SHA; 'dev' locally, 'test' under Vitest). Never hardcoded.
/* global __COMMIT_SHA__ */
const COMMIT_SHA = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'dev';

export function App({ children }) {
  return (
    <div class="app-shell">
      <header role="banner" class="app-header">
        <h1>Delivery Observatory</h1>
        <span data-testid="build-sha" class="build-sha" title="build commit">
          {COMMIT_SHA}
        </span>
      </header>
      <main>
        {children ?? <p class="placeholder">Pipeline map loads here.</p>}
      </main>
    </div>
  );
}
