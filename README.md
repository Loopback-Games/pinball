# Loopback Pinball

A pinball table that runs in the browser on a phone or a desktop, with no
runtime dependencies, no image files and no audio files. Every pixel is drawn
and every sound is synthesised as the game runs.

**Play it: <https://loopback-games.github.io/pinball/>**

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Left flipper | `Z`, `←`, or left `Shift` | Tap the left half of the screen |
| Right flipper | `/`, `→`, or right `Shift` | Tap the right half |
| Plunger | Hold `Space`, release to fire | Hold anywhere, release to fire |
| Nudge | `X` and `.` | Tap the top strip, or shake the device |
| New game | `Enter` | Tap the attract screen |

Nudging too often tilts the table and kills the flippers until the ball drains,
exactly as it should.

## The table

Three pop bumpers under the dome, two slingshots, a three-bank of drop targets,
five standup targets, a spinner in the left orbit lane, three rollover lanes
across the top of the orbit, a mission saucer, and a plastic ramp that returns
the ball to the left inlane.

Completing a mission promotes you a rank, from Cadet to Admiral. Three missions
lights multiball. Clearing the drop targets or the rollover lanes raises the
bonus multiplier, which is paid out when the ball drains.

## Running it

```sh
just setup     # install dependencies
just run       # dev server with hot reload
just test      # unit tests
just check     # everything CI runs
just smoke     # build, then drive the real game in a browser
```

Without `just`, the same commands are `npm install`, `npm run dev`, `npm test`,
and `npm run build`.

## How it is built

TypeScript, Vite and Vitest for tooling; Canvas 2D and WebAudio at runtime.
Nothing else. The bundle is about 15 kB gzipped.

The design and the reasoning behind it are in
[`docs/superpowers/specs/2026-08-23-pinball-design.md`](docs/superpowers/specs/2026-08-23-pinball-design.md).
The short version:

**The physics solver is custom.** Pinball is one very fast ball against static
geometry plus a couple of kinematic flippers. General-purpose 2D engines are
built for the opposite problem and let the ball tunnel through walls at plunger
speed. The solver here runs a fixed 480 Hz substep and resolves each collision
at its exact time of impact, so tunnelling is not possible; a fuzz test fires
balls around the table at up to 3800 units per second to prove it.

**The table is data.** Every wall, guide and target is a collider in
`src/game/table.ts`, and the rule layer reacts to collider ids. The solver knows
nothing about scoring and the renderer never writes state.

**Shots are tested, not eyeballed.** `tests/playability.test.ts` fans a ball out
from each flipper across every angle and speed and asserts that every feature is
reachable. This caught a post standing in the ramp mouth that had made the ramp
reachable by one shot in 288 — invisible in a screenshot, obvious to the sweep.

## Licence

MIT. See [LICENSE](LICENSE).
