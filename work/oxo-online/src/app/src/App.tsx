import { Routes, Route, Navigate } from 'react-router-dom';
import TitleScreen from './pages/TitleScreen';
import { GameRoot } from './game/GameRoot';

/**
 * App router.
 *
 * Slice 002: the root route renders the playable local two-player game
 * (GameRoot) instead of the slice-001 placeholder. The title screen is kept
 * behind /title — its "Play Online"/"Play vs Computer" buttons are the entry
 * points for later slices, so it is preserved rather than deleted. Any unknown
 * client-side route (including deep links that CloudFront rewrites to
 * index.html) falls through to the game so the SPA never shows a hard 404.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GameRoot />} />
      <Route path="/title" element={<TitleScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
