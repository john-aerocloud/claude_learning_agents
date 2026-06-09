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
import { MapContainer } from './components/MapContainer.jsx';
import './styles/tokens.css';

// UC3 mounts the pipeline map as the App child here (the one allowed edit to
// this seam). MapContainer loads the UC2 QueueState[] and renders PipelineMap;
// App renders it inside the <main> landmark without being edited.
render(
  <App>
    <MapContainer />
  </App>,
  document.getElementById('app'),
);
