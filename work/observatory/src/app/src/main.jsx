// Preact entry (UC-S002-1 scaffold). Mounts the App shell into #app.
//
// THIS IS THE WIRING SEAM for the parallel set:
//   - UC2 (state layer, src/app/src/state/queues.js) exposes initQueueState().
//   - UC3 (render, src/app/src/components/PipelineMap.jsx) is mounted HERE as the
//     App child: `<App><PipelineMap .../></App>`. UC3 owns PipelineMap.jsx AND
//     the single line below that imports + passes it in.
//   - UC5/UC6 attach constraint + SSE wiring through the same child, not App.jsx.
// Keeping the composition in main.jsx (not App.jsx) means the render UCs add
// their mount line here without ever editing the shell. UC1 ships the App shell
// alone; the map child arrives with UC3.
import { render } from 'preact';
import { App } from './App.jsx';
import { VsmContainer } from './components/VsmContainer.jsx';
import './styles/tokens.css';

// DEFECT-001 / UC-S004-2: the PRIMARY mounted view is the value-stream map.
// VsmContainer loads GET /api/projects/:id/stage-flow (real per-stage throughput
// + in-flight WIP) and renders ValueStreamMap inside the <main> landmark.
//
// This REPLACES the old <MapContainer/> (CHK-2 PipelineMap), which rendered
// queue DEPTHS from queues/*.csv — empty in a pull system, so the UI showed
// 0,0,0,0 while work was actively happening (DEFECT-001). MapContainer /
// PipelineMap remain in the tree (their unit tests still pass) but are no longer
// mounted; the value-stream map is the surface the operator sees.
render(
  <App>
    <VsmContainer />
  </App>,
  document.getElementById('app'),
);
