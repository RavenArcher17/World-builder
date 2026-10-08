import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the built app works from any folder or static host.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
