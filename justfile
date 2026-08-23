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
    trap 'kill $server' EXIT
    sleep 2
    node scripts/smoke.mjs http://localhost:4173/ screenshots

# Everything CI runs.
check: lint test build

# Remove build output and installed packages.
clean:
    rm -rf dist node_modules screenshots
