// Vitest/jsdom global setup: jest-dom matchers (toBeInTheDocument, etc.) and
// per-test DOM cleanup so component renders do not leak between tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
