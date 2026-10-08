import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the built app works from any folder or static host.
  base: './',
  // The Firebase SDK is a separate, lazily loaded chunk.
  build: { chunkSizeWarningLimit: 700 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
