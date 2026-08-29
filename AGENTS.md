# Working in this repository

## The rule

**A workflow must never carry a command a developer cannot run locally.**

Every command lives in the `justfile`, and `.github/workflows/ci.yml` runs
`just ci` — one step, no inline shell. If CI needs to do something new, it gets
a recipe first.

This repository already held to it. What it had not done was look at a workflow
file: there was no actionlint, no zizmor and no yamllint here until they were
added alongside the rest.

## Tools

Tool versions live in `mise.toml` and nowhere else — not in a workflow, not in
`package.json`, not in a README. CI installs that same file with
`jdx/mise-action`, so a version bump happens in one place. `package.json`'s
`engines` states the minimum and follows the pin; it does not compete with it.

`just setup` installs everything. The justfile puts `node_modules/.bin` and then
mise's shims on `PATH`, so recipes work whether or not your shell has activated
mise — and so a bare `tsc` is the pinned one. Never reintroduce `npx`: it will
silently fetch a tool that is not installed, which is the failure this toolchain
exists to prevent.

Dependabot has no mise ecosystem, so those pins are bumped by hand with
`mise upgrade`.

## The container

`.devcontainer/Containerfile` builds on Playwright's official image, and
`deploy.yml` runs its job in the same image. The tag must equal the `playwright`
version in `package.json` — this project drives the browser through
`@vitest/browser-playwright` and the smoke test, not `@playwright/test`: Playwright cannot locate its
browsers otherwise, and the failure is total rather than a warning.
`just lint-versions` compares the two and is part of `just ci`.

Bump the image tag, its digest and the npm package in one commit.

## Formatting

Prettier, pinned in `devDependencies`. `.github/` is excluded from it on
purpose — `yamllint --strict` wants two spaces before an inline comment and
prettier collapses them to one, so the workflows belong to the tool that also
validates them.

There is no ESLint. TypeScript in strict mode — with `noUncheckedIndexedAccess`
and `exactOptionalPropertyTypes`, which the sibling repositories do not yet
have — already rejects most of what a linter would catch in a project with no
runtime dependencies.

## Actions

Pinned by commit SHA with the version in a trailing comment. Resolve a SHA with
`gh api repos/<owner>/<repo>/git/ref/tags/<tag>` — never copy one from memory.
`actionlint` and `zizmor` run in `just lint-config`.

## Before you push

`just check`, or `just ci` for the whole thing from a clean tree. `just art`
renders the room sheet and is in `ci` but not `check`, because it is there to be
looked at rather than to pass or fail.

`just verify-live <url>` runs the same browser suite against a deployed site.
The deploy workflow calls it after publishing.
