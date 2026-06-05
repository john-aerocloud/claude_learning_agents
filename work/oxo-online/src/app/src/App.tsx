import { Routes, Route, Navigate } from 'react-router-dom';
import TitleScreen from './pages/TitleScreen';

/**
 * App router — slice 001 shell.
 *
 * Only the root route renders a real screen. Any unknown client-side route
 * (including deep links like /game/test, which CloudFront rewrites to
 * index.html on refresh) falls through to the title screen so the SPA never
 * shows a hard 404. Real routes (/game/:id, etc.) arrive in later slices.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TitleScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
