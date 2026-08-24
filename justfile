# Loopback Pinball task runner.

default:
    @just --list

# Install dependencies.
setup:
    npm install

# Typecheck the project.
lint:
    npm run typecheck

# Run the unit tests.
test:
    npm test

# Run the unit tests in watch mode.
watch:
    npm run test:watch

# Build the production bundle into dist/.
build:
    npm run build

# Serve the game with hot reload.
run:
    npm run dev

# Build, serve the bundle and drive it in a real browser.
smoke: build
    #!/usr/bin/env bash
    set -euo pipefail
    npx vite preview --port 4173 --strictPort >/dev/null 2>&1 &
    server=$!
    # Ignore a failed kill: the trap runs after the server has usually already
    # gone, and its failure was the last thing to touch $?, so the recipe
    # reported a smoke test that had actually passed as a failure.
    trap 'kill $server 2>/dev/null || true' EXIT
    npx wait-on -t 60000 http://localhost:4173/
    node scripts/smoke.mjs http://localhost:4173/ screenshots

# Everything CI runs.
check: lint test build

# Remove build output and installed packages.
clean:
    rm -rf dist node_modules screenshots
