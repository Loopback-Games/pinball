import { defineConfig } from 'vitest/config';

// Project pages are served from https://<org>.github.io/<repo>/, so every asset
// URL needs the repository name as a prefix. Local dev serves from the root.
const base = process.env.GITHUB_ACTIONS ? '/pinball/' : '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
