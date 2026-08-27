# Loopback Pinball task runner.
#
# This is the only interface. Recipes call the tools directly rather than
# shelling through `npm run`, so there is one definition of every step and
# nothing to drift between two files. CI runs `just ci` and nothing else.
#
# The project's own binaries go first on PATH, so `tsc` here is the TypeScript
# in package-lock.json and not whatever a machine happens to have installed
# globally. That was not academic: before this line, `just lint` was resolving
# tsc to a Homebrew copy, and the version it agreed with the project on was a
# coincidence rather than a guarantee.
export PATH := justfile_directory() / "node_modules/.bin:" + env_var("PATH")

# Where the built site will be served from. GitHub Pages serves a project site
# under /<repo>/, so CI overrides this; a local build serves from the root.
#
# Passed explicitly rather than sniffed from GITHUB_ACTIONS inside vite.config,
# so `just build` produces the same bundle wherever it runs and the CI artifact
# is a deliberate choice rather than an ambient one.
export BASE_PATH := env_var_or_default("BASE_PATH", "/")

# Port the preview server uses for the smoke test.
preview_port := "4173"

default:
    @just --list

# Install dependencies for day-to-day work.
setup:
    npm install

# Install dependencies exactly as the lockfile pins them.
install:
    npm ci

# Format every file in place.
fmt:
    prettier --write .

# Typecheck the project and check formatting.
lint:
    tsc --noEmit
    prettier --check .

# npm audit reports against its own advisory database and osv-scanner against
# OSV's; they disagree often enough on a dev-only tree to be worth the few
# seconds. Both come from mise now, so neither is optional and neither is
# skipped silently the way osv-scanner used to be.
#
# gitleaks reads the history rather than the working tree, because a key that
# was committed and then deleted is still a key that was published. That is
# what makes CI need a full clone.

# Audit the dependency tree, twice, and look for committed secrets.
security:
    npm audit --audit-level=high
    osv-scanner scan source --lockfile package-lock.json
    gitleaks git . --no-banner --redact

# Run the unit tests.
test:
    vitest run

# Run the unit tests in watch mode.
watch:
    vitest

# Build the production bundle into dist/.
build:
    tsc --noEmit
    vite build

# Serve the game with hot reload.
run:
    vite

# The OS libraries have to come from somewhere, and `--with-deps` installs
# them through apt — so it works on the Ubuntu runner and fails outright on a
# Fedora host. Detected rather than passed in, so that `just ci` is the same
# command everywhere and the platform difference lives in the one place it is
# actually true.

# Fetch the browser the smoke test drives.
browsers:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v apt-get >/dev/null 2>&1; then
        playwright install --with-deps chromium
    else
        playwright install chromium
    fi

# Build, serve the bundle and drive it in a real browser.
smoke: build browsers
    #!/usr/bin/env bash
    set -euo pipefail
    # A server left behind by an earlier run would be serving an older dist,
    # and wait-on would happily report it as ready. That has already cost an
    # afternoon of testing a build that was not the one just made.
    #
    # Checked with the node that is guaranteed present rather than lsof, which
    # is not installed in a slim container and, worse, made the guard fail open:
    # "lsof not found" came out as "port is free".
    if node -e 'const s=require("net").connect({port:{{ preview_port }},host:"127.0.0.1"});s.on("connect",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1))'; then
        echo "port {{ preview_port }} is already in use; stop whatever is on it first" >&2
        exit 1
    fi
    vite preview --port {{ preview_port }} --strictPort >/dev/null 2>&1 &
    server=$!
    # Ignore a failed kill: the trap runs after the server has usually already
    # gone, and its failure was the last thing to touch $?, so the recipe
    # reported a smoke test that had actually passed as a failure.
    trap 'kill $server 2>/dev/null || true' EXIT
    wait-on -t 60000 http://localhost:{{ preview_port }}/
    node scripts/smoke.mjs http://localhost:{{ preview_port }}/ screenshots

# Everything, from a clean checkout, exactly as CI runs it.
ci: install lint security test build smoke

# Everything except the browser, for a quick loop before pushing.
check: lint security test build

# Remove build output and installed packages.
clean:
    rm -rf dist node_modules screenshots coverage
