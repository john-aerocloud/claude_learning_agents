import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import TitleScreen from './pages/TitleScreen';
import { GameRoot } from './game/GameRoot';

/**
 * s008 UC2 — deep-link join route element. Reads the `:code` URL segment from
 * the share link (`https://<domain>/join/<code>`) and mounts the game directly
 * in the join flow with the code pre-filled (one-click join, T2/SM-2). The
 * actual WS join path is byte-for-byte s005/s006 — no new client→server
 * contract. CloudFront's existing 403/404→200+index.html SPA-fallback serves
 * the unknown `/join/<code>` path as index.html so React Router resolves it
 * here CLIENT-SIDE (no infra change — delta 008 / OI-31 dependency).
 */
function DeepLinkJoin() {
  const { code } = useParams<{ code: string }>();
  // The route only matches when :code is present; the upper-case normalisation
  // matches the manual-entry input so the pre-filled value is consistent.
  return <GameRoot initialJoinCode={(code ?? '').toUpperCase()} />;
}

/**
 * App router.
 *
 * Slice 002: the root route renders the playable local two-player game
 * (GameRoot) instead of the slice-001 placeholder. The title screen is kept
 * behind /title — its "Play Online"/"Play vs Computer" buttons are the entry
 * points for later slices, so it is preserved rather than deleted.
 *
 * Slice 008: `/join/:code` is the share-link deep route — it mounts the game in
 * the join flow with the code pre-filled. Any OTHER unknown client-side route
 * (including deep links that CloudFront rewrites to index.html) falls through to
 * the game so the SPA never shows a hard 404.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GameRoot />} />
      <Route path="/join/:code" element={<DeepLinkJoin />} />
      <Route path="/title" element={<TitleScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
