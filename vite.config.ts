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
    // The containment fuzz and shot-reachability suites each run thousands of
    // seconds of simulated play. They take a couple of seconds on a developer
    // machine and rather longer on a shared CI runner.
    testTimeout: 60_000,
  },
});
