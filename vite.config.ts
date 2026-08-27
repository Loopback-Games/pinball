import { defineConfig } from 'vitest/config';

// Project pages are served from https://<org>.github.io/<repo>/, so every asset
// URL needs the repository name as a prefix. Local dev serves from the root.
//
// Passed in rather than sniffed from GITHUB_ACTIONS, which used to mean a
// build produced a different bundle depending on where it ran — so "the same
// command locally and in CI" quietly was not. The justfile owns the default
// and CI sets it deliberately.
//
// The workflow derives it from the repository it is running in rather than
// hardcoding a name, so a fork under another name still builds a working site
// instead of one that 404s on its own bundle.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      // v8 only reports on files it saw imported, which is how four of the
      // five largest files here sat at zero without anyone noticing. Naming
      // the source tree makes an untested file show up as an untested file
      // rather than not show up at all.
      //
      // `coverage.all` was the option that did this before Vitest 4 removed
      // it; `include` is the replacement and its default is "whatever the run
      // happened to import".
      include: ['src/**/*.ts'],
    },
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The containment fuzz and shot-reachability suites each run thousands of
    // seconds of simulated play. They take a couple of seconds on a developer
    // machine and rather longer on a shared CI runner.
    testTimeout: 60_000,
  },
});
