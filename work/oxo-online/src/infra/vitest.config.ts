import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // CDK synth can be slow on cold first synth.
    testTimeout: 30000,
  },
});
