import { playwright } from '@vitest/browser-playwright';
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
      thresholds: {
        // Measured, then shaved. The suite reaches 89.6% of statements and
        // 91.3% of lines; these sit just under so the gate ratchets rather
        // than being a round number picked in advance, and so a real
        // regression trips it before a rounding difference does.
        //
        // Raise them when the number rises. Never lower them to make a build
        // pass — that is the one move that turns a gate into decoration.
        statements: 88,
        branches: 79,
        functions: 83,
        lines: 90,
      },
    },
    projects: [
      {
        // Everything that does not need a browser, which is most of it: the
        // solver, the rules, the tables, and every painter — the art modules
        // take a 2D context as a type and never touch the DOM, so a recording
        // fake drives them faster than a real canvas would.
        //
        // `extends: true` is not optional: without it a project ignores the
        // root Vite config and the tests run against a different transform
        // from the one that builds the game.
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          // This replaces the default exclude rather than adding to it, so
          // node_modules has to be named again alongside the browser suites.
          exclude: ['**/node_modules/**', 'tests/**/*.browser.test.ts'],
          // The containment fuzz and shot-reachability suites each run
          // thousands of seconds of simulated play. They take a couple of
          // seconds on a developer machine and rather longer on a shared CI
          // runner.
          testTimeout: 60_000,
        },
      },
      {
        // The three modules that genuinely need a browser: the renderer wants
        // a real canvas and a device pixel ratio, the input layer wants real
        // events on a real window, and the synthesiser wants an AudioContext.
        // Nothing else belongs here, because everything here costs a browser
        // process.
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/**/*.browser.test.ts'],
          testTimeout: 20_000,
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
            provider: playwright({
              launchOptions: {
                // Headless Chromium will not start an AudioContext without a
                // user gesture, exactly as a real browser will not. The smoke
                // test supplies a real click; these construct the synthesiser
                // directly, so they are told the policy does not apply.
                args: ['--autoplay-policy=no-user-gesture-required'],
              },
            }),
          },
        },
      },
    ],
  },
});
